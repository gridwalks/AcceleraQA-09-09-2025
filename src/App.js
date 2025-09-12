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

// Utility
import { v4 as uuidv4 } from 'uuid';
import authService, { initializeAuth } from './services/authService';
import { search as ragSearch } from './services/ragService';
import openaiService from './services/openaiService';

import { initializeNeonService, loadConversations as loadNeonConversations, saveConversation as saveNeonConversation } from './services/neonService';

import { FEATURE_FLAGS } from './config/featureFlags';

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
  const isAdmin = useMemo(() => user?.roles?.includes('admin'), [user]);

  // Cooldown countdown
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

    let documentText = '';
    if (uploadedFile) {
      try {
        documentText = await uploadedFile.text();
      } catch (e) {
        console.error('Error reading file:', e);
      }
    }

    try {
      const response = ragEnabled && !documentText
        ? await ragSearch(inputMessage)
        : await openaiService.getChatResponse(inputMessage, documentText);

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
        }, 1000); //
