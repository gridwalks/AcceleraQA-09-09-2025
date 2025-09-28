// src/App.js - Updated to integrate learning suggestions
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// Components
import Header from './components/Header';
import ChatArea from './components/ChatArea';
import Sidebar from './components/Sidebar';
import AuthScreen from './components/AuthScreen';
import LoadingScreen from './components/LoadingScreen';
import ErrorBoundary from './components/ErrorBoundary';
import RAGConfigurationPage from './components/RAGConfigurationPage';
import AdminScreen from './components/AdminScreen';
import NotebookOverlay from './components/NotebookOverlay';
import SupportRequestOverlay from './components/SupportRequestOverlay';
import StorageNotification, { useStorageNotifications } from './components/StorageNotification';

// Utility
import { v4 as uuidv4 } from 'uuid';
import authService, { initializeAuth, handleLogout } from './services/authService';
import ragService, { search as ragSearch } from './services/ragService';
import openaiService from './services/openaiService';

import {
  initializeNeonService,
  loadConversations as loadStoredConversations,
  saveConversation as saveStoredConversation,
} from './services/neonService';

import { FEATURE_FLAGS } from './config/featureFlags';
import { loadMessagesFromStorage, saveMessagesToStorage } from './utils/storageUtils';
import {
  mergeCurrentAndStoredMessages,
  combineMessagesIntoConversations,
  buildChatHistory,
} from './utils/messageUtils';
import {
  detectDocumentExportIntent,
  exportMessagesToExcel,
  exportMessagesToWord,
} from './utils/exportUtils';
import { convertFileToPdfIfNeeded } from './utils/fileConversion';
import trainingResourceService from './services/trainingResourceService';
import {
  createAttachmentResources,
  buildInternalResources,
  dedupeResources,
} from './utils/internalResourceUtils';

const COOLDOWN_SECONDS = 10;
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

const normalizeValue = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const conversationIdMatchesMessage = (conversationId, messageId) => {
  if (!conversationId || !messageId) {
    return false;
  }

  if (conversationId === messageId) {
    return true;
  }

  return (
    conversationId.startsWith(`${messageId}-`) ||
    conversationId.endsWith(`-${messageId}`) ||
    conversationId.includes(`-${messageId}-`)
  );
};

const isMatchingResource = (resource, target) => {
  if (!resource || !target) {
    return false;
  }

  const resourceUrl = normalizeValue(resource.url);
  const targetUrl = normalizeValue(target.url);

  if (resourceUrl && targetUrl) {
    return resourceUrl === targetUrl;
  }

  const resourceTitle = normalizeValue(resource.title);
  const targetTitle = normalizeValue(target.title);

  return Boolean(resourceTitle && targetTitle && resourceTitle === targetTitle);
};

const removeResourceFromMessages = (messages, target) => {
  if (!Array.isArray(messages) || messages.length === 0 || !target) {
    return messages;
  }

  const messageIds = new Set(
    (target.sourceMessages || [])
      .map((source) => source?.messageId)
      .filter(Boolean)
  );

  let changed = false;

  const updated = messages.reduce((acc, message) => {
    const shouldInspect =
      messageIds.size === 0 || messageIds.has(message?.id);

    if (!shouldInspect || !Array.isArray(message?.resources) || message.resources.length === 0) {
      acc.push(message);
      return acc;
    }

    const filteredResources = message.resources.filter(
      (resource) => !isMatchingResource(resource, target)
    );

    if (filteredResources.length === message.resources.length) {
      acc.push(message);
      return acc;
    }

    changed = true;

    if (filteredResources.length === 0 && message.isResource) {
      return acc;
    }

    acc.push({
      ...message,
      resources: filteredResources,
    });

    return acc;
  }, []);

  return changed ? updated : messages;
};

