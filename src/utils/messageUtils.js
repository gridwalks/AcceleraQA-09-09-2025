import { UI_CONFIG } from '../config/constants';

const DEFAULT_THREAD_GAP_MS = 1000 * 60 * 30; // 30 minutes

const getTimestampValue = (timestamp) => {
  if (timestamp == null) return null;

  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) return timestamp;

  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
};

const resolveMessageType = (msg) => {
  if (!msg || typeof msg !== 'object') {
    return null;
  }

  const type = msg.type || msg.role;

  if (type === 'assistant') {
    return 'ai';
  }

  if (type === 'system') {
    return 'system';
  }

  return type || null;
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
    if (!resource) return;
    if (resource.id) seen.add(`id:${resource.id}`);
    if (resource.url) seen.add(`url:${resource.url}`);
    if (resource.title) seen.add(`title:${resource.title}`);
  });

  incoming.forEach((resource) => {
    if (!resource) return;

    const candidates = [
      resource.id ? `id:${resource.id}` : null,
      resource.url ? `url:${resource.url}` : null,
      resource.title ? `title:${resource.title}` : null,
    ].filter(Boolean);

    const isDuplicate = candidates.some((c) => seen.has(c));
    if (!isDuplicate) {
      normalized.push(resource);
      candidates.forEach((c) => seen.add(c));
    }
  });

  return normalized;
};

