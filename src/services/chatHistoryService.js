// Chat History Service - Handles capturing, storing, and retrieving chat histories
import { combineMessagesIntoConversations } from '../utils/messageUtils';

class ChatHistoryService {
  constructor() {
    this.storageKey = 'acceleraqa_chat_histories';
    this.maxHistories = 50; // Limit to prevent storage bloat
  }

  /**
   * Captures the current chat session as a history entry
   * @param {Array} messages - Current chat messages
   * @param {Object} user - User object
   * @param {string} title - Optional custom title for the history
   * @returns {Object} - The created history entry
   */
  captureCurrentChat(messages, user, title = null) {
    if (!messages || messages.length === 0) {
      throw new Error('No messages to capture');
    }

    if (!user?.sub) {
      throw new Error('User authentication required');
    }

    // Filter out resource messages and combine into conversations
    const chatMessages = messages.filter(msg => !msg.isResource);
    const conversations = combineMessagesIntoConversations(chatMessages);
    
    if (conversations.length === 0) {
      throw new Error('No valid conversations found');
    }

    // Generate title from first user message if not provided
    const firstConversation = conversations[0];
    const autoTitle = this.generateTitle(firstConversation);
    const finalTitle = title || autoTitle;

    // Create history entry
    const historyEntry = {
      id: `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: finalTitle,
      capturedAt: new Date().toISOString(),
      userId: user.sub,
      messageCount: chatMessages.length,
      conversationCount: conversations.length,
      conversations: conversations,
      metadata: {
        captureSource: 'manual',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        version: '1.0.0'
      }
    };

    // Save to storage
    this.saveHistory(historyEntry);

    return historyEntry;
  }

  /**
   * Generates a title from the conversation content
   * @param {Object} conversation - First conversation object
   * @returns {string} - Generated title
   */
  generateTitle(conversation) {
    if (!conversation) return 'Untitled Chat';

    const userContent = conversation.userContent || '';
    const aiContent = conversation.aiContent || '';

    // Try to extract a meaningful title from user's first message
    if (userContent) {
      const firstSentence = userContent.split(/[.!?]/)[0].trim();
      if (firstSentence.length > 10 && firstSentence.length <= 60) {
        return firstSentence;
      }
      
      // Fallback to first 50 characters
      if (userContent.length <= 50) {
        return userContent;
      }
      return userContent.substring(0, 47) + '...';
    }

    // Fallback to AI content if no user content
    if (aiContent) {
      const firstSentence = aiContent.split(/[.!?]/)[0].trim();
      if (firstSentence.length > 10 && firstSentence.length <= 60) {
        return `Response: ${firstSentence}`;
      }
      return `Response: ${aiContent.substring(0, 40)}...`;
    }

    return `Chat from ${new Date().toLocaleDateString()}`;
  }

  /**
   * Saves a history entry to localStorage
   * @param {Object} historyEntry - History entry to save
   */
  saveHistory(historyEntry) {
    try {
      const existingHistories = this.getAllHistories();
      
      // Add new history at the beginning
      existingHistories.unshift(historyEntry);
      
      // Limit the number of histories
      const limitedHistories = existingHistories.slice(0, this.maxHistories);
      
      localStorage.setItem(this.storageKey, JSON.stringify(limitedHistories));
    } catch (error) {
      console.error('Failed to save chat history:', error);
      throw new Error('Failed to save chat history to storage');
    }
  }

  /**
   * Retrieves all chat histories for the current user
   * @param {string} userId - User ID to filter by
   * @returns {Array} - Array of history entries
   */
  getAllHistories(userId = null) {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return [];
      
      const allHistories = JSON.parse(stored);
      
      // Filter by user ID if provided
      if (userId) {
        return allHistories.filter(history => history.userId === userId);
      }
      
      return allHistories;
    } catch (error) {
      console.error('Failed to load chat histories:', error);
      return [];
    }
  }

  /**
   * Gets a specific history entry by ID
   * @param {string} historyId - History entry ID
   * @returns {Object|null} - History entry or null if not found
   */
  getHistoryById(historyId) {
    const histories = this.getAllHistories();
    return histories.find(history => history.id === historyId) || null;
  }

  /**
   * Deletes a history entry
   * @param {string} historyId - History entry ID to delete
   * @returns {boolean} - Success status
   */
  deleteHistory(historyId) {
    try {
      const histories = this.getAllHistories();
      const filteredHistories = histories.filter(history => history.id !== historyId);
      
      localStorage.setItem(this.storageKey, JSON.stringify(filteredHistories));
      return true;
    } catch (error) {
      console.error('Failed to delete chat history:', error);
      return false;
    }
  }

  /**
   * Updates the title of a history entry
   * @param {string} historyId - History entry ID
   * @param {string} newTitle - New title
   * @returns {boolean} - Success status
   */
  updateHistoryTitle(historyId, newTitle) {
    try {
      const histories = this.getAllHistories();
      const historyIndex = histories.findIndex(history => history.id === historyId);
      
      if (historyIndex === -1) return false;
      
      histories[historyIndex].title = newTitle;
      histories[historyIndex].metadata.lastModified = new Date().toISOString();
      
      localStorage.setItem(this.storageKey, JSON.stringify(histories));
      return true;
    } catch (error) {
      console.error('Failed to update chat history title:', error);
      return false;
    }
  }

  /**
   * Converts a history entry to a resource-like format for display in resource center
   * @param {Object} historyEntry - History entry
   * @returns {Object} - Resource-formatted history entry
   */
  historyToResource(historyEntry) {
    const conversationSummary = this.getConversationSummary(historyEntry.conversations);
    
    return {
      id: historyEntry.id,
      title: historyEntry.title,
      type: 'Chat History',
      description: conversationSummary,
      url: null, // No external URL
      metadata: {
        ...historyEntry.metadata,
        capturedAt: historyEntry.capturedAt,
        messageCount: historyEntry.messageCount,
        conversationCount: historyEntry.conversationCount,
        historyId: historyEntry.id
      },
      origin: 'Chat History',
      location: 'Local Storage',
      tag: 'history'
    };
  }

  /**
   * Generates a summary of conversations for display
   * @param {Array} conversations - Array of conversation objects
   * @returns {string} - Summary text
   */
  getConversationSummary(conversations) {
    if (!conversations || conversations.length === 0) {
      return 'Empty conversation';
    }

    const firstConv = conversations[0];
    const userContent = firstConv.userContent || '';
    const aiContent = firstConv.aiContent || '';
    
    // Create a brief summary
    let summary = '';
    if (userContent) {
      const userPreview = userContent.length > 80 
        ? userContent.substring(0, 77) + '...' 
        : userContent;
      summary += `Q: ${userPreview}`;
    }
    
    if (aiContent && summary.length < 120) {
      const remainingLength = 150 - summary.length;
      const aiPreview = aiContent.length > remainingLength 
        ? aiContent.substring(0, remainingLength - 3) + '...' 
        : aiContent;
      summary += summary ? ` | A: ${aiPreview}` : `A: ${aiPreview}`;
    }
    
    if (conversations.length > 1) {
      summary += ` (+${conversations.length - 1} more exchanges)`;
    }
    
    return summary || 'Conversation content not available';
  }

  /**
   * Clears all chat histories (with confirmation)
   * @returns {boolean} - Success status
   */
  clearAllHistories() {
    try {
      localStorage.removeItem(this.storageKey);
      return true;
    } catch (error) {
      console.error('Failed to clear chat histories:', error);
      return false;
    }
  }

  /**
   * Gets storage usage information
   * @returns {Object} - Storage info
   */
  getStorageInfo() {
    try {
      const histories = this.getAllHistories();
      const storageSize = new Blob([localStorage.getItem(this.storageKey) || '']).size;
      
      return {
        count: histories.length,
        maxCount: this.maxHistories,
        storageSize: storageSize,
        storageSizeFormatted: this.formatBytes(storageSize)
      };
    } catch (error) {
      return {
        count: 0,
        maxCount: this.maxHistories,
        storageSize: 0,
        storageSizeFormatted: '0 B'
      };
    }
  }

  /**
   * Converts a chat history back to individual messages for loading into chat area
   * @param {Object} historyEntry - History entry to convert
   * @returns {Array} - Array of individual messages
   */
  historyToMessages(historyEntry) {
    if (!historyEntry || !historyEntry.conversations) {
      return [];
    }

    const messages = [];
    
    historyEntry.conversations.forEach((conversation, convIndex) => {
      // Add user message if it exists
      if (conversation.userContent) {
        const userMessage = conversation.originalUserMessage || {
          id: `loaded_user_${historyEntry.id}_${convIndex}_${Date.now()}`,
          type: 'user',
          role: 'user',
          content: conversation.userContent,
          timestamp: conversation.timestamp || historyEntry.capturedAt,
          isCurrent: true,
          isStored: false,
          isFromHistory: true,
          historyId: historyEntry.id
        };
        messages.push(userMessage);
      }

      // Add AI message if it exists
      if (conversation.aiContent) {
        const aiMessage = conversation.originalAiMessage || {
          id: `loaded_ai_${historyEntry.id}_${convIndex}_${Date.now()}`,
          type: 'ai',
          role: 'assistant',
          content: conversation.aiContent,
          timestamp: conversation.timestamp || historyEntry.capturedAt,
          resources: conversation.resources || [],
          sources: conversation.sources || [],
          isCurrent: true,
          isStored: false,
          isFromHistory: true,
          historyId: historyEntry.id
        };
        messages.push(aiMessage);
      }
    });

    // Sort messages by timestamp to maintain conversation order
    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return messages;
  }

  /**
   * Formats bytes to human readable format
   * @param {number} bytes - Bytes to format
   * @returns {string} - Formatted string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// Create and export singleton instance
const chatHistoryService = new ChatHistoryService();
export default chatHistoryService;
