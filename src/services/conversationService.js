// src/services/conversationService.js - Updated for persistent Netlify Blob storage
import { getToken } from './authService';
import { deriveThreadIdAssignments } from '../utils/messageUtils';

const API_BASE_URL = '/.netlify/functions';

class ConversationService {
  constructor() {
    this.apiUrl = `${API_BASE_URL}/conversations-blob`;
    this.isInitialized = false;
    this.userId = null;
    this.cachedConversations = null;
    this.cacheKeyPrefix = 'acceleraqa_conversations_';
  }

  /**
   * Initialize the service with user authentication
   */
  async initialize(user) {
    if (user && user.sub) {
      this.userId = user.sub;
      this.isInitialized = true;
      console.log('ConversationService initialized for user:', this.userId);
    }
  }

  getCacheKey() {
    return `${this.cacheKeyPrefix}${this.userId}`;
  }

  /**
   * Make authenticated request to Netlify function
   */
  async makeAuthenticatedRequest(endpoint, options = {}) {
    try {
      // Get Auth0 token
      const token = await getToken();
      
      const defaultHeaders = {
        'Content-Type': 'application/json',
      };

      // Add user ID and authorization
      if (token) {
        defaultHeaders['Authorization'] = `Bearer ${token}`;
        
        // Extract user ID from token for header
        try {
          const tokenParts = token.split('.');
          if (tokenParts.length === 3) {
            const payload = JSON.parse(atob(tokenParts[1]));
            if (payload.sub) {
              defaultHeaders['x-user-id'] = payload.sub;
            }
          }
        } catch (parseError) {
          console.warn('Could not parse token for user ID:', parseError);
        }
      }

      // Fallback to stored user ID
      if (!defaultHeaders['x-user-id'] && this.userId) {
        defaultHeaders['x-user-id'] = this.userId;
      }

      const response = await fetch(endpoint, {
        ...options,
        headers: {
          ...defaultHeaders,
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  /**
   * Save a conversation to Netlify Blob storage
   * @param {Object[]} messages - Array of messages in the conversation
   * @param {Object} metadata - Optional metadata about the conversation
   * @returns {Promise<Object>} - Save result
   */
  async saveConversation(messages, metadata = {}) {
    if (!this.isInitialized) {
      throw new Error('ConversationService not initialized');
    }

    console.log('Saving conversation to Netlify Blob...', { 
      messageCount: messages.length,
      userId: this.userId 
    });
    
    try {
      // Filter out invalid messages
      const validMessages = messages
        .filter(msg =>
          msg && msg.id && (msg.type || msg.role) && msg.content && msg.timestamp
        )
        .map(msg => ({
          ...msg,
          type: msg.type || (msg.role === 'assistant' ? 'ai' : msg.role),
          role: msg.role || (msg.type === 'ai' ? 'assistant' : msg.type || 'user')
        }));

      if (validMessages.length === 0) {
        console.warn('No valid messages to save');
        return { success: false, error: 'No valid messages' };
      }

      const threadAssignments = deriveThreadIdAssignments(validMessages);
      const lastAssignment = threadAssignments[threadAssignments.length - 1] || null;
      const metadataConversationId = metadata?.conversationId || metadata?.threadId;
      const conversationIdCandidates = [
        metadataConversationId,
        ...validMessages
          .map(msg => msg.conversationId || msg.conversationThreadId || msg.threadId)
          .filter(Boolean),
        lastAssignment
      ].filter(Boolean);

      const resolvedConversationId = conversationIdCandidates[0] || `conv_${Date.now()}`;

      const normalizedMessages = validMessages.map((msg, index) => {
        const assignment = threadAssignments[index] || resolvedConversationId;
        return {
          id: msg.id,
          type: msg.type,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          resources: msg.resources || [],
          sources: msg.sources || [],
          isStudyNotes: msg.isStudyNotes || false,
          conversationId: msg.conversationId || assignment,
          conversationThreadId: msg.conversationThreadId || assignment,
          threadId: msg.threadId || assignment
        };
      });

      const targetThreadId = metadataConversationId || lastAssignment || resolvedConversationId;
      const threadMessages = normalizedMessages.filter((_, index) => {
        const assignment = threadAssignments[index] || resolvedConversationId;
        return assignment === targetThreadId;
      });

      const messagesToPersist = threadMessages.length > 0 ? threadMessages : normalizedMessages;

      // Analyze messages for RAG usage
      const ragMessages = messagesToPersist.filter(msg =>
        msg.sources && msg.sources.length > 0
      );

      const ragDocuments = [...new Set(
        ragMessages.flatMap(msg =>
          msg.sources?.map(source => source.documentId) || []
        )
      )];

      const payload = {
        conversationId: resolvedConversationId,
        messages: messagesToPersist,
        metadata: {
          ...metadata,
          topics: this.extractTopics(messagesToPersist),
          messageCount: messagesToPersist.length,
          lastActivity: new Date().toISOString(),
          ragUsed: ragMessages.length > 0,
          ragDocuments: ragDocuments,
          ragMessageCount: ragMessages.length,
          threadId: targetThreadId,
          conversationId: resolvedConversationId,
          sessionId: metadata?.sessionId || Date.now().toString(),
          userAgent: navigator.userAgent
        }
      };

      const result = await this.makeAuthenticatedRequest(this.apiUrl, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      console.log('Conversation saved successfully to Netlify Blob:', result);
      
      // Clear cached conversations to force reload
      this.cachedConversations = null;

      // Refresh local cache immediately for persistence
      try {
        await this.loadConversations(false);
      } catch (cacheError) {
        console.warn('Failed to refresh conversation cache:', cacheError);
      }

      return result;
    } catch (error) {
      console.error('Failed to save conversation to Netlify Blob:', error);
      throw new Error(`Failed to save conversation: ${error.message}`);
    }
  }

  /**
   * Load all conversations for the authenticated user from Netlify Blob
   * @param {boolean} useCache - Whether to use cached data if available
   * @returns {Promise<Object[]>} - Array of conversations converted to messages
   */
  async loadConversations(useCache = true) {
    if (!this.isInitialized) {
      console.warn('ConversationService not initialized, returning empty array');
      return [];
    }

    // Return cached conversations if available and cache is enabled
    if (useCache && this.cachedConversations) {
      console.log('Returning cached conversations:', this.cachedConversations.length);
      return this.cachedConversations;
    }

    console.log('Loading conversations from Netlify Blob for user:', this.userId);
    
    try {
      const result = await this.makeAuthenticatedRequest(this.apiUrl, {
        method: 'GET',
      });

      console.log(`Loaded ${result.total || 0} conversations from Netlify Blob`);
      
      // Convert server format back to message format
      const messages = this.conversationsToMessages(result.conversations || []);

      // Cache the results
      this.cachedConversations = messages;

      // Persist to local storage for offline access
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(this.getCacheKey(), JSON.stringify(messages));
        } catch (storageError) {
          console.warn('Failed to cache conversations locally:', storageError);
        }
      }

      return messages;
    } catch (error) {
      console.error('Failed to load conversations from Netlify Blob:', error);

      // Attempt to load conversations from local storage cache
      if (typeof localStorage !== 'undefined') {
        try {
          const stored = localStorage.getItem(this.getCacheKey());
          if (stored) {
            const messages = JSON.parse(stored);
            this.cachedConversations = messages;
            console.warn('Loaded conversations from local cache due to error');
            return messages;
          }
        } catch (storageError) {
          console.warn('Failed to load conversations from local cache:', storageError);
        }
      }

      // Return empty array instead of throwing to allow app to continue
      if (error.message.includes('401') || error.message.includes('authentication')) {
        console.warn('Authentication required for loading conversations');
        return [];
      }

      // For other errors, return empty array but log warning
      console.warn('Returning empty conversations due to error:', error.message);
      return [];
    }
  }

  /**
   * Delete all conversations for the authenticated user
   * @returns {Promise<Object>} - Deletion result
   */
  async clearConversations() {
    if (!this.isInitialized) {
      throw new Error('ConversationService not initialized');
    }

    console.log('Clearing all conversations from Netlify Blob for user:', this.userId);
    
    try {
      const result = await this.makeAuthenticatedRequest(this.apiUrl, {
        method: 'DELETE',
      });

      console.log('All conversations cleared successfully from Netlify Blob');

      // Clear cache
      this.cachedConversations = null;

      // Remove local cache
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.removeItem(this.getCacheKey());
        } catch (storageError) {
          console.warn('Failed to remove local conversation cache:', storageError);
        }
      }

      return result;
    } catch (error) {
      console.error('Failed to clear conversations from Netlify Blob:', error);
      throw new Error(`Failed to clear conversations: ${error.message}`);
    }
  }

  /**
   * Auto-save current conversation with debouncing
   * @param {Object[]} messages - Current conversation messages
   * @param {Object} metadata - Optional metadata
   */
  async autoSaveConversation(messages, metadata = {}) {
    if (!this.isInitialized || !messages || messages.length === 0) {
      return;
    }

    // Clear any existing auto-save timeout
    if (this.autoSaveTimeout) {
      clearTimeout(this.autoSaveTimeout);
    }

    // Debounce auto-save by 3 seconds
    this.autoSaveTimeout = setTimeout(async () => {
      try {
        // Only auto-save if we have a meaningful conversation
        const nonWelcomeMessages = messages.filter(msg => 
          !(msg.type === 'ai' && msg.content.includes('Welcome to AcceleraQA'))
        );

        if (nonWelcomeMessages.length >= 2) { // At least 1 user + 1 AI message
          console.log('Auto-saving conversation...');
          await this.saveConversation(messages, {
            ...metadata,
            autoSaved: true,
            autoSaveTime: new Date().toISOString()
          });
        }
      } catch (error) {
        console.warn('Auto-save failed:', error);
      }
    }, 3000); // 3 second delay
  }

  /**
   * Convert server conversation format to client message format
   * @param {Object[]} conversations - Server conversation objects
   * @returns {Object[]} - Array of messages
   */
  conversationsToMessages(conversations) {
    if (!Array.isArray(conversations)) {
      return [];
    }

    // Flatten all messages from all conversations
    const allMessages = conversations.flatMap(conversation => 
      (conversation.messages || []).map(msg => ({
        ...msg,
        isStored: true,
        isCurrent: false,
        conversationId: conversation.id,
        conversationCreated: conversation.created_at,
        ragUsed: conversation.used_rag || false,
        ragDocuments: conversation.rag_documents_referenced || []
      }))
    );

    // Sort by timestamp
    allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    console.log(`Converted ${conversations.length} conversations to ${allMessages.length} messages`);
    return allMessages;
  }

  /**
   * Extract topics from messages for metadata
   * @param {Object[]} messages - Array of messages
   * @returns {string[]} - Array of topics
   */
  extractTopics(messages) {
    const topics = new Set();
    
    messages.forEach(msg => {
      if (msg.type === 'user' && msg.content) {
        // Simple topic extraction from user messages
        const content = msg.content.toLowerCase();
        
        // Common pharmaceutical topics
        const pharmaTopics = [
          'gmp', 'gcp', 'glp', 'validation', 'capa', 'fda', 'ich', 
          'regulatory', 'compliance', 'quality', 'manufacturing',
          'clinical', 'laboratory', 'cfr', 'part 11', 'audit'
        ];
        
        pharmaTopics.forEach(topic => {
          if (content.includes(topic)) {
            topics.add(topic.toUpperCase());
          }
        });
      }
    });
    
    return Array.from(topics);
  }

  /**
   * Check if the service is available and user is authenticated
   * @returns {Promise<boolean>} - Whether service is available
   */
  async isServiceAvailable() {
    try {
      console.log('Checking conversation service availability...');
      
      // First try the test blob function
      const testResponse = await fetch('/.netlify/functions/test-blob', {
        method: 'GET'
      });
      
      if (!testResponse.ok) {
        console.warn('Test blob function not available:', testResponse.status);
        return false;
      }
      
      const testResult = await testResponse.json();
      console.log('Test blob function result:', testResult);
      
      if (!testResult.summary?.overallSuccess) {
        console.warn('Blob functionality not working properly:', testResult);
        return false;
      }
      
      // Now try the actual conversations endpoint
      const response = await this.makeAuthenticatedRequest(this.apiUrl, {
        method: 'GET',
      });
      
      console.log('Conversation service is available');
      return true;
    } catch (error) {
      console.warn('Conversation service not available:', error.message);
      return false;
    }
  }

  /**
   * Get conversation statistics including RAG usage
   * @returns {Promise<Object>} - Conversation statistics
   */
  async getConversationStats() {
    if (!this.isInitialized) {
      return this.getEmptyStats();
    }

    try {
      const result = await this.makeAuthenticatedRequest(`${this.apiUrl}/stats`, {
        method: 'GET',
      });

      return result.stats || this.getEmptyStats();
    } catch (error) {
      console.error('Failed to get conversation stats:', error);
      return this.getEmptyStats();
    }
  }

  /**
   * Get empty stats object
   * @returns {Object} - Empty statistics
   */
  getEmptyStats() {
    return {
      totalConversations: 0,
      totalMessages: 0,
      ragConversations: 0,
      ragUsagePercentage: 0,
      oldestConversation: null,
      newestConversation: null,
    };
  }

  /**
   * Get cache status
   * @returns {Object} - Cache information
   */
  getCacheStatus() {
    return {
      isInitialized: this.isInitialized,
      userId: this.userId,
      hasCachedConversations: !!this.cachedConversations,
      cachedMessageCount: this.cachedConversations?.length || 0,
      lastCacheTime: this.lastCacheTime || null
    };
  }

  /**
   * Cleanup method to clear timeouts and cache
   */
  cleanup() {
    if (this.autoSaveTimeout) {
      clearTimeout(this.autoSaveTimeout);
      this.autoSaveTimeout = null;
    }
    this.cachedConversations = null;
    this.isInitialized = false;
    this.userId = null;
  }
}

// Create singleton instance
const conversationService = new ConversationService();

export default conversationService;

// Export convenience functions
export const initializeConversationService = (user) => 
  conversationService.initialize(user);

export const saveConversation = (messages, metadata) => 
  conversationService.saveConversation(messages, metadata);

export const loadConversations = (useCache = true) => 
  conversationService.loadConversations(useCache);

export const clearConversations = () => 
  conversationService.clearConversations();

export const autoSaveConversation = (messages, metadata) => 
  conversationService.autoSaveConversation(messages, metadata);

export const getConversationStats = () =>
  conversationService.getConversationStats();
export const isServiceAvailable = () =>
  conversationService.isServiceAvailable();
