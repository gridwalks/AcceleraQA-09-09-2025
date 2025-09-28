import { UI_CONFIG } from '../config/constants';

const getTimestampValue = (timestamp) => {
  if (timestamp == null) {
    return null;
  }

  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return timestamp;
  }

  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
};

const mergeResourceArrays = (existing = [], incoming = []) => {
  if (!Array.isArray(existing) || existing.length === 0) {
    return Array.isArray(incoming) ? incoming.filter(Boolean) : [];
  }

  if (!Array.isArray(incoming) || incoming.length === 0) {
    return existing.filter(Boolean);
  }

  const normalized = [...existing.filter(Boolean)];
  const seen = new Set();

  normalized.forEach((resource) => {
    if (!resource) {
      return;
    }

    if (resource.id) {
      seen.add(`id:${resource.id}`);
    }

    if (resource.url) {
      seen.add(`url:${resource.url}`);
    }

    if (resource.title) {
      seen.add(`title:${resource.title}`);
    }
  });

  incoming.forEach((resource) => {
    if (!resource) {
      return;
    }

    const candidates = [
      resource.id ? `id:${resource.id}` : null,
      resource.url ? `url:${resource.url}` : null,
      resource.title ? `title:${resource.title}` : null,
    ].filter(Boolean);

    const isDuplicate = candidates.some((candidate) => seen.has(candidate));

    if (!isDuplicate) {
      normalized.push(resource);
      candidates.forEach((candidate) => seen.add(candidate));
    }
  });

  return normalized;
};

/**
 * Filters messages from the specified number of days ago
 * @param {Object[]} messages - Array of message objects
 * @param {number} days - Number of days to look back (default: 30)
 * @returns {Object[]} - Filtered messages
 */
export function getMessagesByDays(messages, days = UI_CONFIG.MESSAGE_HISTORY_DAYS) {
  if (!messages || !Array.isArray(messages)) {
    if (process.env.NODE_ENV === 'development') {
      console.log('getMessagesByDays: Invalid input - not an array:', messages);
    }
    return [];
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  const result = messages.filter(msg => {
    if (!msg.timestamp) {
      if (process.env.NODE_ENV === 'development') {
        console.log('getMessagesByDays: Message missing timestamp:', msg);
      }
      return false;
    }
    const messageDate = new Date(msg.timestamp);
    const isValid = messageDate >= cutoffDate && !isNaN(messageDate.getTime());
    
    if (!isValid && process.env.NODE_ENV === 'development') {
      console.log('getMessagesByDays: Message filtered out:', {
        id: msg.id,
        timestamp: msg.timestamp,
        messageDate: messageDate.toString(),
        cutoffDate: cutoffDate.toString()
      });
    }
    
    return isValid;
  });
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`getMessagesByDays: Filtered ${messages.length} to ${result.length} messages within ${days} days`);
  }
  
  return result;
}

/**
 * Merges current session messages with stored messages, removing duplicates
 * @param {Object[]} currentMessages - Messages from current session
 * @param {Object[]} storedMessages - Messages from storage
 * @returns {Object[]} - Merged and deduplicated messages
 */
export function mergeCurrentAndStoredMessages(currentMessages, storedMessages) {
  if (!Array.isArray(currentMessages)) currentMessages = [];
  if (!Array.isArray(storedMessages)) storedMessages = [];
  
  // Debug logging
  if (process.env.NODE_ENV === 'development') {
    console.log('=== MERGE FUNCTION DEBUG ===');
    console.log('Current messages input:', currentMessages.length);
    console.log('Stored messages input:', storedMessages.length);
  }
  
  const messageMap = new Map();
  
  // Add stored messages first (mark them properly)
  storedMessages.forEach(msg => {
    if (msg && msg.id) {
      messageMap.set(msg.id, { 
        ...msg, 
        isStored: true, 
        isCurrent: false 
      });
    }
  });
  
  // Add current messages (will override any duplicates, mark as current)
  currentMessages.forEach(msg => {
    if (msg && msg.id) {
      messageMap.set(msg.id, { 
        ...msg, 
        isStored: false, 
        isCurrent: true 
      });
    }
  });
  
  // Convert back to array and sort by timestamp
  const result = Array.from(messageMap.values())
    .filter(msg => msg && msg.timestamp) // Ensure we have valid messages
    .sort((a, b) => {
      const dateA = new Date(a.timestamp);
      const dateB = new Date(b.timestamp);
      
      // Handle invalid dates
      if (isNaN(dateA.getTime())) return 1;
      if (isNaN(dateB.getTime())) return -1;
      
      return dateA - dateB;
    });
  
  // Debug logging
  if (process.env.NODE_ENV === 'development') {
    console.log('Merged result count:', result.length);
    console.log('Result breakdown:');
    console.log('- Current messages:', result.filter(m => m.isCurrent).length);
    console.log('- Stored messages:', result.filter(m => m.isStored && !m.isCurrent).length);
  }
  
  return result;
}

