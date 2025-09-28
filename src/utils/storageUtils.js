import { UI_CONFIG, APP_CONFIG } from '../config/constants';
import {
  validateMessage,
  repairMessage,
  deriveThreadIdAssignments,
  mergeCurrentAndStoredMessages,
  combineMessagesIntoConversations,
  groupConversationsByThread,
} from './messageUtils';

// Storage keys and configuration
const STORAGE_KEYS = {
  MESSAGES: 'acceleraqa_messages',
  USER_PREFIX: 'acceleraqa_user_',
  METADATA: 'acceleraqa_metadata',
  VERSION: 'acceleraqa_storage_version'
};

const STORAGE_CONFIG = {
  VERSION: '1.0.0',
  MAX_MESSAGES_PER_USER: 1000,
  CLEANUP_THRESHOLD: 0.8, // Clean up when 80% of quota is used
  COMPRESSION_ENABLED: true
};

/**
 * Checks if localStorage is available and functional
 * @returns {boolean} - Whether localStorage is available
 */
export function isStorageAvailable() {
  try {
    const test = '__storage_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch (error) {
    console.warn('localStorage not available:', error);
    return false;
  }
}

/**
 * Gets the storage key for a specific user
 * @param {string} userId - User identifier
 * @returns {string} - Storage key
 */
