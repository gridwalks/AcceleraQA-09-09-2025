// src/App.js - Updated to integrate learning suggestions
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Components
import Header from './components/Header';
import ChatArea from './components/ChatArea';
import Sidebar from './components/Sidebar';
import AuthScreen from './components/AuthScreen';
import LoadingScreen from './components/LoadingScreen';
import ErrorBoundary from './components/ErrorBoundary';
import RAGConfigurationPage from './components/RAGConfigurationPage';
import AdminScreen from './components/AdminScreen';
import ProfileScreen from './components/ProfileScreen';
import NotebookOverlay from './components/NotebookOverlay';
import SupportRequestOverlay from './components/SupportRequestOverlay';
import StorageNotification, { useStorageNotifications } from './components/StorageNotification';
import DocumentChatPage from './pages/DocumentChatPage';

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
import chatHistoryService from './services/chatHistoryService';

const COOLDOWN_SECONDS = 10;
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

const getGlobalScope = () => {
  if (typeof window !== 'undefined') {
    return window;
  }

  if (typeof globalThis !== 'undefined') {
    return globalThis;
  }

  return null;
};

const bootstrapDeprecatedRagApi = () => {
  const scope = getGlobalScope();
  if (!scope) {
    return;
  }

  if (typeof scope.setRAGEnabled !== 'function') {
    scope.setRAGEnabled = (nextEnabled) => {
      const normalized = nextEnabled !== false;
      scope.__pendingRagEnabled = normalized;
      console.warn(
        'setRAGEnabled is deprecated. Document Search now prioritizes automatically; the preference will sync once the application finishes loading.'
      );
    };
  }

  if (typeof scope.getRAGEnabled !== 'function') {
    scope.getRAGEnabled = () => {
      if (typeof scope.__ragEnabled === 'boolean') {
        return scope.__ragEnabled;
      }

      if (typeof scope.__pendingRagEnabled === 'boolean') {
        return scope.__pendingRagEnabled;
      }

      return true;
    };
  }
};

bootstrapDeprecatedRagApi();

const normalizeValue = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const RAG_EMPTY_RESPONSE_MARKERS = [
  'no relevant documents were found for your question',
  'no relevant guidance was generated from the provided excerpts',
  'the document search returned no results',
  'no results found',
  'no matching documents',
  'no relevant information found',
  'the provided document excerpts do not contain a direct definition',
  'the provided document excerpts do not contain',
  'do not contain enough information',
  'not addressed in this document',
];

const DEFAULT_DOCUMENT_SEARCH_FALLBACK_NOTE =
  'Document Search did not find relevant information in the uploaded documents. Switching to AI Knowledge to provide an answer based on general pharmaceutical quality and compliance expertise.';

const isMeaningfulDocumentSearchResponse = (answer, sources) => {
  if (typeof answer !== 'string') {
    return false;
  }

  const normalizedAnswer = answer.trim().toLowerCase();

  if (!normalizedAnswer) {
    return false;
  }

  // First check if the answer contains markers indicating insufficient information
  // This takes priority over having sources, as the AI may have found sources but still
  // indicate that they don't contain the specific information requested
  const containsInsufficientInfoMarker = RAG_EMPTY_RESPONSE_MARKERS.some((marker) =>
    normalizedAnswer.startsWith(marker) || normalizedAnswer.includes(marker)
  );

  if (containsInsufficientInfoMarker) {
    return false; // Don't consider it meaningful, trigger fallback to AI mode
  }

  // If we have sources and no insufficient info markers, consider it meaningful
  if (Array.isArray(sources) && sources.length > 0) {
    return true;
  }

  // Check if answer contains any meaningful content (more than just empty markers)
  const hasContent = normalizedAnswer.length > 20;
  const isNotJustEmptyMarker = !RAG_EMPTY_RESPONSE_MARKERS.some((marker) =>
    normalizedAnswer.startsWith(marker)
  );
  
  // Consider it meaningful if it has content OR is not just an empty marker
  return hasContent || isNotJustEmptyMarker;
};