/**
 * Combines user and AI message pairs into conversation objects
 * @param {Object[]} messages - Array of message objects
 * @returns {Object[]} - Array of combined conversation objects
 */
export function combineMessagesIntoConversations(messages) {
  if (!messages || !Array.isArray(messages)) {
    return [];
  }

  const getType = (msg) => {
    const t = msg.type || msg.role;
    return t === 'assistant' ? 'ai' : t;
  };

  const resolveConversationId = (message, fallback) =>
    message?.conversationId ||
    message?.conversation?.id ||
    fallback ||
    null;

  return messages.reduce((acc, message, index, array) => {
    const messageType = getType(message);

    // Skip user messages that have a following AI message (they'll be combined)
    if (messageType === 'user' && index < array.length - 1 && getType(array[index + 1]) === 'ai') {
      return acc;
    }

    // Combine AI message with preceding user message
    if (messageType === 'ai' && index > 0 && getType(array[index - 1]) === 'user') {
      const userMessage = array[index - 1];
      const conversationId =
        resolveConversationId(message, null) ||
        resolveConversationId(userMessage, null);
      const combinedMessage = {
        id: `${userMessage.id}-${message.id}`,
        userContent: userMessage.content,
        aiContent: message.content,
        timestamp: message.timestamp,
        resources: message.resources || [],
        isStudyNotes: message.isStudyNotes || false,
        originalUserMessage: userMessage,
        originalAiMessage: message,
        // Preserve current session and stored flags
        isCurrent: message.isCurrent || userMessage.isCurrent || false,
        isStored: message.isStored && userMessage.isStored,
        conversationId,
      };
      acc.push(combinedMessage);
    }
    // Handle standalone AI messages (like welcome messages)
    else if (messageType === 'ai') {
      const conversationId = resolveConversationId(message, null);
      const combinedMessage = {
        id: message.id,
        userContent: null,
        aiContent: message.content,
        timestamp: message.timestamp,
        resources: message.resources || [],
        isStudyNotes: message.isStudyNotes || false,
        originalAiMessage: message,
        isCurrent: message.isCurrent || false,
        isStored: message.isStored || false,
        conversationId,
      };
      acc.push(combinedMessage);
    }
    // Handle standalone user messages (unlikely but possible)
    else if (messageType === 'user') {
      const conversationId = resolveConversationId(message, null);
      const combinedMessage = {
        id: message.id,
        userContent: message.content,
        aiContent: null,
        timestamp: message.timestamp,
        resources: [],
        isStudyNotes: false,
        originalUserMessage: message,
        isCurrent: message.isCurrent || false,
        isStored: message.isStored || false,
        conversationId,
      };
      acc.push(combinedMessage);
    }

    return acc;
  }, []);
}

const resolveConversationThreadId = (conversation) =>
  conversation?.originalAiMessage?.conversationId ||
  conversation?.originalUserMessage?.conversationId ||
  conversation?.conversationId ||
  conversation?.originalAiMessage?.conversation?.id ||
  conversation?.originalUserMessage?.conversation?.id ||
  null;

const resolveConversationTimestamp = (conversation) => {
  if (!conversation || typeof conversation !== 'object') {
    return null;
  }

  const directTimestamp = getTimestampValue(conversation.timestamp);
  if (directTimestamp != null) {
    return directTimestamp;
  }

  const aiTimestamp = getTimestampValue(conversation.originalAiMessage?.timestamp);
  if (aiTimestamp != null) {
    return aiTimestamp;
  }

  return getTimestampValue(conversation.originalUserMessage?.timestamp);
};

