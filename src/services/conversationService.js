// src/services/conversationService.js - Uses OpenAI Files API for persistence

const OPENAI_FILES_URL = 'https://api.openai.com/v1/files';

class ConversationService {
  constructor() {
    this.apiKey = process.env.REACT_APP_OPENAI_API_KEY;
    this.isInitialized = false;
    this.userId = null;
    this.cachedConversations = null;
  }

  async initialize(user) {
    if (this.apiKey) {
      this.isInitialized = true;
      this.userId = user?.sub || null;
      console.log('ConversationService initialized');
    }
  }

  async saveConversation(messages, metadata = {}) {
    if (!this.isInitialized) {
      throw new Error('ConversationService not initialized');
    }

    const validMessages = messages.filter(m => m && m.id && m.type && m.content && m.timestamp);
    if (validMessages.length === 0) {
      console.warn('No valid messages to save');
      return { success: false };
    }

    const payload = {
      messages: validMessages,
      metadata: {
        topics: this.extractTopics(validMessages),
        messageCount: validMessages.length,
        lastActivity: new Date().toISOString(),
        ...metadata,
      }
    };

    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const formData = new FormData();
    formData.append('purpose', 'assistants');
    formData.append('file', blob, `conversation-${Date.now()}.json`);

    const response = await fetch(OPENAI_FILES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to save conversation: ${response.statusText}`);
    }

    this.cachedConversations = null;
    return await response.json();
  }

  async loadConversations(useCache = true) {
    if (!this.isInitialized) {
      return [];
    }

    if (useCache && this.cachedConversations) {
      return this.cachedConversations;
    }

    const listResp = await fetch(`${OPENAI_FILES_URL}?purpose=assistants`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!listResp.ok) {
      console.error('Failed to list OpenAI files');
      return [];
    }
    const listData = await listResp.json();
    const conversationFiles = (listData.data || []).filter(f => f.filename.startsWith('conversation-'));

    const allMessages = [];
    for (const file of conversationFiles) {
      try {
        const contentResp = await fetch(`${OPENAI_FILES_URL}/${file.id}/content`, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        });
        if (!contentResp.ok) continue;
        const text = await contentResp.text();
        const conv = JSON.parse(text);
        const msgs = (conv.messages || []).map(m => ({
          ...m,
          conversationId: file.id,
          isStored: true,
          isCurrent: false,
        }));
        allMessages.push(...msgs);
      } catch (err) {
        console.warn('Failed to parse conversation file', file.filename, err);
      }
    }

    this.cachedConversations = allMessages;
    return allMessages;
  }

  async clearConversations() {
    if (!this.isInitialized) {
      throw new Error('ConversationService not initialized');
    }

    const listResp = await fetch(`${OPENAI_FILES_URL}?purpose=assistants`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!listResp.ok) {
      throw new Error('Failed to list conversations');
    }
    const data = await listResp.json();
    const conversationFiles = (data.data || []).filter(f => f.filename.startsWith('conversation-'));

    for (const file of conversationFiles) {
      await fetch(`${OPENAI_FILES_URL}/${file.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
    }

    this.cachedConversations = null;
    return { deleted: conversationFiles.length };
  }

  async autoSaveConversation(messages, metadata = {}) {
    if (!this.isInitialized || !messages || messages.length === 0) {
      return;
    }
    if (this.autoSaveTimeout) {
      clearTimeout(this.autoSaveTimeout);
    }
    this.autoSaveTimeout = setTimeout(() => {
      this.saveConversation(messages, { ...metadata, autoSaved: true }).catch(() => {});
    }, 3000);
  }

  async isServiceAvailable() {
    if (!this.apiKey) return false;
    try {
      const resp = await fetch(`${OPENAI_FILES_URL}?purpose=assistants`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async getConversationStats() {
    const messages = await this.loadConversations();
    const ids = new Set(messages.map(m => m.conversationId));
    return {
      totalConversations: ids.size,
      totalMessages: messages.length,
      ragConversations: 0,
      ragMessages: 0,
    };
  }

  getEmptyStats() {
    return {
      totalConversations: 0,
      totalMessages: 0,
      ragConversations: 0,
      ragMessages: 0,
    };
  }

  extractTopics(messages) {
    const topics = new Set();
    const pharmaTopics = [
      'gmp', 'gcp', 'glp', 'validation', 'capa', 'fda', 'ich',
      'regulatory', 'compliance', 'quality', 'manufacturing',
      'clinical', 'laboratory', 'cfr', 'part 11', 'audit'
    ];
    messages.forEach(msg => {
      if (msg.type === 'user' && msg.content) {
        const content = msg.content.toLowerCase();
        pharmaTopics.forEach(topic => {
          if (content.includes(topic)) {
            topics.add(topic.toUpperCase());
          }
        });
      }
    });
    return Array.from(topics);
  }
}

const conversationService = new ConversationService();
export default conversationService;
export const initializeConversationService = (user) => conversationService.initialize(user);
export const saveConversation = (messages, metadata) => conversationService.saveConversation(messages, metadata);
export const loadConversations = (useCache = true) => conversationService.loadConversations(useCache);
export const clearConversations = () => conversationService.clearConversations();
export const autoSaveConversation = (messages, metadata) => conversationService.autoSaveConversation(messages, metadata);
export const getConversationStats = () => conversationService.getConversationStats();
export const isServiceAvailable = () => conversationService.isServiceAvailable();