// Check if user response is a simple yes/no to a system question
const isSimpleResponse = (message) => {
  const normalized = message.trim().toLowerCase();
  const simpleResponses = ['yes', 'no', 'y', 'n', 'ok', 'okay', 'sure', 'please', 'help'];
  return simpleResponses.includes(normalized) || normalized.length < 10;
};

// Check if the last message was a system question asking for help
const lastMessageWasSystemQuestion = (messages) => {
  if (messages.length < 2) return false;
  const lastMessage = messages[messages.length - 1];
  return lastMessage.role === 'assistant' && 
         lastMessage.content && 
         typeof lastMessage.content === 'string' &&
         (lastMessage.content.includes('rephrase') || 
          lastMessage.content.includes('different keywords') ||
          lastMessage.content.includes('related topic'));
};

// Find the original user query from conversation history
const findOriginalQuery = (messages) => {
  // Look for the most recent user message that's not a simple response
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'user' && 
        message.content && 
        typeof message.content === 'string' &&
        !isSimpleResponse(message.content)) {
      return message.content;
    }
  }
  return null;
};

const getDocumentSearchFallbackExplanation = (answer) => {
  if (typeof answer !== 'string') {
    return DEFAULT_DOCUMENT_SEARCH_FALLBACK_NOTE;
  }

  const trimmedAnswer = answer.trim();

  if (!trimmedAnswer) {
    return DEFAULT_DOCUMENT_SEARCH_FALLBACK_NOTE;
  }

  const normalizedAnswer = trimmedAnswer.toLowerCase();

  if (
    RAG_EMPTY_RESPONSE_MARKERS.some((marker) =>
      normalizedAnswer.startsWith(marker)
    )
  ) {
    return DEFAULT_DOCUMENT_SEARCH_FALLBACK_NOTE;
  }

  return trimmedAnswer;
};

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
  const [showProfile, setShowProfile] = useState(false);
  const [showNotebook, setShowNotebook] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [isServerAvailable] = useState(true);

  // Conversation state
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastResponseMode, setLastResponseMode] = useState('document-search');
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
  const ragManualOverrideRef = useRef(true);

  const updateGlobalRagFlag = useCallback((enabled) => {
    const globalScope = getGlobalScope();

    if (!globalScope) {
      return;
    }

    if (enabled === undefined) {
      if ('__ragEnabled' in globalScope) {
        delete globalScope.__ragEnabled;
      }
    } else {
      globalScope.__ragEnabled = enabled;
    }
  }, []);

  useEffect(() => {
    const globalScope = getGlobalScope();

    if (!globalScope) {
      return undefined;
    }

    const pendingValue = typeof globalScope.__pendingRagEnabled === 'boolean'
      ? globalScope.__pendingRagEnabled
      : ragManualOverrideRef.current;

    ragManualOverrideRef.current = pendingValue;
    updateGlobalRagFlag(pendingValue);

    if (pendingValue === false) {
      setLastResponseMode('ai-knowledge-manual');
    }

    if ('__pendingRagEnabled' in globalScope) {
      delete globalScope.__pendingRagEnabled;
    }

    const deprecatedSetter = (nextEnabled) => {
      const normalized = nextEnabled !== false;
      ragManualOverrideRef.current = normalized;
      updateGlobalRagFlag(normalized);

      if (!normalized) {
        console.warn(
          'setRAGEnabled is deprecated. Document Search now runs automatically and falls back to AI Knowledge when no document answer is found.'
        );
        setLastResponseMode('ai-knowledge-manual');
      } else {
        setLastResponseMode('document-search');
      }
    };

    const deprecatedGetter = () => ragManualOverrideRef.current;

    globalScope.setRAGEnabled = deprecatedSetter;
    globalScope.getRAGEnabled = deprecatedGetter;

    return () => {
      if (globalScope.setRAGEnabled === deprecatedSetter) {
        delete globalScope.setRAGEnabled;
      }
      if (globalScope.getRAGEnabled === deprecatedGetter) {
        delete globalScope.getRAGEnabled;
      }
      updateGlobalRagFlag(undefined);
      bootstrapDeprecatedRagApi();
    };
  }, [setLastResponseMode, updateGlobalRagFlag]);

  const handleLogoutComplete = useCallback(() => {
    ragManualOverrideRef.current = true;
    updateGlobalRagFlag(true);
    setIsAuthenticated(false);
    setUser(null);
    setLearningSuggestions([]);
    setLastResponseMode('document-search');
    setShowRAGConfig(false);
    setShowAdmin(false);
    setShowNotebook(false);
    setShowSupport(false);
  }, [updateGlobalRagFlag]);

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
      let documentSearchProvidedMeaningfulAnswer = false;
      let documentSearchFallbackExplanation = '';
      const manualOverrideDisabled = ragManualOverrideRef.current === false;

      // Check if this is a simple response to a system question
      const isSimpleUserResponse = isSimpleResponse(rawInput);
      const wasSystemQuestion = lastMessageWasSystemQuestion(updatedMessages);
      
      // Always try document search first unless it's a simple response to a system question
      if (!preparedFile && !manualOverrideDisabled) {
        documentSearchAttempted = true;
        try {
          // If it's a simple response to a system question, try to find the original query
          let searchQuery = rawInput;
          if (isSimpleUserResponse && wasSystemQuestion) {
            // Look for the original query in the conversation history
            const originalQuery = findOriginalQuery(updatedMessages);
            if (originalQuery) {
              searchQuery = originalQuery;
              console.log('Using original query for simple response:', originalQuery);
            }
          }
          
          const ragResponse = await ragSearch(
            searchQuery,
            user?.sub,
            ragSearchOptions,
            conversationHistory
          );
          
          console.log('RAG Response received:', {
            hasAnswer: !!ragResponse?.answer,
            answerLength: ragResponse?.answer?.length || 0,
            sourcesCount: ragResponse?.sources?.length || 0,
            hasError: ragResponse?.error || false,
            searchQuery: searchQuery,
            answerPreview: ragResponse?.answer?.substring(0, 100) || 'no answer'
          });

          const ragAnswer = typeof ragResponse?.answer === 'string' ? ragResponse.answer.trim() : '';
          const ragSources = Array.isArray(ragResponse?.sources) ? ragResponse.sources : [];

          const isMeaningful = isMeaningfulDocumentSearchResponse(ragAnswer, ragSources);
          console.log('Meaningful response check:', {
            isMeaningful,
            answerLength: ragAnswer.length,
            sourcesCount: ragSources.length,
            answerPreview: ragAnswer.substring(0, 100)
          });

          if (isMeaningful) {
            response = ragResponse;
            modeUsed = 'Document Search';
            documentSearchProvidedMeaningfulAnswer = true;
            console.log('Document search provided meaningful response');
          } else {
            // Document search didn't find meaningful results, will fall back to AI
            documentSearchFallbackExplanation = getDocumentSearchFallbackExplanation(
              ragAnswer
            );
            console.log('Document search response not meaningful, will fall back to AI:', documentSearchFallbackExplanation);
            // Don't set response here - let it fall through to AI mode
          }
        } catch (ragError) {
          console.error('Document search failed, falling back to AI Knowledge:', {
            error: ragError.message,
            stack: ragError.stack,
            query: rawInput?.substring(0, 100)
          });
          documentSearchFallbackExplanation = getDocumentSearchFallbackExplanation();
        }
      } else if (!preparedFile && manualOverrideDisabled) {
        modeUsed = 'AI Knowledge (manual override)';
      }

      if (!response) {
        // Special handling for simple responses to system questions
        if (isSimpleUserResponse && wasSystemQuestion) {
          const originalQuery = findOriginalQuery(updatedMessages);
          if (originalQuery) {
            // Try to provide helpful suggestions based on the original query
            response = {
              answer: `I understand you'd like help with your previous question: "${originalQuery}". Here are some suggestions to help you find the information you need:

1. **Try different keywords**: Use synonyms or related terms (e.g., "quality control" instead of "QA")
2. **Be more specific**: Add details about what type of information you're looking for
3. **Use broader terms**: Try searching for general topics that might contain your answer
4. **Check document titles**: Look at the document names to see if any seem relevant

Would you like to try rephrasing your question with any of these suggestions?`,
              sources: [],
              resources: []
            };
            modeUsed = 'AI Knowledge (contextual help)';
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
        }

        if (documentSearchAttempted) {
          modeUsed = 'AI Knowledge (automatic fallback)';
          setLastResponseMode('ai-knowledge-auto');
        } else if (manualOverrideDisabled && !preparedFile) {
          modeUsed = 'AI Knowledge (manual override)';
          setLastResponseMode('ai-knowledge-manual');
        } else {
          modeUsed = 'AI Knowledge';
          setLastResponseMode('ai-knowledge');
        }
      } else {
        setLastResponseMode('document-search');
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
          const contentSections = [];

          if (documentSearchAttempted && !documentSearchProvidedMeaningfulAnswer) {
            const fallbackNotice = documentSearchFallbackExplanation
              ? documentSearchFallbackExplanation
              : DEFAULT_DOCUMENT_SEARCH_FALLBACK_NOTE;
            contentSections.push(`_${fallbackNotice}_`);
          }

          if (answerText) {
            contentSections.push(answerText);
          }

          contentSections.push(`_${modeLine}_`);

          return contentSections.filter(Boolean).join('\n\n');

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
    usesNeonBackend,
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
    setLastResponseMode('document-search');
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
    setLastResponseMode('document-search');
    // Clear learning suggestions cache when all conversations are cleared
    if (FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS && user?.sub) {
      import('./services/learningSuggestionsService').then(({ default: learningSuggestionsService }) => {
        learningSuggestionsService.clearCache(user.sub);
      });
      setLearningSuggestions([]);
    }
  }, [user]);

  const loadChatHistory = useCallback((historyId) => {
    try {
      const historyEntry = chatHistoryService.getHistoryById(historyId);
      if (!historyEntry) {
        console.error('Chat history not found:', historyId);
        return;
      }

      // Convert history back to messages
      const historyMessages = chatHistoryService.historyToMessages(historyEntry);
      
      // Clear current chat state and load history
      setMessages(historyMessages);
      setInputMessage('');
      setUploadedFile(null);
      setActiveDocument(null);
      setLastResponseMode('document-search');
      
      console.log(`Loaded chat history: ${historyEntry.title} (${historyMessages.length} messages)`);
    } catch (error) {
      console.error('Error loading chat history:', error);
    }
  }, []);

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
  const handleShowProfile = useCallback(() => setShowProfile(true), []);
  const handleCloseProfile = useCallback(() => setShowProfile(false), []);

  return (
    <ErrorBoundary>
      <Router>
        {loading ? (
          <LoadingScreen />
        ) : !isAuthenticated ? (
          <AuthScreen />
        ) : (
          <Routes>
            <Route path="/document-chat" element={<DocumentChatPage />} />
            <Route path="/" element={
              <>
                <div className="min-h-screen bg-gray-50 flex flex-col">
                  {/* Header remains the same */}
                  <Header
                    user={user}
                    isSaving={isSaving}
                    lastSaveTime={lastSaveTime}
                    onShowAdmin={handleShowAdmin}
                    onShowProfile={handleShowProfile}
                    onShowRAGConfig={handleShowRAGConfig}
                    onOpenNotebook={() => setShowNotebook(true)}
                    onOpenSupport={() => setShowSupport(true)}
                    onLogout={handleLogoutComplete}
                  />

                  {/* Main Layout */}
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
                          lastResponseMode={lastResponseMode}
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
                          onLoadChatHistory={loadChatHistory}
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
                          lastResponseMode={lastResponseMode}
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
                          onLoadChatHistory={loadChatHistory}
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
            } />
            <Route path="/rag-config" element={
              showRAGConfig ? (
                <RAGConfigurationPage onClose={handleCloseRAGConfig} user={user} />
              ) : (
                <Navigate to="/" replace />
              )
            } />
            <Route path="/admin" element={
              showAdmin ? (
                <AdminScreen onBack={handleCloseAdmin} user={user} />
              ) : (
                <Navigate to="/" replace />
              )
            } />
            <Route path="/profile" element={
              showProfile ? (
                <ProfileScreen onBack={handleCloseProfile} user={user} />
              ) : (
                <Navigate to="/" replace />
              )
            } />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </Router>
    </ErrorBoundary>
  );
}

export default App;