const normalizeConversationPreview = (conversation) => ({
  id: conversation.id,
  userContent: conversation.userContent,
  aiContent: conversation.aiContent,
  timestamp: conversation.timestamp,
  resources: Array.isArray(conversation.resources)
    ? conversation.resources.filter(Boolean)
    : [],
  isStudyNotes: Boolean(conversation.isStudyNotes),
  originalUserMessage: conversation.originalUserMessage,
  originalAiMessage: conversation.originalAiMessage,
  isCurrent: Boolean(conversation.isCurrent),
  isStored: Boolean(conversation.isStored),
  conversationId:
    conversation.conversationId ||
    conversation.originalAiMessage?.conversationId ||
    conversation.originalUserMessage?.conversationId ||
    conversation.originalAiMessage?.conversation?.id ||
    conversation.originalUserMessage?.conversation?.id ||
    null,
});

const resolveThreadFlags = (messages = []) => {
  const flags = {
    isCurrent: false,
    isStored: false,
  };

  messages.forEach((message) => {
    if (!message) {
      return;
    }

    if (
      message.isCurrent ||
      message.originalAiMessage?.isCurrent ||
      message.originalUserMessage?.isCurrent
    ) {
      flags.isCurrent = true;
    }

    if (
      message.isStored ||
      message.originalAiMessage?.isStored ||
      message.originalUserMessage?.isStored
    ) {
      flags.isStored = true;
    }
  });

  return flags;
};

const buildThreadMessages = (existingMessages = [], nextMessage) => {
  const validExisting = Array.isArray(existingMessages)
    ? existingMessages.filter(Boolean)
    : [];

  if (!nextMessage || !nextMessage.id) {
    return [...validExisting];
  }

  const messageMap = new Map();

  validExisting.forEach((message) => {
    if (message?.id && !messageMap.has(message.id)) {
      messageMap.set(message.id, message);
    }
  });

  messageMap.set(nextMessage.id, nextMessage);

  return Array.from(messageMap.values()).sort((a, b) => {
    const timeA = resolveConversationTimestamp(a) ?? -Infinity;
    const timeB = resolveConversationTimestamp(b) ?? -Infinity;
    return timeA - timeB;
  });
};

export function groupConversationsByThread(conversations) {
  if (!Array.isArray(conversations) || conversations.length === 0) {
    return [];
  }

  const threads = new Map();

  conversations.forEach((conversation) => {
    if (!conversation) {
      return;
    }

    const threadId = resolveConversationThreadId(conversation);
    const normalizedConversation = normalizeConversationPreview(conversation);
    const timestampValue = resolveConversationTimestamp(normalizedConversation);

    if (!threadId) {
      const existing = threads.get(normalizedConversation.id);
      const nextMessages = buildThreadMessages(existing?.threadMessages, normalizedConversation);
      const latestMessage = nextMessages[nextMessages.length - 1] || normalizedConversation;
      const latestTimestamp = resolveConversationTimestamp(latestMessage) ?? timestampValue ?? -Infinity;
      const threadFlags = resolveThreadFlags(nextMessages);

      threads.set(normalizedConversation.id, {
        ...latestMessage,
        id: normalizedConversation.id,
        conversationCount: nextMessages.length || 1,
        sortTimestamp: latestTimestamp,
        resources: nextMessages.reduce(
          (acc, message) => mergeResourceArrays(acc, message.resources),
          []
        ),
        threadMessages: nextMessages,
        isCurrent: threadFlags.isCurrent,
        isStored: threadFlags.isStored,
      });
      return;
    }

    const existing = threads.get(threadId);
    if (!existing) {
      const threadMessages = buildThreadMessages([], normalizedConversation);
      const threadFlags = resolveThreadFlags(threadMessages);
      threads.set(threadId, {
        ...normalizedConversation,
        id: threadId,
        sortTimestamp: timestampValue ?? -Infinity,
        conversationCount: threadMessages.length,
        resources: normalizedConversation.resources || [],
        threadMessages,
        isCurrent: threadFlags.isCurrent,
        isStored: threadFlags.isStored,
      });
      return;
    }

    const mergedResources = mergeResourceArrays(existing.resources, normalizedConversation.resources);
    const nextThreadMessages = buildThreadMessages(existing.threadMessages, normalizedConversation);
    const latestMessage = nextThreadMessages[nextThreadMessages.length - 1] || normalizedConversation;
    const latestTimestamp = resolveConversationTimestamp(latestMessage) ?? existing.sortTimestamp ?? timestampValue ?? -Infinity;
    const threadFlags = resolveThreadFlags(nextThreadMessages);

    threads.set(threadId, {
      ...latestMessage,
      id: threadId,
      sortTimestamp: latestTimestamp,
      conversationCount: nextThreadMessages.length,
      resources: mergedResources,
      threadMessages: nextThreadMessages,
      isCurrent: threadFlags.isCurrent,
      isStored: threadFlags.isStored,
    });
  });

  return Array.from(threads.values())
    .map((conversation) => {
      const { sortTimestamp, ...rest } = conversation;
      return rest;
    })
    .sort((a, b) => {
      const timeA = resolveConversationTimestamp(a) ?? -Infinity;
      const timeB = resolveConversationTimestamp(b) ?? -Infinity;
      return timeB - timeA;
    });
}