function getUserStorageKey(userId) {
  if (!userId) {
    throw new Error('User ID is required for storage operations');
  }
  
  // Sanitize user ID for use as storage key
  const sanitizedUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${STORAGE_KEYS.USER_PREFIX}${sanitizedUserId}`;
}

/**
 * Compresses data for storage (simple JSON stringification with size tracking)
 * @param {any} data - Data to compress
 * @returns {string} - Compressed data string
 */
function compressData(data) {
  if (!STORAGE_CONFIG.COMPRESSION_ENABLED) {
    return JSON.stringify(data);
  }

  try {
    // Simple compression: remove unnecessary whitespace and sort keys
    const compressed = JSON.stringify(data, Object.keys(data).sort());
    return compressed;
  } catch (error) {
    console.error('Error compressing data:', error);
    return JSON.stringify(data);
  }
}

/**
 * Decompresses data from storage
 * @param {string} compressedData - Compressed data string
 * @returns {any} - Decompressed data
 */
function decompressData(compressedData) {
  try {
    return JSON.parse(compressedData);
  } catch (error) {
    console.error('Error decompressing data:', error);
    throw new Error('Failed to parse stored data');
  }
}

/**
 * Gets storage usage information
 * @returns {Object} - Storage usage stats
 */
export function getStorageUsage() {
  if (!isStorageAvailable()) {
    return { used: 0, available: 0, percentage: 0 };
  }

  try {
    let used = 0;
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        used += localStorage[key].length + key.length;
      }
    }

    // Approximate localStorage limit (varies by browser, typically 5-10MB)
    const approximateLimit = 5 * 1024 * 1024; // 5MB
    const percentage = (used / approximateLimit) * 100;

    return {
      used,
      available: approximateLimit - used,
      percentage: Math.min(percentage, 100)
    };
  } catch (error) {
    console.error('Error calculating storage usage:', error);
    return { used: 0, available: 0, percentage: 0 };
  }
}

/**
 * Validates the structure of stored data
 * @param {Object} data - Data to validate
 * @returns {boolean} - Whether data is valid
 */
export function validateStorageData(data) {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const requiredFields = ['version', 'userId', 'lastSaved'];
  const hasRequiredFields = requiredFields.every(field =>
    Object.prototype.hasOwnProperty.call(data, field)
  );

  if (!hasRequiredFields) {
    return false;
  }

  const hasMessagesArray = Array.isArray(data.messages);
  const hasThreadsArray = Array.isArray(data.threads);

  if (!hasMessagesArray && !hasThreadsArray) {
    return false;
  }

  return true;
}

function buildThreadSnapshotsForStorage(messages) {
  const toTimestampValue = (value) => {
    if (value == null) {
      return null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const safeMessages = Array.isArray(messages) ? messages.filter(Boolean) : [];
  if (!safeMessages.length) {
    return [];
  }

  const normalizedMessages = mergeCurrentAndStoredMessages([], safeMessages);
  const combined = combineMessagesIntoConversations(normalizedMessages);
  const grouped = groupConversationsByThread(combined);

  const resolveIsoTimestamp = (conversation) => {
    if (!conversation) {
      return null;
    }

    const candidates = [
      conversation.timestamp,
      conversation.originalAiMessage?.timestamp,
      conversation.originalUserMessage?.timestamp,
    ];

    const timestampValue = candidates
      .map(toTimestampValue)
      .find((value) => value != null);

    return timestampValue != null ? new Date(timestampValue).toISOString() : null;
  };

  return grouped
    .map((thread) => {
      const threadMessages = Array.isArray(thread.threadMessages) ? thread.threadMessages : [];

      const sortedMessages = threadMessages
        .slice()
        .sort((a, b) => {
          const timeA = toTimestampValue(a.timestamp) ?? toTimestampValue(a.originalAiMessage?.timestamp) ?? toTimestampValue(a.originalUserMessage?.timestamp);
          const timeB = toTimestampValue(b.timestamp) ?? toTimestampValue(b.originalAiMessage?.timestamp) ?? toTimestampValue(b.originalUserMessage?.timestamp);
          return (timeA ?? Infinity) - (timeB ?? Infinity);
        });

      const firstMessage = sortedMessages[0] || null;
      const lastMessage = sortedMessages.length
        ? sortedMessages[sortedMessages.length - 1]
        : null;

      return {
        id: thread.threadId || thread.conversationId || thread.id,
        conversationId: thread.conversationId || thread.threadId || thread.id,
        threadId: thread.threadId || thread.conversationId || thread.id,
        conversationCount: thread.conversationCount || threadMessages.length,
        messageCount: threadMessages.length,
        resources: thread.resources || [],
        messages: threadMessages,
        firstTimestamp: resolveIsoTimestamp(firstMessage),
        lastTimestamp: resolveIsoTimestamp(lastMessage),
        isCurrent: thread.isCurrent,
        isStored: thread.isStored,
      };
    })
    .sort((a, b) => {
      const timeA = a.lastTimestamp ? toTimestampValue(a.lastTimestamp) : -Infinity;
      const timeB = b.lastTimestamp ? toTimestampValue(b.lastTimestamp) : -Infinity;
      return timeB - timeA;
    });
}

/**
 * FIXED: Enhanced message loading with better error handling
 * @param {string} userId - User identifier
 * @returns {Promise<Object[]>} - Loaded messages or empty array
 */
export async function loadMessagesFromStorage(userId) {
  console.log('=== LOADING MESSAGES FROM STORAGE ===');
  console.log('User ID:', userId);
  
  if (!isStorageAvailable()) {
    console.warn('Storage not available, returning empty messages');
    return [];
  }

  try {
    if (!userId) {
      throw new Error('User ID is required');
    }
    
    const storageKey = getUserStorageKey(userId);
    console.log('Storage key:', storageKey);
    
    const storedData = localStorage.getItem(storageKey);
    console.log('Raw stored data exists:', !!storedData);
    console.log('Raw stored data length:', storedData?.length || 0);
    
    if (!storedData) {
      console.log(`No stored data found for user ${userId}`);
      return [];
    }
    
    const data = decompressData(storedData);
    console.log('Decompressed data:', data);
    
    // ENHANCED: Handle different data formats that might be stored
    let messages = [];

    if (Array.isArray(data)) {
      // Old format: data is directly an array of messages
      console.log('Found old format - array of messages');
      messages = data;
    } else if (Array.isArray(data.threads)) {
      console.log('Found threaded storage format');
      messages = data.threads.flatMap((thread) => {
        const threadId = thread?.id || thread?.threadId || thread?.thread_id || null;
        const threadMessages = Array.isArray(thread?.messages) ? thread.messages : [];
        return threadMessages.map((msg) => ({
          ...msg,
          threadId: msg.threadId || msg.conversationThreadId || threadId || null,
          conversationThreadId: msg.conversationThreadId || msg.threadId || threadId || null,
          conversationId: msg.conversationId || threadId || null,
        }));
      });
    } else if (data.messages && Array.isArray(data.messages)) {
      // Newer format: data is an object with messages array
      console.log('Found message array format inside object');
      messages = data.messages;
    } else {
      console.warn('Unknown data format:', data);
      return [];
    }

    console.log('Raw messages found:', messages.length);
    console.log('Sample messages:', messages.slice(0, 2).map(m => ({
      id: m?.id,
      type: m?.type,
      content: m?.content?.substring(0, 50) + '...',
      timestamp: m?.timestamp
    })));
    
    // FIXED: Better message validation and repair
    const validMessages = [];

    messages.forEach((msg, index) => {
      if (!msg || typeof msg !== 'object') {
        console.log(`Skipping invalid message at index ${index}:`, msg);
        return;
      }

      if (Object.keys(msg).length === 1 && msg.version) {
        console.log(`Skipping version-only record at index ${index}:`, msg);
        return;
      }

      if (validateMessage(msg)) {
        validMessages.push({
          ...msg,
          role: msg.role || (msg.type === 'ai' ? 'assistant' : 'user'),
          isStored: true,
          isCurrent: false
        });
      } else {
        console.warn(`Invalid message at index ${index}, attempting repair:`, msg);
        const repairedMessage = repairMessage(msg);
        if (repairedMessage) {
          console.log(`Successfully repaired message at index ${index}`);
          validMessages.push({
            ...repairedMessage,
            role: repairedMessage.role || (repairedMessage.type === 'ai' ? 'assistant' : 'user'),
            isStored: true,
            isCurrent: false
          });
        } else {
          console.error(`Could not repair message at index ${index}, skipping`);
        }
      }
    });
    
    console.log(`Successfully loaded ${validMessages.length} valid messages out of ${messages.length} total`);
    console.log('Valid messages sample:', validMessages.slice(0, 2).map(m => ({
      id: m.id,
      type: m.type,
      content: m.content.substring(0, 50) + '...',
      timestamp: m.timestamp
    })));
    
    return validMessages;
    
  } catch (error) {
    console.error('Error loading messages from storage:', error);
    console.error('Error stack:', error.stack);
    
    // If there's corrupted data, try to clear it and return empty array
    try {
      const storageKey = getUserStorageKey(userId);
      console.log('Attempting to clear corrupted data...');
      localStorage.removeItem(storageKey);
      console.log('Corrupted data cleared');
    } catch (clearError) {
      console.error('Error clearing corrupted data:', clearError);
    }
    
    return [];
  }
}

/**
 * Validates and filters messages before storage - FIXED VERSION
 * @param {Object[]} messages - Messages to validate
 * @returns {Object[]} - Valid messages
 */
function validateMessagesForStorage(messages) {
  if (!Array.isArray(messages)) {
    console.warn('Messages is not an array, converting to empty array');
    return [];
  }
  
  console.log('=== VALIDATING MESSAGES FOR STORAGE ===');
  console.log('Input messages:', messages.length);
  console.log('Sample input:', messages.slice(0, 2).map(m => ({
    id: m?.id,
    type: m?.type,
    content: m?.content?.substring(0, 50) + '...',
    hasRequiredFields: !!(m?.id && m?.type && m?.content)
  })));
  
  const validMessages = messages.filter((msg, index) => {
    // CRITICAL FIX: Check if this is a version-only object
    if (msg && typeof msg === 'object' && Object.keys(msg).length === 1 && msg.version) {
      console.log(`Skipping version-only object at index ${index}:`, msg);
      return false;
    }
    
    if (!validateMessage(msg)) {
      console.warn(`Invalid message found at index ${index}, skipping:`, msg);
      return false;
    }
    return true;
  });
  
  console.log('Valid messages after filtering:', validMessages.length);
  console.log('Valid messages sample:', validMessages.slice(0, 2).map(m => ({
    id: m.id,
    type: m.type,
    content: m.content.substring(0, 50) + '...'
  })));
  
  const { assignments: threadAssignments } = deriveThreadIdAssignments(validMessages);

  return validMessages.map((msg, index) => {
    const threadId = threadAssignments[index] || msg.threadId || msg.conversationThreadId || null;
    const canonicalConversationId = msg.conversationId || threadId || null;

    return {
      ...msg,
      role: msg.role || (msg.type === 'ai' ? 'assistant' : 'user'),
      conversationId: canonicalConversationId,
      threadId,
      conversationThreadId: msg.conversationThreadId || threadId || null,
    };
  });
}

/**
 * Saves messages to localStorage for a specific user
 * @param {string} userId - User identifier  
 * @param {Object[]} messages - Messages to save
 * @returns {Promise<boolean>} - Success status
 */
export async function saveMessagesToStorage(userId, messages) {
  if (!isStorageAvailable()) {
    console.warn('Storage not available, messages not saved');
    return false;
  }

  try {
    // Validate input
    if (!userId) {
      throw new Error('User ID is required');
    }
    
    const validMessages = validateMessagesForStorage(messages);
    const storageKey = getUserStorageKey(userId);
    
    console.log(`Saving ${validMessages.length} messages to storage for user ${userId}`);
    
    // Check storage usage and cleanup if needed
    const usage = getStorageUsage();
    if (usage.percentage > STORAGE_CONFIG.CLEANUP_THRESHOLD * 100) {
      console.log('Storage usage high, performing cleanup...');
      cleanupOldMessages(userId);
    }
    
    const threads = buildThreadSnapshotsForStorage(validMessages);

    // Prepare data for storage
    const storageData = {
      version: STORAGE_CONFIG.VERSION,
      userId,
      messages: validMessages,
      threads,
      threadCount: threads.length,
      lastSaved: new Date().toISOString(),
      messageCount: validMessages.length,
      appVersion: APP_CONFIG.VERSION
    };
    
    // Save to localStorage
    const compressedData = compressData(storageData);
    localStorage.setItem(storageKey, compressedData);
    
    // Update metadata
    updateStorageMetadata(userId, validMessages.length);
    
    console.log(`Successfully saved ${validMessages.length} messages for user ${userId}`);
    return true;
    
  } catch (error) {
    console.error('Error saving messages to storage:', error);
    
    // If quota exceeded, try cleanup and retry once
    if (error.name === 'QuotaExceededError') {
      try {
        console.log('Quota exceeded, attempting cleanup and retry...');
        cleanupOldMessages(userId, Math.floor(STORAGE_CONFIG.MAX_MESSAGES_PER_USER * 0.5));
        
        // Retry with fewer messages
        const reducedMessages = messages.slice(-Math.floor(STORAGE_CONFIG.MAX_MESSAGES_PER_USER * 0.5));
        return await saveMessagesToStorage(userId, reducedMessages);
      } catch (retryError) {
        console.error('Retry failed:', retryError);
      }
    }
    
    return false;
  }
}

/**
 * Cleans up old messages to free storage space
 * @param {string} userId - User identifier
 * @param {number} maxMessages - Maximum messages to keep
 */
function cleanupOldMessages(userId, maxMessages = STORAGE_CONFIG.MAX_MESSAGES_PER_USER) {
  try {
    const storageKey = getUserStorageKey(userId);
    const storedData = localStorage.getItem(storageKey);
    
    if (!storedData) return;
    
    const data = decompressData(storedData);
    const messages = Array.isArray(data.messages) ? data.messages : [];
    
    if (messages.length <= maxMessages) return;
    
    console.log(`Cleaning up old messages: ${messages.length} -> ${maxMessages}`);
    
    // Keep the most recent messages
    const recentMessages = messages
      .slice()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, maxMessages);

    const normalizedRecent = recentMessages.map((msg) => ({
      ...msg,
      conversationId: msg.conversationId || msg.threadId || msg.conversationThreadId || null,
      threadId: msg.threadId || msg.conversationThreadId || msg.conversationId || null,
      conversationThreadId: msg.conversationThreadId || msg.threadId || msg.conversationId || null,
    }));

    const { assignments: cleanupAssignments } = deriveThreadIdAssignments(normalizedRecent);

    const recentWithThreads = normalizedRecent.map((msg, index) => {
      const threadId = cleanupAssignments[index] || msg.threadId || msg.conversationThreadId || msg.conversationId || null;
      const conversationId = msg.conversationId || threadId || null;
      return {
        ...msg,
        threadId,
        conversationId,
        conversationThreadId: msg.conversationThreadId || threadId || null,
      };
    });

    const cleanedThreads = buildThreadSnapshotsForStorage(recentWithThreads);

    // Save cleaned data
    const cleanedData = {
      ...data,
      messages: recentWithThreads,
      threads: cleanedThreads,
      lastCleanup: new Date().toISOString(),
      cleanupCount: (data.cleanupCount || 0) + 1
    };

    localStorage.setItem(storageKey, compressData(cleanedData));
    console.log(`Cleanup completed: removed ${messages.length - maxMessages} old messages`);
    
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

/**
 * Updates storage metadata for tracking
 * @param {string} userId - User identifier
 * @param {number} messageCount - Number of messages
 */
function updateStorageMetadata(userId, messageCount) {
  try {
    const metadata = JSON.parse(localStorage.getItem(STORAGE_KEYS.METADATA) || '{}');
    
    metadata[userId] = {
      messageCount,
      lastUpdated: new Date().toISOString(),
      version: STORAGE_CONFIG.VERSION
    };
    
    localStorage.setItem(STORAGE_KEYS.METADATA, JSON.stringify(metadata));
  } catch (error) {
    console.error('Error updating storage metadata:', error);
  }
}

/**
 * Clears all storage data for a specific user
 * @param {string} userId - User identifier
 * @returns {Promise<boolean>} - Success status
 */
export async function clearStorageData(userId) {
  if (!isStorageAvailable()) {
    return true; // Consider it successful if storage isn't available
  }

  try {
    if (!userId) {
      throw new Error('User ID is required');
    }
    
    const storageKey = getUserStorageKey(userId);
    localStorage.removeItem(storageKey);
    
    // Update metadata
    try {
      const metadata = JSON.parse(localStorage.getItem(STORAGE_KEYS.METADATA) || '{}');
      delete metadata[userId];
      localStorage.setItem(STORAGE_KEYS.METADATA, JSON.stringify(metadata));
    } catch (metaError) {
      console.warn('Error updating metadata during clear:', metaError);
    }
    
    console.log(`Successfully cleared storage data for user ${userId}`);
    return true;
    
  } catch (error) {
    console.error('Error clearing storage data:', error);
    return false;
  }
}

/**
 * Gets storage statistics for all users
 * @returns {Object} - Storage statistics
 */
export function getStorageStats() {
  if (!isStorageAvailable()) {
    return { totalUsers: 0, totalMessages: 0, usage: { used: 0, available: 0, percentage: 0 } };
  }

  try {
    const metadata = JSON.parse(localStorage.getItem(STORAGE_KEYS.METADATA) || '{}');
    const users = Object.keys(metadata);
    const totalMessages = users.reduce((total, userId) => {
      return total + (metadata[userId].messageCount || 0);
    }, 0);
    
    return {
      totalUsers: users.length,
      totalMessages,
      usage: getStorageUsage(),
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error getting storage stats:', error);
    return { totalUsers: 0, totalMessages: 0, usage: { used: 0, available: 0, percentage: 0 } };
  }
}

/**
 * Migrates old storage format to new format
 * @param {Object} oldData - Old format data
 * @returns {Promise<Object|null>} - Migrated data or null if migration failed
 */
export async function migrateOldStorageFormat(oldData) {
  try {
    console.log('Attempting to migrate old storage format...');
    
    // Handle different old formats
    let messages = [];
    
    if (oldData.messages && Array.isArray(oldData.messages)) {
      messages = oldData.messages;
    } else if (Array.isArray(oldData)) {
      // Very old format where data was just an array of messages
      messages = oldData;
    } else {
      console.warn('Unable to migrate old storage format');
      return null;
    }
    
    // Validate migrated messages
    const validMessages = validateMessagesForStorage(messages);
    
    console.log(`Migration successful: ${validMessages.length} messages migrated`);
    
    return {
      version: STORAGE_CONFIG.VERSION,
      messages: validMessages,
      migrated: true,
      migratedAt: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Error during migration:', error);
    return null;
  }
}

/**
 * Performs maintenance on storage (cleanup, optimization)
 * @param {string} userId - User identifier (optional, if not provided, maintains all users)
 * @returns {Promise<Object>} - Maintenance results
 */
export async function performStorageMaintenance(userId = null) {
  const results = {
    cleaned: 0,
    errors: 0,
    totalUsers: 0,
    freedSpace: 0,
    startTime: new Date().toISOString()
  };
  
  try {
    if (!isStorageAvailable()) {
      throw new Error('Storage not available');
    }
    
    const metadata = JSON.parse(localStorage.getItem(STORAGE_KEYS.METADATA) || '{}');
    const usersToMaintain = userId ? [userId] : Object.keys(metadata);
    
    results.totalUsers = usersToMaintain.length;
    
    for (const user of usersToMaintain) {
      try {
        const beforeUsage = getStorageUsage();
        cleanupOldMessages(user);
        const afterUsage = getStorageUsage();
        
        results.cleaned++;
        results.freedSpace += (beforeUsage.used - afterUsage.used);
        
      } catch (error) {
        console.error(`Error maintaining storage for user ${user}:`, error);
        results.errors++;
      }
    }
    
    results.endTime = new Date().toISOString();
    console.log('Storage maintenance completed:', results);
    
    return results;
    
  } catch (error) {
    console.error('Error during storage maintenance:', error);
    results.errors++;
    results.endTime = new Date().toISOString();
    return results;
  }
}

/**
 * Checks storage health and provides recommendations
 * @returns {Object} - Storage health report
 */
export function getStorageHealthReport() {
  const report = {
    isHealthy: true,
    issues: [],
    recommendations: [],
    stats: null,
    timestamp: new Date().toISOString()
  };
  
  try {
    if (!isStorageAvailable()) {
      report.isHealthy = false;
      report.issues.push('localStorage is not available');
      report.recommendations.push('Check browser settings and ensure cookies/storage are enabled');
      return report;
    }
    
    const usage = getStorageUsage();
    const stats = getStorageStats();
    report.stats = { usage, ...stats };
    
    // Check storage usage
    if (usage.percentage > 90) {
      report.isHealthy = false;
      report.issues.push('Storage usage is critically high (>90%)');
      report.recommendations.push('Clear old conversations or export important data');
    } else if (usage.percentage > 70) {
      report.issues.push('Storage usage is getting high (>70%)');
      report.recommendations.push('Consider exporting old conversations to free up space');
    }
    
    // Check for potential corruption
    try {
      const metadata = JSON.parse(localStorage.getItem(STORAGE_KEYS.METADATA) || '{}');
      const userCount = Object.keys(metadata).length;
      
      if (userCount > 10) {
        report.issues.push(`Large number of users stored (${userCount})`);
        report.recommendations.push('Consider implementing user-based cleanup policies');
      }
    } catch (error) {
      report.isHealthy = false;
      report.issues.push('Storage metadata is corrupted');
      report.recommendations.push('Clear storage and re-initialize');
    }
    
    // Performance recommendations
    if (stats.totalMessages > 500) {
      report.recommendations.push('Consider implementing message pagination for better performance');
    }
    
    return report;
    
  } catch (error) {
    console.error('Error generating storage health report:', error);
    report.isHealthy = false;
    report.issues.push('Failed to generate health report');
    return report;
  }
}
