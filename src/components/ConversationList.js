import React, { memo } from 'react';
import { MessageSquare } from 'lucide-react';

/**
 * Displays a list of recent conversations and notifies parent when one is selected
 */
const ConversationList = memo(({ conversations = [], onSelect = () => {} }) => {

  if (!conversations.length) {
    return (
      <p className="text-sm text-gray-500">No conversations yet.</p>
    );
  }

  const handleClick = (conv) => {
    const conversationId =
      conv.originalAiMessage?.conversationId ||
      conv.originalUserMessage?.conversationId;
    if (conversationId) {
      onSelect(conversationId);
    }
  };

  return (
    <ul className="space-y-2" data-testid="conversation-list">
      {conversations.map(conv => (
        <li
          key={conv.id}
          className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
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

          <MessageSquare className="h-4 w-4 text-gray-400" />
          <span className="text-sm text-gray-700 truncate">
            {(conv.userContent || conv.aiContent || '').slice(0, 40)}
          </span>
        </li>
      ))}
    </ul>
  );
});

ConversationList.displayName = 'ConversationList';

export default ConversationList;