/**
 * Gets recent conversations limited to display maximum
 * @param {Object[]} messages - Array of message objects
 * @returns {Object[]} - Array of recent conversations
 */
export function getRecentConversations(messages) {
  const recentMessages = getMessagesByDays(messages);
  const conversations = combineMessagesIntoConversations(recentMessages);
  return conversations.slice(-UI_CONFIG.MAX_DISPLAYED_CONVERSATIONS);
}

/**
 * Builds sanitized chat history for sending to AI services
 * @param {Object[]} messages - Array of message objects
 * @returns {Object[]} - Sanitized history with role/content pairs
 */
export function buildChatHistory(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter(msg => {
      if (!msg || typeof msg !== 'object') {
        return false;
      }

      if (msg.isResource || msg.isStudyNotes || msg.isLocalOnly) {
        return false;
      }

      const role = msg.role || (msg.type === 'ai' ? 'assistant' : msg.type === 'user' ? 'user' : null);
      return role === 'user' || role === 'assistant';
    })
    .map(msg => {
      const role = msg.role || (msg.type === 'ai' ? 'assistant' : 'user');
      let content = msg.content;

      if (Array.isArray(content)) {
        content = content.join(' ');
      } else if (content == null) {
        content = '';
      } else if (typeof content !== 'string') {
        content = String(content);
      }

      const trimmed = typeof content === 'string' ? content.trim() : '';
      if (!trimmed) {
        return null;
      }

      return { role, content: trimmed };
    })
    .filter(Boolean);
}

/**
 * Separates conversations into current session and stored
 * @param {Object[]} conversations - Array of conversation objects
 * @returns {Object} - Object with current and stored conversation arrays
 */
export function separateCurrentAndStoredConversations(conversations) {
  const current = conversations.filter(conv => conv.isCurrent);
  const stored = conversations.filter(conv => !conv.isCurrent);
  
  return { current, stored };
}

/**
 * Searches messages by content
 * @param {Object[]} messages - Array of message objects
 * @param {string} searchTerm - Search term
 * @returns {Object[]} - Filtered messages
 */
export function searchMessages(messages, searchTerm) {
  if (!messages || !searchTerm || searchTerm.trim() === '') {
    return messages;
  }

  const lowerSearchTerm = searchTerm.toLowerCase();
  
  return messages.filter(msg => 
    msg.content && msg.content.toLowerCase().includes(lowerSearchTerm)
  );
}

/**
 * Gets messages with study notes
 * @param {Object[]} messages - Array of message objects
 * @returns {Object[]} - Messages that are study notes
 */
export function getStudyNotes(messages) {
  if (!messages || !Array.isArray(messages)) {
    return [];
  }

  return messages.filter(msg => msg.isStudyNotes === true);
}

/**
 * Gets messages with resources
 * @param {Object[]} messages - Array of message objects
 * @returns {Object[]} - Messages that have resources
 */