/**
 * Filters messages from the specified number of days ago
 * @param {Object[]} messages - Array of message objects
 * @param {number} days - Number of days to look back (default from UI_CONFIG)
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

  const result = messages.filter((msg) => {
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
        cutoffDate: cutoffDate.toString(),
      });
    }

    return isValid;
  });

  if (process.env.NODE_ENV === 'development') {
    console.log(
      `getMessagesByDays: Filtered ${messages.length} to ${result.length} messages within ${days} days`
    );
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
  const safeCurrent = Array.isArray(currentMessages)
    ? currentMessages.filter(Boolean)
    : [];
  const safeStored = Array.isArray(storedMessages)
    ? storedMessages.filter(Boolean)
    : [];

  if (process.env.NODE_ENV === 'development') {
    console.log('=== MERGE FUNCTION DEBUG ===');
    console.log('Current messages input:', safeCurrent.length);
    console.log('Stored messages input:', safeStored.length);
  }

  const messageMap = new Map();

  const assignMessage = (message, { isCurrentMessage }) => {
    if (!message || typeof message !== 'object') {
      return;
    }

    const key = getMessageMergeKey(message) || `generated:${messageMap.size}`;
    const existing = messageMap.get(key);

    const mergedFlags = {
      isCurrent: isCurrentMessage || Boolean(message.isCurrent) || Boolean(existing?.isCurrent),
      isStored: (!isCurrentMessage && (message.isStored ?? true)) || Boolean(existing?.isStored),
    };

    messageMap.set(key, {
      ...(existing || {}),
      ...message,
      id: message.id || existing?.id || key,
      ...mergedFlags,
    });
  };

  safeStored.forEach((msg) => assignMessage(msg, { isCurrentMessage: false }));
  safeCurrent.forEach((msg) => assignMessage(msg, { isCurrentMessage: true }));

  const sortedMessages = Array.from(messageMap.values())
    .filter((msg) => msg && msg.timestamp)
    .sort((a, b) => {
      const dateA = new Date(a.timestamp);
      const dateB = new Date(b.timestamp);

      if (Number.isNaN(dateA.getTime())) return 1;
      if (Number.isNaN(dateB.getTime())) return -1;

      return dateA - dateB;
    });

  const { assignments: mergeAssignments } = deriveThreadIdAssignments(sortedMessages);

  const normalizedMessages = sortedMessages.map((message, index) => {
    const assignedThreadId =
      mergeAssignments[index] || message.threadId || message.conversationThreadId || null;
    const canonicalConversationId =
      message.conversationId || message.conversation?.id || assignedThreadId || null;

    return {
      ...message,
      conversationId: canonicalConversationId,
      threadId: assignedThreadId || canonicalConversationId,
      conversationThreadId: message.conversationThreadId || assignedThreadId || canonicalConversationId,
    };
  });

  if (process.env.NODE_ENV === 'development') {
    console.log('Merged result count:', normalizedMessages.length);
    console.log('Result breakdown:');
    console.log('- Current messages:', normalizedMessages.filter((m) => m.isCurrent).length);
    console.log('- Stored messages:', normalizedMessages.filter((m) => m.isStored && !m.isCurrent).length);
  }

  return normalizedMessages;
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

  const { assignments: threadAssignments } = deriveThreadIdAssignments(messages);

  const resolveConversationId = (message, fallback) =>
    message?.conversationId || message?.conversation?.id || fallback || null;

  const resolveThreadIdForIndex = (idx) => threadAssignments[idx] || null;

  return messages.reduce((acc, message, index, array) => {
    const messageType = resolveMessageType(message);

    // Skip user messages that have a following AI message (they'll be combined)
    if (
      messageType === 'user' &&
      index < array.length - 1 &&
      resolveMessageType(array[index + 1]) === 'ai'
    ) {
      return acc;
    }

    // Combine AI message with preceding user message
    if (messageType === 'ai' && index > 0 && resolveMessageType(array[index - 1]) === 'user') {
      const userMessage = array[index - 1];
      const threadId = resolveThreadIdForIndex(index) || resolveThreadIdForIndex(index - 1);
      const conversationId =
        resolveConversationId(message, null) || resolveConversationId(userMessage, null) || threadId;

      const normalizedThreadId = threadId || conversationId || null;

      const normalizedUserMessage = userMessage
        ? {
            ...userMessage,
            conversationId: resolveConversationId(userMessage, conversationId),
            threadId: normalizedThreadId,
            conversationThreadId: normalizedThreadId,
          }
        : null;

      const normalizedAiMessage = {
        ...message,
        conversationId: resolveConversationId(message, conversationId),
        threadId: normalizedThreadId,
        conversationThreadId: normalizedThreadId,
      };

      const combinedMessage = {
        id: `${userMessage.id}-${message.id}`,
        userContent: userMessage.content,
        aiContent: message.content,
        timestamp: message.timestamp,
        resources: message.resources || [],
        isStudyNotes: message.isStudyNotes || false,
        originalUserMessage: normalizedUserMessage,
        originalAiMessage: normalizedAiMessage,
        // Preserve current session and stored flags
        isCurrent: message.isCurrent || userMessage.isCurrent || false,
        isStored: message.isStored && userMessage.isStored,
        conversationId,
        threadId: normalizedThreadId,
        conversationThreadId: normalizedThreadId,
      };

      acc.push(combinedMessage);
    }
    // Handle standalone AI messages (like welcome messages)
    else if (messageType === 'ai') {
      const threadId = resolveThreadIdForIndex(index);
      const conversationId = resolveConversationId(message, threadId);
      const normalizedThreadId = threadId || conversationId || null;

      const normalizedAiMessage = {
        ...message,
        conversationId,
        threadId: normalizedThreadId,
        conversationThreadId: normalizedThreadId,
      };

      const combinedMessage = {
        id: message.id,
        userContent: null,
        aiContent: message.content,
        timestamp: message.timestamp,
        resources: message.resources || [],
        isStudyNotes: message.isStudyNotes || false,
        originalAiMessage: normalizedAiMessage,
        isCurrent: message.isCurrent || false,
        isStored: message.isStored || false,
        conversationId,
        threadId: normalizedThreadId,
        conversationThreadId: normalizedThreadId,
      };

      acc.push(combinedMessage);
    }
    // Handle standalone user messages (unlikely but possible)
    else if (messageType === 'user') {
      const threadId = resolveThreadIdForIndex(index);
      const conversationId = resolveConversationId(message, threadId);
      const normalizedThreadId = threadId || conversationId || null;

      const normalizedUserMessage = {
        ...message,
        conversationId,
        threadId: normalizedThreadId,
        conversationThreadId: normalizedThreadId,
      };

      const combinedMessage = {
        id: message.id,
        userContent: message.content,
        aiContent: null,
        timestamp: message.timestamp,
        resources: [],
        isStudyNotes: false,
        originalUserMessage: normalizedUserMessage,
        isCurrent: message.isCurrent || false,
        isStored: message.isStored || false,
        conversationId,
        threadId: normalizedThreadId,
        conversationThreadId: normalizedThreadId,
      };

      acc.push(combinedMessage);
    }

    return acc;
  }, []);
}

const resolveConversationThreadId = (conversation) =>
  conversation?.threadId ||
  conversation?.conversationThreadId ||
  conversation?.originalAiMessage?.threadId ||
  conversation?.originalUserMessage?.threadId ||
  conversation?.originalAiMessage?.conversationId ||
  conversation?.originalUserMessage?.conversationId ||
  conversation?.conversationId ||
  conversation?.originalAiMessage?.conversation?.id ||
  conversation?.originalUserMessage?.conversation?.id ||
  null;

const resolveConversationTimestamp = (conversation) => {
  if (!conversation || typeof conversation !== 'object') return null;

  const directTimestamp = getTimestampValue(conversation.timestamp);
  if (directTimestamp != null) return directTimestamp;

  const aiTimestamp = getTimestampValue(conversation.originalAiMessage?.timestamp);
  if (aiTimestamp != null) return aiTimestamp;

  return getTimestampValue(conversation.originalUserMessage?.timestamp);
};

const normalizeConversationPreview = (conversation) => ({
  id: conversation.id,
  userContent: conversation.userContent,
  aiContent: conversation.aiContent,
  timestamp: conversation.timestamp,
  resources: Array.isArray(conversation.resources) ? conversation.resources.filter(Boolean) : [],
  isStudyNotes: Boolean(conversation.isStudyNotes),
  originalUserMessage: conversation.originalUserMessage,
  originalAiMessage: conversation.originalAiMessage,
  isCurrent: Boolean(conversation.isCurrent),
  isStored: Boolean(conversation.isStored),
  threadId:
    conversation.threadId ||
    conversation.conversationThreadId ||
    conversation.originalAiMessage?.threadId ||
    conversation.originalUserMessage?.threadId ||
    conversation.conversationId ||
    conversation.originalAiMessage?.conversationId ||
    conversation.originalUserMessage?.conversationId ||
    conversation.originalAiMessage?.conversation?.id ||
    conversation.originalUserMessage?.conversation?.id ||
    conversation.id ||
    null,
  conversationId:
    conversation.conversationId ||
    conversation.originalAiMessage?.conversationId ||
    conversation.originalUserMessage?.conversationId ||
    conversation.originalAiMessage?.conversation?.id ||
    conversation.originalUserMessage?.conversation?.id ||
    null,
});

const createContentFingerprint = (message) => {
  if (!message || typeof message !== 'object') return 'no-content';

  const { content } = message;
  if (content == null) return 'no-content';

  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed ? trimmed.slice(0, 60) : 'no-content';
  }

  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (typeof part === 'string') return part.trim();
        if (part == null) return '';
        try {
          return JSON.stringify(part);
        } catch {
          return String(part);
        }
      })
      .filter(Boolean)
      .join(' ');
    return joined ? joined.slice(0, 60) : 'no-content';
  }

  try {
    const serialized = JSON.stringify(content);
    return serialized ? serialized.slice(0, 60) : 'no-content';
  } catch {
    const coerced = String(content);
    return coerced ? coerced.slice(0, 60) : 'no-content';
  }
};

const buildConversationIdentifierCandidates = (message = {}) =>
  [
    message.conversationId,
    message.conversation?.id,
    message.conversationThreadId,
    message.threadId,
    message.thread_id,
    message.parentConversationId,
    message.metadata?.conversationId,
    message.metadata?.threadId,
    message.metadata?.thread_id,
    message.sessionId,
    message.session_id,
    message.metadata?.sessionId,
    message.metadata?.session_id,
  ].filter(Boolean);

const buildThreadGroupingCandidates = (message = {}) =>
  [
    message.threadId,
    message.conversationThreadId,
    message.conversationId,
    message.conversation?.id,
    message.parentConversationId,
    message.metadata?.threadId,
    message.metadata?.conversationId,
    message.metadata?.sessionId,
    message.metadata?.thread_id,
    message.metadata?.session_id,
    message.sessionId,
    message.session_id,
  ].filter(Boolean);

const deriveThreadIdAssignments = (messages, { threadGapMs = DEFAULT_THREAD_GAP_MS } = {}) => {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const assignments = new Array(safeMessages.length).fill(null);

  let previousThreadId = null;
  let previousTimestamp = null;
  let previousSessionId = null;
  let fallbackCounter = 0;

  const createFallbackThreadId = (message, index) => {
    const timestampValue = getTimestampValue(message?.timestamp);
    const timestampPart = timestampValue != null ? timestampValue : `idx-${index}`;
    const idPart =
      typeof message?.id === 'string' && message.id.trim() ? message.id.trim() : `seq-${fallbackCounter + 1}`;

    fallbackCounter += 1;
    return `local-thread-${timestampPart}-${idPart}`;
  };

  safeMessages.forEach((message, index) => {
    if (!message || typeof message !== 'object') {
      assignments[index] = previousThreadId;
      return;
    }

    const messageType = resolveMessageType(message);
    const timestampValue = getTimestampValue(message.timestamp);
    const sessionCandidates = [
      message.sessionId,
      message.session_id,
      message.metadata?.sessionId,
      message.metadata?.session_id,
    ].filter(Boolean);
    const currentSessionId = sessionCandidates[0] || previousSessionId;
    const candidateThreadIds = buildThreadGroupingCandidates(message);
    let resolvedThreadId = candidateThreadIds[0] || null;

    const previousAssignment = index > 0 ? assignments[index - 1] : null;
    const previousMessageType = index > 0 ? resolveMessageType(safeMessages[index - 1]) : null;
    const isNewSession =
      Boolean(previousSessionId) && Boolean(currentSessionId) && previousSessionId !== currentSessionId;
    const hasLargeGap =
      timestampValue != null &&
      previousTimestamp != null &&
      Math.abs(timestampValue - previousTimestamp) > threadGapMs;

    if (!resolvedThreadId) {
      if (previousAssignment && !(isNewSession || hasLargeGap)) {
        resolvedThreadId = previousAssignment;
      } else {
        resolvedThreadId = createFallbackThreadId(message, index);
      }
    }

    assignments[index] = resolvedThreadId;
    previousThreadId = resolvedThreadId;

    if (timestampValue != null) previousTimestamp = timestampValue;
    if (currentSessionId) previousSessionId = currentSessionId;

    if (
      resolvedThreadId &&
      index > 0 &&
      previousMessageType === 'user' &&
      assignments[index - 1] &&
      assignments[index - 1] !== resolvedThreadId
    ) {
      const previousCandidates = buildThreadGroupingCandidates(safeMessages[index - 1]);
      if (previousCandidates.length === 0) {
        assignments[index - 1] = resolvedThreadId;
      }
    }
  });

  return {
    assignments,
    byMessageId: safeMessages.reduce((acc, message, index) => {
      const threadId = assignments[index];
      if (threadId && message?.id) {
        acc[message.id] = threadId;
      }
      return acc;
    }, {}),
  };
};

export { deriveThreadIdAssignments };

const getMessageMergeKey = (message) => {
  if (!message || typeof message !== 'object') return null;

  if (message.id) return message.id;

  const conversationKey = buildConversationIdentifierCandidates(message)[0] || 'no-conversation';
  const timestampValue = getTimestampValue(message.timestamp);
  const timestampKey =
    timestampValue != null
      ? String(timestampValue)
      : typeof message.timestamp === 'string' && message.timestamp.trim()
      ? message.timestamp.trim()
      : 'no-timestamp';
  const roleKey = message.role || message.type || 'unknown-role';
  const contentKey = createContentFingerprint(message);

  return `fallback:${conversationKey}:${roleKey}:${timestampKey}:${contentKey}`;
};

const resolveThreadFlags = (messages = []) => {
  const flags = { isCurrent: false, isStored: false };

  messages.forEach((message) => {
    if (!message) return;

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
  const validExisting = Array.isArray(existingMessages) ? existingMessages.filter(Boolean) : [];
  if (!nextMessage || !nextMessage.id) return [...validExisting];

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
    if (!conversation) return;

    const threadId = resolveConversationThreadId(conversation);
    const normalizedConversation = normalizeConversationPreview(conversation);
    const timestampValue = resolveConversationTimestamp(normalizedConversation);

    if (!threadId) {
      const existing = threads.get(normalizedConversation.id);
      const nextMessages = buildThreadMessages(existing?.threadMessages, normalizedConversation);
      const latestMessage = nextMessages[nextMessages.length - 1] || normalizedConversation;
      const latestTimestamp =
        resolveConversationTimestamp(latestMessage) ?? timestampValue ?? -Infinity;
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
    const latestTimestamp =
      resolveConversationTimestamp(latestMessage) ??
      existing.sortTimestamp ??
      timestampValue ??
      -Infinity;
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

const resolveRoleFromType = (type) => {
  if (type === 'ai' || type === 'assistant') {
    return 'assistant';
  }

  if (type === 'system') {
    return 'system';
  }

  return 'user';
};

const resolveTypeFromRole = (role) => {
  if (role === 'assistant') {
    return 'ai';
  }

  if (role === 'system') {
    return 'system';
  }

  return 'user';
};

export function expandConversationThread(conversation) {
  if (!conversation || typeof conversation !== 'object') {
    return [];
  }

  const threadMessages = Array.isArray(conversation.threadMessages) && conversation.threadMessages.length
    ? conversation.threadMessages.filter(Boolean)
    : [conversation];

  const expanded = [];
  let fallbackCounter = 0;

  threadMessages.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }

    const threadId =
      resolveConversationThreadId(entry) ||
      resolveConversationThreadId(conversation) ||
      entry.threadId ||
      conversation.threadId ||
      conversation.id ||
      null;

    const conversationId =
      entry.conversationId ||
      entry.originalAiMessage?.conversationId ||
      entry.originalUserMessage?.conversationId ||
      conversation.conversationId ||
      conversation.originalAiMessage?.conversationId ||
      conversation.originalUserMessage?.conversationId ||
      threadId ||
      null;

    const conversationThreadId = threadId || conversationId || null;
    const baseIdentifier =
      conversationId ||
      threadId ||
      entry.id ||
      conversation.id ||
      `thread-${expanded.length + 1}`;

    const pushMessage = (messageLike, {
      role,
      fallbackContent,
      fallbackResources,
      sourceTimestamp,
    }) => {
      const resolvedType = resolveTypeFromRole(
        messageLike?.role || resolveRoleFromType(messageLike?.type || role)
      );
      const resolvedRole = messageLike?.role || resolveRoleFromType(resolvedType);
      const timestampValue =
        messageLike?.timestamp ||
        sourceTimestamp ||
        entry.timestamp ||
        conversation.timestamp ||
        null;

      fallbackCounter += 1;

      expanded.push({
        ...(messageLike || {}),
        id: (messageLike && messageLike.id) || `${baseIdentifier}-${resolvedRole}-${fallbackCounter}`,
        role: resolvedRole,
        type: messageLike?.type || resolvedType,
        content:
          messageLike?.content != null
            ? messageLike.content
            : fallbackContent != null
            ? fallbackContent
            : '',
        timestamp: timestampValue,
        resources: Array.isArray(messageLike?.resources)
          ? messageLike.resources
          : Array.isArray(fallbackResources)
          ? fallbackResources
          : [],
        conversationId: messageLike?.conversationId || conversationId || null,
        threadId: messageLike?.threadId || threadId || null,
        conversationThreadId: messageLike?.conversationThreadId || conversationThreadId || null,
        isStored: messageLike?.isStored ?? entry.isStored ?? conversation.isStored ?? false,
        isCurrent: messageLike?.isCurrent ?? entry.isCurrent ?? conversation.isCurrent ?? false,
      });
    };

    if (entry.originalUserMessage || entry.userContent) {
      pushMessage(entry.originalUserMessage, {
        role: 'user',
        fallbackContent: entry.userContent,
        fallbackResources: [],
        sourceTimestamp: entry.originalUserMessage?.timestamp || entry.timestamp,
      });
    }

    if (entry.originalAiMessage || entry.aiContent) {
      pushMessage(entry.originalAiMessage, {
        role: 'assistant',
        fallbackContent: entry.aiContent,
        fallbackResources: entry.resources,
        sourceTimestamp: entry.originalAiMessage?.timestamp || entry.timestamp,
      });
    }
  });

  return expanded.sort((a, b) => {
    const timeA = getTimestampValue(a.timestamp) ?? -Infinity;
    const timeB = getTimestampValue(b.timestamp) ?? -Infinity;
    return timeA - timeB;
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
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((msg) => {
      if (!msg || typeof msg !== 'object') return false;
      if (msg.isResource || msg.isStudyNotes || msg.isLocalOnly) return false;

      const role =
        msg.role ||
        (msg.type === 'ai' ? 'assistant' : msg.type === 'user' ? 'user' : null);
      return role === 'user' || role === 'assistant';
    })
    .map((msg) => {
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
      if (!trimmed) return null;

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
  const current = conversations.filter((conv) => conv.isCurrent);
  const stored = conversations.filter((conv) => !conv.isCurrent);
  return { current, stored };
}

/**
 * Searches messages by content
 * @param {Object[]} messages - Array of message objects
 * @param {string} searchTerm - Search term
 * @returns {Object[]} - Filtered messages
 */
