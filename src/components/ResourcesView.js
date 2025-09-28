import React, { memo, useMemo, useState, useCallback } from 'react';
import { Search, ChevronRight, MessageSquare } from 'lucide-react';
import ConversationList from './ConversationList';
import {
  combineMessagesIntoConversations,
  mergeCurrentAndStoredMessages,
  groupConversationsByThread,
} from '../utils/messageUtils';

const ResourcesView = memo(({ messages = [], thirtyDayMessages = [], onConversationSelect }) => {
  const [conversationSearchTerm, setConversationSearchTerm] = useState('');
  const [isConversationsOpen, setIsConversationsOpen] = useState(true);

  const conversations = useMemo(() => {
    const merged = mergeCurrentAndStoredMessages(messages, thirtyDayMessages);
    const combined = combineMessagesIntoConversations(merged);
    const threaded = groupConversationsByThread(combined);
    return threaded.slice(0, 20);
  }, [messages, thirtyDayMessages]);

  const filteredConversations = useMemo(() => {
    const trimmed = conversationSearchTerm.trim().toLowerCase();
    if (!trimmed) {
      return conversations;
    }

    const matchesThread = (conversation) => {
      const threadMessages = Array.isArray(conversation.threadMessages) && conversation.threadMessages.length
        ? conversation.threadMessages
        : [conversation];

      return threadMessages.some((message) => {
        const userText = typeof message.userContent === 'string' ? message.userContent.toLowerCase() : '';
        const aiText = typeof message.aiContent === 'string' ? message.aiContent.toLowerCase() : '';
        return userText.includes(trimmed) || aiText.includes(trimmed);
      });
    };

    return conversations.filter(matchesThread);
  }, [conversations, conversationSearchTerm]);

  const toggleConversations = useCallback(() => {
    setIsConversationsOpen((open) => !open);
  }, []);

  const clearSearch = useCallback(() => {
    setConversationSearchTerm('');
  }, []);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 h-full shadow-sm flex flex-col">
      <div className="flex-1 overflow-y-auto space-y-4">
        <div className="border border-gray-200 rounded-lg">
          <button
            type="button"
            onClick={toggleConversations}
            className="w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-left hover:bg-gray-50 rounded-t-lg"
          >
            <div className="flex items-center space-x-2">
              <MessageSquare className="h-4 w-4" />
              <span>Conversations</span>
              {conversations.length > 0 && (
                <span className="bg-green-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                  {conversations.length}
                </span>
              )}
            </div>
            <ChevronRight className={`h-4 w-4 transform transition-transform ${isConversationsOpen ? 'rotate-90' : ''}`} />
          </button>

          {isConversationsOpen && (
            <div className="p-4 space-y-4 border-t border-gray-200">
              {conversations.length > 0 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search conversations..."
                    value={conversationSearchTerm}
                    onChange={(event) => setConversationSearchTerm(event.target.value)}
                    className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
              )}

              {conversations.length === 0 ? (
                <div className="text-center py-8 text-gray-600">
                  <div className="w-12 h-12 bg-green-100 rounded-lg mx-auto mb-3 flex items-center justify-center">
                    <MessageSquare className="h-6 w-6 text-green-600" />
                  </div>
                  <h4 className="text-lg font-medium text-gray-900 mb-2">No conversations yet</h4>
                  <p className="text-sm">Start chatting to see your learning history here.</p>
                </div>
              ) : filteredConversations.length > 0 ? (
                <ConversationList conversations={filteredConversations} onSelect={onConversationSelect} />
              ) : (
                <div className="text-center py-8">
                  <Search className="w-8 h-8 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-600 text-sm">
                    No conversations match "{conversationSearchTerm}"
                  </p>
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="mt-2 text-sm text-green-600 hover:text-green-800"
                  >
                    Clear search
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

ResourcesView.displayName = 'ResourcesView';

export default ResourcesView;