export function getMessagesWithResources(messages) {
  if (!messages || !Array.isArray(messages)) {
    return [];
  }

  return messages.filter(msg => 
    msg.resources && Array.isArray(msg.resources) && msg.resources.length > 0
  );
}

/**
 * Creates a new message object with validation
 * @param {string} type - Message type ('user' or 'ai')
 * @param {string} content - Message content
 * @param {Object[]} resources - Optional resources array
 * @param {boolean} isStudyNotes - Whether this is a study notes message
 * @returns {Object} - New message object
 */
export function createMessage(type, content, resources = [], isStudyNotes = false) {
  if (!type || !content) {
    throw new Error('Message type and content are required');
  }

  if (type !== 'user' && type !== 'ai') {
    throw new Error('Message type must be "user" or "ai"');
  }

  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('Message content must be a non-empty string');
  }

  // Generate a more unique ID that includes timestamp and random component
  const timestamp = new Date().toISOString();
  const randomComponent = Math.random().toString(36).substring(2, 15);
  const id = `msg_${Date.now()}_${randomComponent}`;

  const role = type === 'ai' ? 'assistant' : 'user';

  return {
    id,
    type,
    role,
    content: content.trim(),
    timestamp,
    resources: Array.isArray(resources) ? resources : [],
    isStudyNotes: Boolean(isStudyNotes),
    isCurrent: true, // Mark as current session message
    isStored: false, // Not yet stored
    // Add version for future migrations
    version: '1.0.0'
  };
}

/**
 * Enhanced message validation for storage compatibility
 * @param {Object} message - Message object to validate
 * @returns {boolean} - Whether the message is valid
 */
export function validateMessage(message) {
  if (!message || typeof message !== 'object') {
    return false;
  }

  // Required fields for all messages
  const requiredFields = ['id', 'type', 'content', 'timestamp'];
  const hasRequiredFields = requiredFields.every(field => 
    message.hasOwnProperty(field) && message[field] != null
  );

  if (!hasRequiredFields) {
    return false;
  }

  // Validate message type
  if (message.type !== 'user' && message.type !== 'ai') {
    return false;
  }

  if (message.role && message.role !== 'user' && message.role !== 'assistant') {
    return false;
  }

  // Validate content
  if (typeof message.content !== 'string' || message.content.trim() === '') {
    return false;
  }

  // Validate timestamp
  const date = new Date(message.timestamp);
  if (isNaN(date.getTime())) {
    return false;
  }

  // Validate resources array if present
  if (message.resources && !Array.isArray(message.resources)) {
    return false;
  }

  // Validate resources structure if present
  if (message.resources && Array.isArray(message.resources)) {
    const invalidResource = message.resources.find(resource => {
      if (!resource || typeof resource !== 'object') return true;
      if (!resource.title || !resource.url || !resource.type) return true;
      if (typeof resource.title !== 'string' || typeof resource.url !== 'string' || typeof resource.type !== 'string') return true;
      return false;
    });
    
    if (invalidResource) {
      return false;
    }
  }

  // Validate study notes data if present
  if (message.studyNotesData && typeof message.studyNotesData !== 'object') {
    return false;
  }

  // Check for reasonable content length (prevent storage abuse)
  if (message.content.length > 50000) {
    console.warn('Message content exceeds reasonable length limit');
    return false;
  }

  return true;
}

/**
 * Repairs a message object by fixing common issues
 * @param {Object} message - Message object to repair
 * @returns {Object|null} - Repaired message or null if unrepairable
 */