export function searchMessages(messages, searchTerm) {
  if (!messages || !searchTerm || searchTerm.trim() === '') return messages;

  const lowerSearchTerm = searchTerm.toLowerCase();
  return messages.filter(
    (msg) => msg.content && msg.content.toLowerCase().includes(lowerSearchTerm)
  );
}

/**
 * Gets messages with study notes
 * @param {Object[]} messages - Array of message objects
 * @returns {Object[]} - Messages that are study notes
 */
export function getStudyNotes(messages) {
  if (!messages || !Array.isArray(messages)) return [];
  return messages.filter((msg) => msg.isStudyNotes === true);
}

/**
 * Gets messages with resources
 * @param {Object[]} messages - Array of message objects
 * @returns {Object[]} - Messages that have resources
 */
export function getMessagesWithResources(messages) {
  if (!messages || !Array.isArray(messages)) return [];
  return messages.filter(
    (msg) => msg.resources && Array.isArray(msg.resources) && msg.resources.length > 0
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
    version: '1.0.0',
  };
}

/**
 * Enhanced message validation for storage compatibility
 * @param {Object} message - Message object to validate
 * @returns {boolean} - Whether the message is valid
 */
export function validateMessage(message) {
  if (!message || typeof message !== 'object') return false;

  // Required fields for all messages
  const requiredFields = ['id', 'type', 'content', 'timestamp'];
  const hasRequiredFields = requiredFields.every(
    (field) => Object.prototype.hasOwnProperty.call(message, field) && message[field] != null
  );
  if (!hasRequiredFields) return false;

  // Validate message type
  if (message.type !== 'user' && message.type !== 'ai') return false;

  if (message.role && message.role !== 'user' && message.role !== 'assistant') return false;

  // Validate content
  if (typeof message.content !== 'string' || message.content.trim() === '') return false;

  // Validate timestamp
  const date = new Date(message.timestamp);
  if (isNaN(date.getTime())) return false;

  // Validate resources array if present
  if (message.resources && !Array.isArray(message.resources)) return false;

  // Validate resources structure if present
  if (message.resources && Array.isArray(message.resources)) {
    const invalidResource = message.resources.find((resource) => {
      if (!resource || typeof resource !== 'object') return true;
      if (!resource.title || !resource.url || !resource.type) return true;
      if (
        typeof resource.title !== 'string' ||
        typeof resource.url !== 'string' ||
        typeof resource.type !== 'string'
      )
        return true;
      return false;
    });
    if (invalidResource) return false;
  }

  // Validate study notes data if present
  if (message.studyNotesData && typeof message.studyNotesData !== 'object') return false;

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
  if (!message || typeof message !== 'object') return null;

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
        .map((part) => {
          if (typeof part === 'string') return part.trim();
          if (part == null) return '';
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
            .map((part) => (typeof part === 'string' ? part.trim() : String(part || '')))
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
  if (!Array.isArray(messages)) return [];

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
  if (!content || typeof content !== 'string') return '';

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
      totalContentLength: 0,
    };
  }

  const userMessages = messages.filter((msg) => msg.type === 'user');
  const aiMessages = messages.filter((msg) => msg.type === 'ai');
  const studyNotes = messages.filter((msg) => msg.isStudyNotes);
  const withResources = messages.filter(
    (msg) => msg.resources && Array.isArray(msg.resources) && msg.resources.length > 0
  );
  const currentSession = messages.filter((msg) => msg.isCurrent);
  const stored = messages.filter((msg) => msg.isStored);
  const conversations = combineMessagesIntoConversations(messages);

  const totalContentLength = messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
  const averageContentLength = messages.length > 0 ? Math.round(totalContentLength / messages.length) : 0;

  // Find oldest and newest messages
  const timestamps = messages
    .map((msg) => new Date(msg.timestamp))
    .filter((date) => !isNaN(date.getTime()));
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
    totalContentLength,
  };
}

