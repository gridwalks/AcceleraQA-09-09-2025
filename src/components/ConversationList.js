import React, { memo } from 'react';
import { MessageSquare } from 'lucide-react';

/**
 * Displays a list of recent conversations and notifies parent when one is selected
 */
const ConversationList = memo(({ conversations = [], onSelect = () => {} }) => {
  const toThreadMessages = (conversation) => {
    if (
      Array.isArray(conversation.threadMessages) &&
      conversation.threadMessages.length > 0
    ) {
      return conversation.threadMessages;
    }
    return [conversation];
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) {
      return '';
    }

    const value = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
    if (Number.isNaN(value)) {
      return '';
    }

    const date = new Date(value);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!conversations.length) {
    return <p className="text-sm text-gray-500">No conversations yet.</p>;
  }

  const handleClick = (conv) => {
    const threadMessages = toThreadMessages(conv);
    const identifierSource = threadMessages.find((message) =>
      message?.originalAiMessage?.conversationId ||
      message?.originalUserMessage?.conversationId
    ) || conv;

    const conversationId =
      identifierSource?.originalAiMessage?.conversationId ||
      identifierSource?.originalUserMessage?.conversationId ||
      conv.conversationId ||
      conv.threadId;

    const normalizedConversationId =
      conversationId ||
      conv.conversationId ||
      conv.threadId ||
      conv.id ||
      null;

    onSelect({
      ...conv,
      conversationId: normalizedConversationId,
      threadId: conv.threadId || normalizedConversationId,
      threadMessages,
    });
  };

  return (
    <ul className="space-y-3" data-testid="conversation-list">
      {conversations.map((conv) => {
        const threadMessages = toThreadMessages(conv);
        const timestampLabel = formatTimestamp(conv.timestamp);
        const exchangeCount = Math.max(
          threadMessages.length,
          conv.conversationCount || 0,
        );
        const exchangeLabel = exchangeCount > 1
          ? `${exchangeCount} exchanges`
          : 'Single exchange';

        return (
          <li
            key={conv.id}
            className="p-3 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 cursor-pointer focus-within:ring-2 focus-within:ring-green-200"
            onClick={() => handleClick(conv)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick(conv);
              }
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                <MessageSquare className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">{exchangeLabel}</span>
              </div>
              {timestampLabel && (
                <span className="text-xs text-gray-500">{timestampLabel}</span>
              )}
            </div>

            <div className="space-y-2">
              {threadMessages.map((message, index) => (
                <div
                  key={`${message.id || 'message'}-${index}`}
                  className="rounded-md bg-white border border-gray-200 p-2 shadow-sm"
                >
                  {message.userContent && (
                    <p className="text-xs text-gray-700 whitespace-pre-wrap break-words">
                      <span className="font-semibold text-gray-900">You:</span>{' '}
                      {message.userContent}
                    </p>
                  )}
                  {message.aiContent && (
                    <p className="mt-1 text-xs text-gray-700 whitespace-pre-wrap break-words">
                      <span className="font-semibold text-gray-900">AcceleraQA:</span>{' '}
                      {message.aiContent}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
});

ConversationList.displayName = 'ConversationList';

export default ConversationList;