export function repairMessage(message) {
  if (!message || typeof message !== 'object') {
    return null;
  }

  try {
    const repaired = { ...message };

    // Fix missing ID
    if (!repaired.id) {
      const timestamp = repaired.timestamp || new Date().toISOString();
      const randomComponent = Math.random().toString(36).substring(2, 8);
      repaired.id = `repaired_${Date.now()}_${randomComponent}`;
    }

    // Fix invalid type
    if (repaired.type !== 'user' && repaired.type !== 'ai') {
      // Try to guess type based on content or other indicators
      if (repaired.content && repaired.content.includes('Welcome to AcceleraQA')) {
        repaired.type = 'ai';
      } else {
        repaired.type = 'user'; // Default to user
      }
    }

    if (!repaired.role || (repaired.role !== 'user' && repaired.role !== 'assistant')) {
      repaired.role = repaired.type === 'ai' ? 'assistant' : 'user';
    }

    // Fix missing or empty content by attempting to recover from fallbacks
    let repairedContent = repaired.content;

    if (Array.isArray(repairedContent)) {
      repairedContent = repairedContent
        .map(part => {
          if (typeof part === 'string') {
            return part.trim();
          }

          if (part == null) {
            return '';
          }

          try {
            return JSON.stringify(part);
          } catch (jsonError) {
            return String(part);
          }
        })
        .filter(Boolean)
        .join(' ')
        .trim();
    } else if (repairedContent != null && typeof repairedContent !== 'string') {
      repairedContent = String(repairedContent).trim();
    } else if (typeof repairedContent === 'string') {
      repairedContent = repairedContent.trim();
    }

    if (!repairedContent) {
      const fallbackFields = ['message', 'text', 'body', 'answer', 'summary'];

      for (const field of fallbackFields) {
        const value = repaired[field];

        if (Array.isArray(value)) {
          const joined = value
            .map(part => (typeof part === 'string' ? part.trim() : String(part || '')))
            .filter(Boolean)
            .join(' ')
            .trim();

          if (joined) {
            repairedContent = joined;
            break;
          }
        } else if (typeof value === 'string' && value.trim()) {
          repairedContent = value.trim();
          break;
        } else if (value != null && value !== '') {
          const coerced = String(value).trim();
          if (coerced) {
            repairedContent = coerced;
            break;
          }
        }
      }
    }

    if (!repairedContent) {
      console.warn('repairMessage: Unable to recover content, skipping message');
      return null;
    }

    repaired.content = repairedContent;

    // Fix missing timestamp
    if (!repaired.timestamp || isNaN(new Date(repaired.timestamp).getTime())) {
      repaired.timestamp = new Date().toISOString();
    }

    // Fix resources array
    if (!Array.isArray(repaired.resources)) {
      repaired.resources = [];
    }

    // Fix boolean fields
    repaired.isStudyNotes = Boolean(repaired.isStudyNotes);

    // Add session tracking flags if missing
    if (repaired.isCurrent === undefined) {
      repaired.isCurrent = false;
    }
    if (repaired.isStored === undefined) {
      repaired.isStored = true; // Assume repaired messages are from storage
    }

    // Add version if missing
    if (!repaired.version) {
      repaired.version = '1.0.0';
    }

    // Validate the repaired message
    if (validateMessage(repaired)) {
      return repaired;
    } else {
      console.warn('Could not repair message:', message);
      return null;
    }

  } catch (error) {
    console.error('Error repairing message:', error);
    return null;
  }
}

/**
 * Batch validates and repairs an array of messages
 * @param {Object[]} messages - Array of messages to process
 * @returns {Object[]} - Array of valid messages
 */
export function validateAndRepairMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  const validMessages = [];

  messages.forEach((message, index) => {
    if (validateMessage(message)) {
      validMessages.push(message);
    } else {
      console.warn(`Invalid message at index ${index}, attempting repair...`);
      const repairedMessage = repairMessage(message);
      if (repairedMessage) {
        console.log(`Successfully repaired message at index ${index}`);
        validMessages.push(repairedMessage);
      } else {
        console.error(`Could not repair message at index ${index}, skipping`);
      }
    }
  });

  return validMessages;
}

/**
 * Sanitizes message content for display
 * @param {string} content - Message content
 * @returns {string} - Sanitized content
 */
export function sanitizeMessageContent(content) {
  if (!content || typeof content !== 'string') {
    return '';
  }

  return content
    .trim()
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .replace(/\n\s*\n\s*\n/g, '\n\n'); // Replace multiple newlines with double newline
}

/**
 * Gets message statistics including current vs stored breakdown
 * @param {Object[]} messages - Array of message objects
 * @returns {Object} - Message statistics
 */