/**
 * Truncates message content for display in lists
 * @param {string} content - Message content
 * @param {number} maxLength - Maximum length (default: 100)
 * @returns {string} - Truncated content
 */
export function truncateContent(content, maxLength = 100) {
  if (!content || typeof content !== 'string') return '';
  if (content.length <= maxLength) return content;
  return content.substring(0, maxLength - 3) + '...';
}

/**
 * Groups messages by date for display purposes
 * @param {Object[]} messages - Array of message objects
 * @returns {Object} - Messages grouped by date
 */
export function groupMessagesByDate(messages) {
  if (!messages || !Array.isArray(messages)) return {};

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

  const lowerKeywords = keywords.map((keyword) => keyword.toLowerCase());

  return messages.filter((message) => {
    if (!message.content) return false;

    const lowerContent = message.content.toLowerCase();
    return lowerKeywords.some((keyword) => lowerContent.includes(keyword));
  });
}

/**
 * Deduplicates messages based on ID
 * @param {Object[]} messages - Array of message objects
 * @returns {Object[]} - Deduplicated messages
 */
export function deduplicateMessages(messages) {
  if (!messages || !Array.isArray(messages)) return [];

  const seen = new Set();
  return messages.filter((message) => {
    if (!message.id) return false;
    if (seen.has(message.id)) return false;
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
  if (!conversations || !Array.isArray(conversations) || !currentMessageIds) return [];

  return conversations.filter((conv) => {
    if (conv.originalUserMessage && currentMessageIds.has(conv.originalUserMessage.id)) return true;
    if (conv.originalAiMessage && currentMessageIds.has(conv.originalAiMessage.id)) return true;
    return false;
  });
}

/**
 * Processes text with basic markdown formatting and returns structured data
 * for rendering components. Supports **bold**, *italic*, and `code`.
 * @param {string} text - Text with markdown formatting
 * @returns {Array} - Array of text segments with formatting info
 */
export function parseMarkdown(text) {
  if (!text || typeof text !== 'string') {
    return [{ type: 'text', content: text || '' }];
  }

  const result = [];
  const lines = text.split('\n');

  lines.forEach((line, lineIndex) => {
    // Add line break only if it's not the first line and not an empty line
    if (lineIndex > 0 && lines[lineIndex - 1].trim() !== '') {
      // Only add break if current line is not empty and previous line was not empty
      if (line.trim() !== '') {
        result.push({ type: 'break' });
      }
    }

    // Handle empty lines as paragraph breaks
    if (!line.trim()) {
      result.push({ type: 'paragraph-break' });
      return;
    }

    // Check if line is a numbered list item (e.g., "1. Item", "2) Item", "3- Item")
    const numberedListMatch = line.match(/^\s*(\d+)[\.\)\-]\s+(.+)/);
    if (numberedListMatch) {
      result.push({ 
        type: 'numbered-list-item', 
        content: numberedListMatch[2],
        number: numberedListMatch[1]
      });
      return;
    }

    // Check if line is a bulleted list item (e.g., "- Item", "* Item", "• Item")
    const bulletedListMatch = line.match(/^\s*[-*•]\s+(.+)/);
    if (bulletedListMatch) {
      result.push({ 
        type: 'bulleted-list-item', 
        content: bulletedListMatch[1]
      });
      return;
    }

    // Find all markdown matches in the line
    const matches = [];
    
    // Find **bold** text
    let boldMatch;
    const boldRegex = /\*\*([^*]+)\*\*/g;
    while ((boldMatch = boldRegex.exec(line)) !== null) {
      matches.push({
        start: boldMatch.index,
        end: boldMatch.index + boldMatch[0].length,
        content: boldMatch[1],
        type: 'bold'
      });
    }

    // Find *italic* text (but not if it's part of bold)
    let italicMatch;
    const italicRegex = /\*([^*]+)\*/g;
    while ((italicMatch = italicRegex.exec(line)) !== null) {
      const isPartOfBold = matches.some(match => 
        match.type === 'bold' && 
        italicMatch.index >= match.start && 
        italicMatch.index < match.end
      );
      if (!isPartOfBold) {
        matches.push({
          start: italicMatch.index,
          end: italicMatch.index + italicMatch[0].length,
          content: italicMatch[1],
          type: 'italic'
        });
      }
    }

    // Find `code` text
    let codeMatch;
    const codeRegex = /`([^`]+)`/g;
    while ((codeMatch = codeRegex.exec(line)) !== null) {
      matches.push({
        start: codeMatch.index,
        end: codeMatch.index + codeMatch[0].length,
        content: codeMatch[1],
        type: 'code'
      });
    }

    // Sort matches by position
    matches.sort((a, b) => a.start - b.start);

    // If no matches found, add the whole line
    if (matches.length === 0) {
      result.push({ type: 'text', content: line });
    } else {
      // Process the line with matches
      let currentIndex = 0;
      matches.forEach((match) => {
        // Add text before this match
        if (match.start > currentIndex) {
          const textBefore = line.substring(currentIndex, match.start);
          if (textBefore) {
            result.push({ type: 'text', content: textBefore });
          }
        }

        // Add the formatted segment
        result.push({ type: match.type, content: match.content });
        currentIndex = match.end;
      });

      // Add remaining text after last match
      if (currentIndex < line.length) {
        const remainingText = line.substring(currentIndex);
        if (remainingText) {
          result.push({ type: 'text', content: remainingText });
        }
      }
    }
  });

  return result;
}