function App() {
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  // UI state
  const [showRAGConfig, setShowRAGConfig] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showNotebook, setShowNotebook] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [isServerAvailable] = useState(true);

  // Conversation state
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [activeDocument, setActiveDocument] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const [adminResources, setAdminResources] = useState([]);

  // Learning suggestions state
  const [learningSuggestions, setLearningSuggestions] = useState([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  // Save status
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaveTime, setLastSaveTime] = useState(null);

  // Sidebar state
  const [selectedMessages, setSelectedMessages] = useState(new Set());
  const [thirtyDayMessages, setThirtyDayMessages] = useState([]);
  const [isGeneratingNotes, setIsGeneratingNotes] = useState(false);

  const messagesEndRef = useRef(null);
  const messagesLoadedRef = useRef(false);
  const isAdmin = useMemo(() => user?.roles?.includes('admin'), [user]);
  const { StorageWelcomeModal: StorageWelcomeModalComponent } = useStorageNotifications(
    isAuthenticated ? user : null,
    messages.length
  );
  const adminResourcesLoadedRef = useRef(false);
  const inactivityTimerRef = useRef(null);
  const usesNeonBackend = useMemo(() => ragService.isNeonBackend(), []);

  const handleLogoutComplete = useCallback(() => {
    setIsAuthenticated(false);
    setUser(null);
    setLearningSuggestions([]);
    setShowRAGConfig(false);
    setShowAdmin(false);
    setShowNotebook(false);
    setShowSupport(false);
  }, []);

  const handleAutoLogout = useCallback(async () => {
    console.log('User inactive for 15 minutes - logging out');
    try {
      await handleLogout();
    } catch (error) {
      console.error('Auto logout failed:', error);
    } finally {
      handleLogoutComplete();
    }
  }, [handleLogoutComplete]);

  const resetInactivityTimer = useCallback(() => {
    if (!isAuthenticated) {
      return;
    }

    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }

    inactivityTimerRef.current = setTimeout(() => {
      handleAutoLogout();
    }, INACTIVITY_TIMEOUT_MS);
  }, [handleAutoLogout, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      return;
    }

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];

    const handleActivity = () => {
      resetInactivityTimer();
    };

    activityEvents.forEach((event) => window.addEventListener(event, handleActivity));

    resetInactivityTimer();

    return () => {
      activityEvents.forEach((event) => window.removeEventListener(event, handleActivity));
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
  }, [isAuthenticated, resetInactivityTimer]);

  const refreshAdminResources = useCallback(async () => {
    try {
      const stored = await trainingResourceService.getTrainingResources();
      setAdminResources(Array.isArray(stored) ? stored : []);
    } catch (error) {
      console.error('Failed to load admin resources:', error);
      setAdminResources([]);
    }
  }, []);

  useEffect(() => {
    refreshAdminResources()
      .catch(error => console.error('Initial admin resource load failed:', error))
      .finally(() => {
        adminResourcesLoadedRef.current = true;
      });
  }, [refreshAdminResources]);

  useEffect(() => {
    if (adminResourcesLoadedRef.current && !showAdmin) {
      refreshAdminResources();
    }
  }, [showAdmin, refreshAdminResources]);

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  // Initialize authentication on mount
  useEffect(() => {
    const initAuth = async () => {
      setLoading(true);
      const authUser = await initializeAuth(
        (authUser) => setUser(authUser),
        () => {}
      );
      const authStatus = !!authUser;
      setIsAuthenticated(authStatus);
      if (!authStatus) {
        setUser(null);
      }
      setLoading(false);
    };

    initAuth();
  }, []);

  // Load learning suggestions when user logs in
  const loadInitialLearningSuggestions = useCallback(async () => {
    if (!FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS || !user?.sub) return;

    setIsLoadingSuggestions(true);
    try {
      console.log('Loading initial learning suggestions for user:', user.sub);
      const { default: learningSuggestionsService } = await import('./services/learningSuggestionsService');
      const suggestions = await learningSuggestionsService.getLearningSuggestions(user.sub);
      setLearningSuggestions(suggestions);
      console.log('Loaded learning suggestions:', suggestions.length);
    } catch (error) {
      console.error('Error loading initial learning suggestions:', error);
    } finally {
      setIsLoadingSuggestions(false);
    }
  }, [user]);

  // Initialize backend services when user is available
  useEffect(() => {
    if (user) {
      initializeNeonService(user);
      if (FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS) {
        loadInitialLearningSuggestions();
      }
    }
  }, [user, loadInitialLearningSuggestions]);

  // Load messages from storage when user logs in
  useEffect(() => {

    messagesLoadedRef.current = false;

    const loadStoredMessages = async () => {
      if (!user?.sub) return;
      try {
        const stored = await loadMessagesFromStorage(user.sub);
        setMessages(stored);
      } catch (error) {
        console.error('Failed to load messages from storage:', error);

      } finally {
        messagesLoadedRef.current = true;

      }
    };

    loadStoredMessages();
  }, [user]);

  // Persist messages to storage whenever they change
  useEffect(() => {

    if (!user?.sub || !messagesLoadedRef.current) return;

    const persist = async () => {
      try {
        await saveMessagesToStorage(user.sub, messages);
      } catch (error) {
        console.error('Failed to save messages to storage:', error);
      }
    };

    persist();
  }, [messages, user]);

  // Load conversations from OpenAI backend when user is available or refresh requested
  useEffect(() => {
    const fetchConversations = async () => {
      if (!user) return;
      try {
        const loaded = await loadStoredConversations();
        setThirtyDayMessages(loaded);
      } catch (error) {
        console.error('Error loading conversations from OpenAI backend:', error);
      }
    };

    fetchConversations();
  }, [user, lastSaveTime, setThirtyDayMessages, loadStoredConversations]);

  // Refresh learning suggestions after new conversations
  const refreshLearningSuggestions = useCallback(async () => {
    if (!FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS || !user?.sub) return;

    try {
      console.log('Refreshing learning suggestions...');
      const { default: learningSuggestionsService } = await import('./services/learningSuggestionsService');
      const suggestions = await learningSuggestionsService.refreshSuggestions(user.sub);
      setLearningSuggestions(suggestions);
    } catch (error) {
      console.error('Error refreshing learning suggestions:', error);
    }
  }, [user]);

  // Auto-scroll messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Save conversation to OpenAI backend after assistant responses
  useEffect(() => {
    if (!user || messages.length < 2) return;

    const last = messages[messages.length - 1];
    if (last.role !== 'assistant') return;

    const messagesWithType = messages.map(msg => ({
      ...msg,
      type: msg.type || msg.role,
    }));

    const save = async () => {
      setIsSaving(true);
      try {
        await saveStoredConversation(messagesWithType);
        setLastSaveTime(new Date().toISOString());
      } catch (error) {
        console.error('Error saving conversation to OpenAI backend:', error);
      } finally {
        setIsSaving(false);
      }
    };

    save();
  }, [messages, user]);

  const handleSendMessage = useCallback(async () => {
    const rawInput = inputMessage;
    const trimmedInput = rawInput.trim();

    if (!trimmedInput && !uploadedFile) return;
    if (cooldown > 0) return;

    setIsLoading(true);

    let conversionDetails = null;
    let preparedFile = null;

    if (uploadedFile) {
      try {
        conversionDetails = await convertFileToPdfIfNeeded(uploadedFile);
        preparedFile = conversionDetails.file;
      } catch (conversionError) {
        console.error('File conversion failed:', conversionError);
        setIsLoading(false);
        setUploadedFile(null);
        setMessages((prev) => [
          ...prev,
          {
            id: uuidv4(),
            role: 'assistant',
            type: 'ai',
            content:
              conversionError.message ||
              'I was unable to process the attached document. Please upload a PDF, Word (.docx), Markdown (.md), text (.txt), CSV (.csv), or Excel (.xlsx) file.',
            timestamp: Date.now(),
            sources: [],
            resources: [],
          },
        ]);
        return;
      }
    }

    const conversationHistory = buildChatHistory(messages);

    const attachments = uploadedFile
      ? [
          {
            originalFileName:
              conversionDetails?.originalFileName || uploadedFile.name || null,
            finalFileName:
              preparedFile?.name ||
              conversionDetails?.originalFileName ||
              uploadedFile.name ||
              null,
            converted: Boolean(conversionDetails?.converted),
            conversionType: conversionDetails?.conversion || null,
          },
        ]
      : [];

    const attachmentResources = createAttachmentResources(attachments);

    const userMessage = {
      id: uuidv4(),
      role: 'user',
      type: 'user',
      content: rawInput,
      timestamp: Date.now(),
      resources: attachmentResources,
      ...(attachments.length > 0 ? { attachments } : {}),
    };

    const updatedMessages = [...messages, userMessage];

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage('');

    const exportIntent = !preparedFile ? detectDocumentExportIntent(trimmedInput) : null;

    if (exportIntent) {
      const exportSourceMessages = updatedMessages;

      try {
        if (exportIntent === 'word') {
          exportMessagesToWord(exportSourceMessages);
        } else {
          exportMessagesToExcel(exportSourceMessages);
        }

        const confirmationMessage = {
          id: uuidv4(),
          role: 'assistant',
          type: 'ai',
          content: `I've exported your recent conversations to a ${exportIntent === 'word' ? 'Word document' : 'Excel file'}. Check your downloads folder to access it.`,
          timestamp: Date.now(),
          sources: [],
          resources: [],
        };

        setMessages((prev) => [...prev, confirmationMessage]);
      } catch (error) {
        console.error('Export generation failed:', error);
        const errorMessage = {
          id: uuidv4(),
          role: 'assistant',
          type: 'ai',
          content: `I wasn't able to create the export: ${error.message || 'Unknown error occurred.'}`,
          timestamp: Date.now(),
          sources: [],
          resources: [],
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
        setUploadedFile(null);
      }

      return;
    }

    const vectorStoreIdToUse = usesNeonBackend || preparedFile
      ? null
      : activeDocument?.vectorStoreId || null;

    try {
      const ragSearchOptions = !usesNeonBackend && activeDocument?.vectorStoreId
        ? { vectorStoreIds: [activeDocument.vectorStoreId] }
        : undefined;

      let response = null;
      let modeUsed = 'AI Knowledge';
      let documentSearchAttempted = false;

      if (!preparedFile) {
        documentSearchAttempted = true;
        const ragResponse = await ragSearch(rawInput, user?.sub, ragSearchOptions, conversationHistory);
        const ragAnswer = typeof ragResponse?.answer === 'string' ? ragResponse.answer.trim() : '';
        const ragSources = Array.isArray(ragResponse?.sources) ? ragResponse.sources : [];

        if (ragAnswer || ragSources.length > 0) {
          response = ragResponse;
          modeUsed = 'Document Search';
        }
      }

      if (!response) {
        response = await openaiService.getChatResponse(
          rawInput,
          preparedFile,
          conversationHistory,
          undefined,
          vectorStoreIdToUse
        );

        modeUsed = documentSearchAttempted ? 'AI Knowledge (automatic fallback)' : 'AI Knowledge';
      }

      const combinedInternalResources = buildInternalResources({
        attachments,
        sources: response.sources || [],
        adminResources,
        contextText: `${trimmedInput}\n${response.answer || ''}`,
      });

      const responseResources = Array.isArray(response.resources) ? response.resources : [];
      const mergedResources = dedupeResources([
        ...responseResources,
        ...combinedInternalResources,
      ]);

      const assistantMessage = {
        id: uuidv4(),
        role: 'assistant',
        type: 'ai',
        content: (() => {
          const answerText = typeof response.answer === 'string' ? response.answer.trim() : '';
          const modeLine = `Mode used: ${modeUsed}`;
          return answerText ? `${answerText}\n\n_${modeLine}_` : `_${modeLine}_`;
        })(),
        timestamp: Date.now(),
        sources: response.sources || [],
        resources: mergedResources,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      if (!usesNeonBackend && response.vectorStoreId) {
        if (preparedFile) {
          const now = Date.now();
          setActiveDocument({
            vectorStoreId: response.vectorStoreId,
            originalName:
              conversionDetails?.originalFileName || uploadedFile?.name || preparedFile?.name || null,
            processedName: preparedFile?.name || null,
            mimeType:
              conversionDetails?.originalMimeType || uploadedFile?.type || preparedFile?.type || null,
            size: uploadedFile?.size ?? preparedFile?.size ?? null,
            converted: Boolean(conversionDetails?.converted),
            lastUpdated: now,
          });
        } else {
          const now = Date.now();
          setActiveDocument((prev) => {
            if (!prev) {
              return {
                vectorStoreId: response.vectorStoreId,
                lastUpdated: now,
              };
            }

            if (prev.vectorStoreId === response.vectorStoreId) {
              return {
                ...prev,
                lastUpdated: now,
              };
            }

            return {
              ...prev,
              vectorStoreId: response.vectorStoreId,
              lastUpdated: now,
            };
          });
        }
      } else if (preparedFile) {
        setActiveDocument(null);
      }

      // Refresh learning suggestions after every few messages
      const totalMessages = messages.length + 2; // +2 for the new messages we just added
      if (FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS && totalMessages % 4 === 0) { // Every 4 messages (2 conversation pairs)
        setTimeout(() => {
          refreshLearningSuggestions();
        }, 1000); // Small delay to let the conversation save first
      }

    } catch (error) {
      const isRateLimit = error.response?.status === 429 || error.message?.toLowerCase().includes('rate limit');

      if (isRateLimit) {
        setCooldown(COOLDOWN_SECONDS);
        const errorMessage = {
          id: uuidv4(),
          role: 'assistant',
          type: 'ai',
          content: 'Rate limit exceeded. Please wait a few seconds before trying again.',
          timestamp: Date.now(),
          sources: [],
          resources: [],
        };
        setMessages((prev) => [...prev, errorMessage]);
      } else {
        const errorMessage = {
          id: uuidv4(),
          role: 'assistant',
          type: 'ai',
          content: error.message || 'An error occurred while fetching the response.',
          timestamp: Date.now(),
          sources: [],
          resources: [],
        };
        setMessages((prev) => [...prev, errorMessage]);
      }
    } finally {
      setIsLoading(false);
      setUploadedFile(null);
    }
  }, [
    inputMessage,
    uploadedFile,
    messages,
    refreshLearningSuggestions,
    cooldown,
    user?.sub,
    activeDocument,
    adminResources,
  ]);

  const handleKeyPress = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    },
    [handleSendMessage]
  );

  const handleRefreshConversations = useCallback(async () => {
    console.log('Refreshing conversations');
    try {
      const loaded = await loadStoredConversations(false);
      setThirtyDayMessages(loaded);
    } catch (error) {
      console.error('Error refreshing conversations from OpenAI backend:', error);
    }
    setLastSaveTime(new Date().toISOString());
    // Also refresh learning suggestions when conversations are refreshed
    if (FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS) {
      refreshLearningSuggestions();
    }
  }, [refreshLearningSuggestions, setThirtyDayMessages, loadStoredConversations]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setInputMessage('');
    setUploadedFile(null);
    setActiveDocument(null);
    // Refresh suggestions when chat is cleared (might reveal different patterns)
    if (FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS) {
      setTimeout(() => {
        refreshLearningSuggestions();
      }, 500);
    }
  }, [refreshLearningSuggestions, setInputMessage]);

  const clearAllConversations = useCallback(() => {
    setMessages([]);
    setUploadedFile(null);
    setActiveDocument(null);
    setSelectedMessages(new Set());
    setThirtyDayMessages([]);
    // Clear learning suggestions cache when all conversations are cleared
    if (FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS && user?.sub) {
      import('./services/learningSuggestionsService').then(({ default: learningSuggestionsService }) => {
        learningSuggestionsService.clearCache(user.sub);
      });
      setLearningSuggestions([]);
    }
  }, [user]);

  const handleExportSelected = useCallback(() => {
    console.log('Exporting selected messages', Array.from(selectedMessages));
  }, [selectedMessages]);

  const clearSelectedMessages = useCallback(() => setSelectedMessages(new Set()), []);

  const generateStudyNotes = useCallback(async () => {
    const selectedIds = Array.from(selectedMessages || []);
    if (selectedIds.length === 0) return;

    setIsGeneratingNotes(true);

    try {
      const mergedMessages = mergeCurrentAndStoredMessages(messages, thirtyDayMessages);
      const conversations = combineMessagesIntoConversations(mergedMessages);
      const selectedIdSet = new Set(selectedIds);

      const selectedConversations = conversations.filter((conversation) =>
        selectedIdSet.has(conversation.id)
      );

      const candidateMessages = [];
      const seenMessageIds = new Set();
      const sourceMessageMetadata = [];
      const seenSourceIds = new Set();

      selectedConversations.forEach((conversation) => {
        const participantMessages = [
          conversation.originalUserMessage,
          conversation.originalAiMessage,
        ].filter(Boolean);

        participantMessages.forEach((message) => {
          if (!message || !message.id) {
            return;
          }

          if (!seenSourceIds.has(message.id)) {
            sourceMessageMetadata.push({
              conversationCardId: conversation.id,
              messageId: message.id,
              role: message.role || message.type || null,
              timestamp: message.timestamp || conversation.timestamp || null,
            });
            seenSourceIds.add(message.id);
          }

          if (seenMessageIds.has(message.id)) {
            return;
          }

          if (message.isResource || message.isStudyNotes) {
            return;
          }

          const content = typeof message.content === 'string' ? message.content.trim() : '';
          if (!content) {
            return;
          }

          const baseType = message.type || message.role;
          let normalizedType = baseType;

          if (baseType === 'assistant') {
            normalizedType = 'ai';
          } else if (baseType === 'user') {
            normalizedType = 'user';
          } else if (baseType === 'ai') {
            normalizedType = 'ai';
          } else if (message.role === 'assistant') {
            normalizedType = 'ai';
          } else if (message.role === 'user') {
            normalizedType = 'user';
          }

          if (normalizedType !== 'user' && normalizedType !== 'ai') {
            return;
          }

          seenMessageIds.add(message.id);

          candidateMessages.push({
            ...message,
            type: normalizedType,
          });
        });
      });

      if (candidateMessages.length === 0) {
        throw new Error('Please select at least one conversation with a valid AI response.');
      }

      const notesResult = await openaiService.generateStudyNotes(candidateMessages);
      const notesContent = typeof notesResult?.answer === 'string' ? notesResult.answer.trim() : '';

      if (!notesContent) {
        throw new Error('The assistant did not return any notes.');
      }


      const resources = Array.isArray(notesResult?.resources) ? notesResult.resources : [];

      const topicSeeds = selectedConversations
        .map((conversation) => {
          const userPreview =
            typeof conversation.userContent === 'string' ? conversation.userContent.trim() : '';
          const aiPreview =
            typeof conversation.aiContent === 'string' ? conversation.aiContent.trim() : '';

          const seed = userPreview || aiPreview || '';
          return seed.replace(/\s+/g, ' ').trim();
        })
        .filter(Boolean);

      const topTopics = topicSeeds.slice(0, 5).map((topic, index) => {
        const truncated = topic.length > 160 ? `${topic.slice(0, 157)}…` : topic;
        return `${index + 1}. ${truncated}`;
      });

      const generatedAt = new Date();

      const studyNotesMessage = {
        id: uuidv4(),
        role: 'assistant',
        type: 'ai',
        content: notesContent,
        timestamp: generatedAt.getTime(),
        resources,
        sources: [],
        isStudyNotes: true,
        sourceMessages: sourceMessageMetadata,
        studyNotesData: {
          generatedAt: generatedAt.toISOString(),
          generatedDate: generatedAt.toLocaleString(),
          selectedConversationCount: selectedConversations.length,
          selectedConversationIds: selectedConversations.map((conversation) => conversation.id),
          selectedTopics: topTopics.length
            ? topTopics.join('\n')
            : 'Notes generated from your selected conversations.',
          selectedTopicsList: topTopics,
          content: notesContent,
          resourceCount: resources.length,
        },
        metadata: {
          type: 'studyNotes',
          generatedAt: generatedAt.toISOString(),
          conversationCount: selectedConversations.length,
        },
      };

      setMessages((prev) => [...prev, studyNotesMessage]);
      setSelectedMessages(new Set());
    } catch (error) {
      console.error('Error generating notes:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: uuidv4(),
          role: 'assistant',
          type: 'ai',
          content: `I couldn't generate notes: ${error.message || 'Unknown error occurred.'}`,
          timestamp: Date.now(),
          resources: [],
          sources: [],
        },
      ]);
    } finally {
      setIsGeneratingNotes(false);
    }
  }, [messages, thirtyDayMessages, selectedMessages, setMessages, setSelectedMessages]);

  // Handle learning suggestions updates
  const handleSuggestionsUpdate = useCallback((suggestions) => {
    console.log('Learning suggestions updated:', suggestions.length);
    // Could trigger additional UI updates or analytics here
  }, []);

  const handleAddResourceToNotebook = useCallback((item) => {
    if (!item || !item.title) return;
    const { title, url = '', type = item.type || 'Resource' } = item;
    const newMessage = {
      id: uuidv4(),
      role: 'assistant',
      type: 'ai',
      content: `${title}${url ? ' - ' + url : ''}`,
      timestamp: Date.now(),
      resources: [{ title, url, type, addedAt: Date.now() }],
      // Mark message so it can be hidden from the chat area
      isResource: true,
    };
    setMessages(prev => [...prev, newMessage]);
  }, [setMessages]);

  const handleDeleteConversation = useCallback((conversation) => {
    if (!conversation) {
      return;
    }

    const messageIdsToRemove = [
      conversation.originalUserMessage?.id,
      conversation.originalAiMessage?.id,
    ].filter(Boolean);

    if (messageIdsToRemove.length === 0) {
      return;
    }

    setMessages((prev) => {
      const next = prev.filter((message) => !messageIdsToRemove.includes(message.id));
      return next.length === prev.length ? prev : next;
    });

    setThirtyDayMessages((prev) => {
      const next = prev.filter((message) => !messageIdsToRemove.includes(message.id));
      return next.length === prev.length ? prev : next;
    });

    setSelectedMessages((prev) => {
      if (!prev.size) {
        return prev;
      }

      let changed = false;
      const next = new Set(prev);

      if (conversation.id && next.delete(conversation.id)) {
        changed = true;
      }

      if (next.size && messageIdsToRemove.length) {
        const selectedEntries = Array.from(next);

        selectedEntries.forEach((selectedId) => {
          if (
            messageIdsToRemove.some((messageId) =>
              conversationIdMatchesMessage(selectedId, messageId)
            )
          ) {
            next.delete(selectedId);
            changed = true;
          }
        });
      }

      return changed ? next : prev;
    });
  }, []);

  const handleDeleteResource = useCallback((resourceInfo) => {
    if (!resourceInfo) {
      return;
    }

    const target = {
      url: resourceInfo.url,
      title: resourceInfo.title,
      sourceMessages: resourceInfo.sourceMessages || [],
    };

    setMessages((prev) => removeResourceFromMessages(prev, target));
    setThirtyDayMessages((prev) => removeResourceFromMessages(prev, target));

    if (resourceInfo.sourceMessages?.length) {
      setSelectedMessages((prev) => {
        if (!prev.size) {
          return prev;
        }

        let changed = false;
        const next = new Set(prev);

        resourceInfo.sourceMessages.forEach((source) => {
          if (source?.conversationCardId && next.delete(source.conversationCardId)) {
            changed = true;
          }
        });

        return changed ? next : prev;
      });
    }
  }, []);

  const handleShowRAGConfig = useCallback(() => setShowRAGConfig(true), []);
  const handleCloseRAGConfig = useCallback(() => {
    setShowRAGConfig(false);
    refreshAdminResources();
  }, [refreshAdminResources]);
  const handleShowAdmin = useCallback(() => setShowAdmin(true), []);
  const handleCloseAdmin = useCallback(() => setShowAdmin(false), []);

  return (
    <ErrorBoundary>
      {loading ? (
        <LoadingScreen />
      ) : !isAuthenticated ? (
        <AuthScreen />
      ) : showRAGConfig ? (
        <RAGConfigurationPage onClose={handleCloseRAGConfig} user={user} />
      ) : showAdmin ? (
        <AdminScreen onBack={handleCloseAdmin} user={user} />
      ) : (
        <>
          <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Header remains the same */}
            <Header
              user={user}
              isSaving={isSaving}
              lastSaveTime={lastSaveTime}
              onShowAdmin={handleShowAdmin}
              onShowRAGConfig={handleShowRAGConfig}
              onOpenNotebook={() => setShowNotebook(true)}
              onOpenSupport={() => setShowSupport(true)}
              onLogout={handleLogoutComplete}
            />

            {/* Main Layout */}
            {/* <div className="flex-1 flex flex-col min-h-0"> */}
            <div className="h-[calc(100vh-64px)]">
              {/* Mobile Layout (stacked vertically) */}
              <div className="lg:hidden flex-1 h-full flex flex-col min-h-0">

                {/* Chat takes most space on mobile */}
                <div className="flex-1 min-h-0 p-4 pb-0">
                  <ChatArea
                    messages={messages}
                    inputMessage={inputMessage}
                    setInputMessage={setInputMessage}
                    isLoading={isLoading}
                    handleSendMessage={handleSendMessage}
                    handleKeyPress={handleKeyPress}
                    messagesEndRef={messagesEndRef}
                    isSaving={isSaving}
                    uploadedFile={uploadedFile}
                    setUploadedFile={setUploadedFile}
                    cooldown={cooldown}
                    onClearChat={clearChat}
                  />
                </div>

                {/* Sidebar is collapsible on mobile */}
                <div className="flex-shrink-0 border-t bg-white max-h-60 overflow-hidden">
                  <Sidebar
                    messages={messages}
                    user={user}
                    learningSuggestions={learningSuggestions}
                    isLoadingSuggestions={isLoadingSuggestions}
                    onSuggestionsUpdate={handleSuggestionsUpdate}
                    onAddResource={handleAddResourceToNotebook}
                  />
                </div>
              </div>

              {/* Desktop Layout (side by side) */}
              <div className="hidden lg:flex flex-1 h-full min-h-0">
                {/* Chat Area - Takes majority of space */}
                <div className="flex-1 min-w-0 h-full p-6 pb-0">
                  <ChatArea
                    messages={messages}
                    inputMessage={inputMessage}
                    setInputMessage={setInputMessage}
                    isLoading={isLoading}
                    handleSendMessage={handleSendMessage}
                    handleKeyPress={handleKeyPress}
                    messagesEndRef={messagesEndRef}
                    isSaving={isSaving}
                    uploadedFile={uploadedFile}
                    setUploadedFile={setUploadedFile}
                    cooldown={cooldown}
                    onClearChat={clearChat}
                  />
                </div>

                {/* Sidebar - Fixed optimal width with enhanced learning features */}
                <div className="w-80 xl:w-96 flex-shrink-0 h-full border-l bg-white p-6 pb-0">
                  <Sidebar
                    messages={messages}
                    user={user}
                    learningSuggestions={learningSuggestions}
                    isLoadingSuggestions={isLoadingSuggestions}
                    onSuggestionsUpdate={handleSuggestionsUpdate}
                    onAddResource={handleAddResourceToNotebook}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Notebook Overlay */}
          {showNotebook && (
            <NotebookOverlay
              messages={messages}
              thirtyDayMessages={thirtyDayMessages}
              selectedMessages={selectedMessages}
              setSelectedMessages={setSelectedMessages}
              generateStudyNotes={generateStudyNotes}
              isGeneratingNotes={isGeneratingNotes}
              storedMessageCount={messages.length}
              isServerAvailable={isServerAvailable}
              onDeleteConversation={handleDeleteConversation}
              onDeleteResource={handleDeleteResource}
              onClose={() => setShowNotebook(false)}
            />
          )}

          {showSupport && (
            <SupportRequestOverlay
              user={user}
              onClose={() => setShowSupport(false)}
            />
          )}

          {/* Storage notifications to highlight local persistence status */}
          <StorageNotification user={user} messagesCount={messages.length} />
          <StorageWelcomeModalComponent />
        </>
      )}
    </ErrorBoundary>
  );
}

export default App;
