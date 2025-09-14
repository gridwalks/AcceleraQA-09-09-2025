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

// Utility
import { v4 as uuidv4 } from 'uuid';
import authService, { initializeAuth } from './services/authService';
import { search as ragSearch } from './services/ragService';
import openaiService from './services/openaiService';

import { initializeNeonService, loadConversations as loadNeonConversations, saveConversation as saveNeonConversation } from './services/neonService';
//import { initializeNeonService, loadConversations as loadNeonConversations, saveConversation as saveNeonConversation } from './services/neonService';
//import { initializeNeonService, loadConversations as loadNeonConversations } from './services/neonService';

import { FEATURE_FLAGS } from './config/featureFlags';
import { loadMessagesFromStorage, saveMessagesToStorage } from './utils/storageUtils';
import { mergeCurrentAndStoredMessages } from './utils/messageUtils';

const COOLDOWN_SECONDS = 10;

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
  const [ragEnabled, setRAGEnabled] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [cooldown, setCooldown] = useState(0);

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
      await initializeAuth(
        (authUser) => setUser(authUser),
        () => {}
      );
      const authStatus = await authService.isAuthenticated();
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

  // Load conversations from Neon when user is available or refresh requested
  useEffect(() => {
    const fetchConversations = async () => {
      if (!user) return;
      try {
        const loaded = await loadNeonConversations();
        setThirtyDayMessages(loaded);
      } catch (error) {
        console.error('Error loading conversations from Neon:', error);
      }
    };

    fetchConversations();
  }, [user, lastSaveTime, setThirtyDayMessages, loadNeonConversations]);

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

  // Load a previous conversation into the chat window
  const handleConversationSelect = useCallback((conversationId) => {
    const merged = mergeCurrentAndStoredMessages(messages, thirtyDayMessages);
    const convMessages = merged.filter(m => m.conversationId === conversationId);
    if (convMessages.length) {
      setMessages(convMessages.map(m => ({ ...m, isCurrent: true })));
    }
  }, [messages, thirtyDayMessages]);

  // Auto-scroll messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Save conversation to Neon after assistant responses
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
        await saveNeonConversation(messagesWithType);
        setLastSaveTime(new Date().toISOString());
      } catch (error) {
        console.error('Error saving conversation to Neon:', error);
      } finally {
        setIsSaving(false);
      }
    };

    save();
  }, [messages, user]);

  const handleSendMessage = useCallback(async () => {
    if (!inputMessage.trim() && !uploadedFile) return;
    if (cooldown > 0) return;

    setIsLoading(true);

    const displayContent = uploadedFile
      ? `${inputMessage}\n[Attached: ${uploadedFile.name}]`
      : inputMessage;

    const userMessage = {
      id: uuidv4(),
      role: 'user',
      type: 'user',
      content: displayContent,
      timestamp: Date.now(),
      resources: [],
    };

    // Add user's message immediately
    setMessages((prev) => [...prev, userMessage]);
    setInputMessage('');

    let fileToSend = uploadedFile;

    try {
      const response = ragEnabled && !fileToSend
        ? await ragSearch(inputMessage)
        : await openaiService.getChatResponse(inputMessage, fileToSend);

      const assistantMessage = {
        id: uuidv4(),
        role: 'assistant',
        type: 'ai',
        content: response.answer,
        timestamp: Date.now(),
        sources: response.sources || [],
        resources: response.resources || [],
      };

      setMessages((prev) => [...prev, assistantMessage]);

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
  }, [inputMessage, uploadedFile, ragEnabled, messages.length, refreshLearningSuggestions, cooldown]);

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
      const loaded = await loadNeonConversations(false);
      setThirtyDayMessages(loaded);
    } catch (error) {
      console.error('Error refreshing conversations from Neon:', error);
    }
    setLastSaveTime(new Date().toISOString());
    // Also refresh learning suggestions when conversations are refreshed
    if (FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS) {
      refreshLearningSuggestions();
    }
  }, [refreshLearningSuggestions, setThirtyDayMessages, loadNeonConversations]);

  const clearChat = useCallback(() => {
    setMessages([]);
    // Refresh suggestions when chat is cleared (might reveal different patterns)
    if (FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS) {
      setTimeout(() => {
        refreshLearningSuggestions();
      }, 500);
    }
  }, [refreshLearningSuggestions]);

  const clearAllConversations = useCallback(() => {
    setMessages([]);
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

  const handleExport = useCallback(() => {
    console.log('Exporting conversation', messages);
  }, [messages]);

  const handleExportSelected = useCallback(() => {
    console.log('Exporting selected messages', Array.from(selectedMessages));
  }, [selectedMessages]);

  const clearSelectedMessages = useCallback(() => setSelectedMessages(new Set()), []);

  const generateStudyNotes = useCallback(() => {
    if (selectedMessages.size === 0) return;
    setIsGeneratingNotes(true);
    try {
      console.log('Generating study notes', Array.from(selectedMessages));
    } finally {
      setIsGeneratingNotes(false);
    }
  }, [selectedMessages]);

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

  const handleShowRAGConfig = useCallback(() => setShowRAGConfig(true), []);
  const handleCloseRAGConfig = useCallback(() => setShowRAGConfig(false), []);
  const handleShowAdmin = useCallback(() => setShowAdmin(true), []);
  const handleCloseAdmin = useCallback(() => setShowAdmin(false), []);

  const handleLogoutComplete = useCallback(() => {
    setIsAuthenticated(false);
    setUser(null);
    setLearningSuggestions([]); // Clear suggestions on logout
  }, []);

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
          <div className="min-h-screen bg-gray-50">
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
            <div className="h-[calc(100vh-64px)]">
              {/* Mobile Layout (stacked vertically) */}
              <div className="lg:hidden h-full flex flex-col">
                {/* Chat takes most space on mobile */}
                <div className="flex-1 min-h-0 p-4">
                  <ChatArea
                    messages={messages}
                    inputMessage={inputMessage}
                    setInputMessage={setInputMessage}
                    isLoading={isLoading}
                    handleSendMessage={handleSendMessage}
                    handleKeyPress={handleKeyPress}
                    messagesEndRef={messagesEndRef}
                    ragEnabled={ragEnabled}
                    setRAGEnabled={setRAGEnabled}
                    isSaving={isSaving}
                    uploadedFile={uploadedFile}
                    setUploadedFile={setUploadedFile}
                    cooldown={cooldown}
                  />
                </div>

                {/* Sidebar is collapsible on mobile */}
                <div className="flex-shrink-0 border-t bg-white max-h-60 overflow-hidden">
                  <Sidebar
                    messages={messages}
                    thirtyDayMessages={thirtyDayMessages}
                    user={user}
                    learningSuggestions={learningSuggestions}
                    isLoadingSuggestions={isLoadingSuggestions}
                    onSuggestionsUpdate={handleSuggestionsUpdate}
                    onAddResource={handleAddResourceToNotebook}
                    onConversationSelect={handleConversationSelect}
                  />
                </div>
              </div>

              {/* Desktop Layout (side by side) */}
              <div className="hidden lg:flex h-full">
                {/* Chat Area - Takes majority of space */}
                <div className="flex-1 min-w-0 p-6">
                  <ChatArea
                    messages={messages}
                    inputMessage={inputMessage}
                    setInputMessage={setInputMessage}
                    isLoading={isLoading}
                    handleSendMessage={handleSendMessage}
                    handleKeyPress={handleKeyPress}
                    messagesEndRef={messagesEndRef}
                    ragEnabled={ragEnabled}
                    setRAGEnabled={setRAGEnabled}
                    isSaving={isSaving}
                    uploadedFile={uploadedFile}
                    setUploadedFile={setUploadedFile}
                    cooldown={cooldown}
                  />
                </div>

                {/* Sidebar - Fixed optimal width with enhanced learning features */}
                <div className="w-80 xl:w-96 flex-shrink-0 border-l bg-white p-6">
                  <Sidebar
                    messages={messages}
                    thirtyDayMessages={thirtyDayMessages}
                    user={user}
                    learningSuggestions={learningSuggestions}
                    isLoadingSuggestions={isLoadingSuggestions}
                    onSuggestionsUpdate={handleSuggestionsUpdate}
                    onAddResource={handleAddResourceToNotebook}
                    onConversationSelect={handleConversationSelect}
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
              exportNotebook={handleExport}
              onClose={() => setShowNotebook(false)}
            />
          )}

          {showSupport && (
            <SupportRequestOverlay
              user={user}
              onClose={() => setShowSupport(false)}
            />
          )}
        </>
      )}
    </ErrorBoundary>
  );
}

export default App;
