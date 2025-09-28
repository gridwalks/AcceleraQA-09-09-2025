// src/services/conversationService.js
// Conversation persistence has been disabled to prevent storing chat history.

class ConversationService {
  constructor() {
    this.isInitialized = false;
    this.userId = null;
    this.cachedConversations = null;
  }

  async initialize(user) {
    this.userId = user?.sub || null;
    this.isInitialized = Boolean(this.userId);
    if (this.isInitialized) {
      console.info('Conversation storage disabled - initialization acknowledged for user:', this.userId);
    } else {
      console.info('Conversation storage disabled - no user provided.');
    }
    return this.isInitialized;
  }

  getCacheKey() {
    return this.userId ? `disabled_conversations_${this.userId}` : 'disabled_conversations_anonymous';
  }

  async saveConversation() {
    console.info('Conversation storage is disabled. Skipping save operation.');
    return { success: false, disabled: true };
  }

  async loadConversations() {
    console.info('Conversation storage is disabled. Returning empty conversation history.');
    return [];
  }

  async clearConversations() {
    console.info('Conversation storage is disabled. Nothing to clear.');
    return { success: true, cleared: 0, disabled: true };
  }

  autoSaveConversation() {
    console.info('Conversation auto-save is disabled.');
    return null;
  }

  async getConversationStats() {
    return this.getEmptyStats();
  }

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

  async isServiceAvailable() {
    // Persistence endpoints are intentionally disabled.
    return false;
  }

  getCacheStatus() {
    return {
      isInitialized: this.isInitialized,
      userId: this.userId,
      hasCachedConversations: false,
      cachedMessageCount: 0,
      lastCacheTime: null,
    };
  }

  cleanup() {
    this.cachedConversations = null;
    this.isInitialized = false;
    this.userId = null;
  }
}

const conversationService = new ConversationService();

export default conversationService;

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