export function getMessageStats(messages) {
  if (!messages || !Array.isArray(messages)) {
    return {
      total: 0,
      userMessages: 0,
      aiMessages: 0,
      studyNotes: 0,
      withResources: 0,
      conversations: 0,
      currentSession: 0,
      stored: 0,
      oldestMessage: null,
      newestMessage: null,
      averageContentLength: 0,
      totalContentLength: 0
    };
  }

  const userMessages = messages.filter(msg => msg.type === 'user');
  const aiMessages = messages.filter(msg => msg.type === 'ai');
  const studyNotes = messages.filter(msg => msg.isStudyNotes);
  const withResources = messages.filter(msg => 
    msg.resources && Array.isArray(msg.resources) && msg.resources.length > 0
  );
  const currentSession = messages.filter(msg => msg.isCurrent);
  const stored = messages.filter(msg => msg.isStored);
  const conversations = combineMessagesIntoConversations(messages);

  const totalContentLength = messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
  const averageContentLength = messages.length > 0 ? Math.round(totalContentLength / messages.length) : 0;

  // Find oldest and newest messages
  const timestamps = messages.map(msg => new Date(msg.timestamp)).filter(date => !isNaN(date.getTime()));
  const oldestMessage = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null;
  const newestMessage = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;

  return {
    total: messages.length,
    userMessages: userMessages.length,
    aiMessages: aiMessages.length,
    studyNotes: studyNotes.length,
    withResources: withResources.length,
    conversations: conversations.length,
    currentSession: currentSession.length,
    stored: stored.length,
    oldestMessage,
    newestMessage,
    averageContentLength,
    totalContentLength
  };
}

/**
 * Truncates message content for display in lists
 * @param {string} content - Message content
 * @param {number} maxLength - Maximum length (default: 100)
 * @returns {string} - Truncated content
 */
export function truncateContent(content, maxLength = 100) {
  if (!content || typeof content !== 'string') {
    return '';
  }

  if (content.length <= maxLength) {
    return content;
  }

  return content.substring(0, maxLength - 3) + '...';
}

/**
 * Groups messages by date for display purposes
 * @param {Object[]} messages - Array of message objects
 * @returns {Object} - Messages grouped by date
 */
export function groupMessagesByDate(messages) {
  if (!messages || !Array.isArray(messages)) {
    return {};
  }

  return messages.reduce((groups, message) => {
    if (!message.timestamp) return groups;
    
    const date = new Date(message.timestamp);
    if (isNaN(date.getTime())) return groups;
    
    const dateKey = date.toDateString();
    
    if (!groups[dateKey]) {
      groups[dateKey] = [];
    }
    
    groups[dateKey].push(message);
    return groups;
  }, {});
}

/**
 * Finds messages containing specific keywords
 * @param {Object[]} messages - Array of message objects
 * @param {string[]} keywords - Keywords to search for
 * @returns {Object[]} - Messages containing keywords
 */
export function findMessagesByKeywords(messages, keywords) {
  if (!messages || !Array.isArray(messages) || !keywords || !Array.isArray(keywords)) {
    return [];
  }

  const lowerKeywords = keywords.map(keyword => keyword.toLowerCase());

  return messages.filter(message => {
    if (!message.content) return false;
    
    const lowerContent = message.content.toLowerCase();
    return lowerKeywords.some(keyword => lowerContent.includes(keyword));
  });
}

/**
 * Deduplicates messages based on ID
 * @param {Object[]} messages - Array of message objects
 * @returns {Object[]} - Deduplicated messages
 */
export function deduplicateMessages(messages) {
  if (!messages || !Array.isArray(messages)) {
    return [];
  }

  const seen = new Set();
  return messages.filter(message => {
    if (!message.id) return false;
    
    if (seen.has(message.id)) {
      return false;
    }
    
    seen.add(message.id);
    return true;
  });
}

/**
 * Gets conversations that match the current session
 * @param {Object[]} conversations - Array of conversation objects
 * @param {Set} currentMessageIds - Set of current message IDs
 * @returns {Object[]} - Current session conversations
 */
export function getCurrentSessionConversations(conversations, currentMessageIds) {
  if (!conversations || !Array.isArray(conversations) || !currentMessageIds) {
    return [];
  }

  return conversations.filter(conv => {
    // Check if any message in this conversation is from current session
    if (conv.originalUserMessage && currentMessageIds.has(conv.originalUserMessage.id)) return true;
    if (conv.originalAiMessage && currentMessageIds.has(conv.originalAiMessage.id)) return true;
    return false;
  });
}
