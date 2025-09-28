// src/services/neonService.js
// Remote conversation and resource persistence have been disabled.

class NeonService {
  constructor() {
    this.isInitialized = false;
    this.userId = null;
    this.cachedConversations = null;
  }

  async initialize(user) {
    this.userId = user?.sub || null;
    this.isInitialized = Boolean(this.userId);
    if (this.isInitialized) {
      console.info('Neon conversation storage disabled - initialization acknowledged for user:', this.userId);
    } else {
      console.info('Neon conversation storage disabled - no user provided.');
    }
    return this.isInitialized;
  }

  async saveConversation() {
    console.info('Neon conversation storage is disabled. Skipping save operation.');
    return { success: false, disabled: true };
  }

  async loadConversations() {
    console.info('Neon conversation storage is disabled. Returning empty history.');
    return [];
  }

  async clearConversations() {
    console.info('Neon conversation storage is disabled. Nothing to clear.');
    return { success: true, cleared: 0, disabled: true };
  }

  autoSaveConversation() {
    console.info('Neon auto-save is disabled.');
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
    // Service endpoints are intentionally disabled.
    return { ok: false, error: 'Conversation storage service is disabled.' };
  }

  async addTrainingResource() {
    console.info('Neon training resource storage is disabled.');
    return null;
  }

  async getTrainingResources() {
    console.info('Neon training resource storage is disabled. Returning empty list.');
    return [];
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

const neonService = new NeonService();

export default neonService;

export const initializeNeonService = (user) =>
  neonService.initialize(user);

export const saveConversation = (messages, metadata) =>
  neonService.saveConversation(messages, metadata);

export const loadConversations = (useCache = true) =>
  neonService.loadConversations(useCache);

export const clearConversations = () =>
  neonService.clearConversations();

export const autoSaveConversation = (messages, metadata) =>
  neonService.autoSaveConversation(messages, metadata);

export const getConversationStats = () =>
  neonService.getConversationStats();

export const isServiceAvailable = () =>
  neonService.isServiceAvailable();
