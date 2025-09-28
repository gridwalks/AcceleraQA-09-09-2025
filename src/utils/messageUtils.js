export function combineMessagesIntoConversations(messages) {
  if (!messages || !Array.isArray(messages)) {
    return [];
  }

  const { assignments: threadAssignments } = deriveThreadIdAssignments(messages);

  const resolveConversationId = (message, fallback) =>
    message?.conversationId ||
    message?.conversation?.id ||
    fallback ||
    null;

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
    if (
      messageType === 'ai' &&
      index > 0 &&
      resolveMessageType(array[index - 1]) === 'user'
    ) {
      const userMessage = array[index - 1];
      const threadId =
        resolveThreadIdForIndex(index) || resolveThreadIdForIndex(index - 1);
      const conversationId =
        resolveConversationId(message, null) ||
        resolveConversationId(userMessage, null) ||
        threadId;

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
