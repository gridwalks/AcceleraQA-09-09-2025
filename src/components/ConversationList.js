import React, { memo } from 'react';
import { MessageSquare } from 'lucide-react';
import { parseMarkdown } from '../utils/messageUtils';

// Clean, simple markdown renderer
const MarkdownText = ({ text }) => {
  if (!text) return null;

  // Simple regex-based markdown parsing - much cleaner approach
  const lines = text.split('\n');
  const elements = [];
  let inCodeBlock = false;
  let codeBlockContent = [];

  lines.forEach((line, index) => {
    // Handle code blocks
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        elements.push(
          <pre key={`code-${index}`} className="bg-gray-100 p-3 rounded text-sm font-mono overflow-x-auto">
            <code>{codeBlockContent.join('\n')}</code>
          </pre>
        );
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        // Start code block
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      return;
    }

    // Handle headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const Tag = `h${Math.min(level + 1, 6)}`;
      const classes = level === 1 ? 'text-lg font-bold mt-4 mb-2' : 'text-base font-semibold mt-3 mb-2';
      elements.push(
        React.createElement(Tag, { key: `heading-${index}`, className: classes }, headingMatch[2])
      );
      return;
    }

    // Handle lists
    const listMatch = line.match(/^(\s*)([-*•]|\d+[.)])\s+(.+)/);
    if (listMatch) {
      const indent = listMatch[1].length;
      const marker = listMatch[2];
      const content = listMatch[3];
      const isNumbered = /^\d+[.)]/.test(marker);
      
      elements.push(
        <div key={`list-${index}`} className="flex items-start gap-2 my-1">
          <span className="text-gray-600 mt-0.5 min-w-[20px]">
            {isNumbered ? marker : '•'}
          </span>
          <span className="flex-1">{renderInlineMarkdown(content)}</span>
        </div>
      );
      return;
    }

    // Handle empty lines
    if (!line.trim()) {
      elements.push(<div key={`space-${index}`} className="h-2" />);
      return;
    }

    // Regular paragraph
    elements.push(
      <p key={`p-${index}`} className="mb-2 leading-relaxed">
        {renderInlineMarkdown(line)}
      </p>
    );
  });

  // Close any remaining code block
  if (inCodeBlock && codeBlockContent.length > 0) {
    elements.push(
      <pre key="code-final" className="bg-gray-100 p-3 rounded text-sm font-mono overflow-x-auto">
        <code>{codeBlockContent.join('\n')}</code>
      </pre>
    );
  }

  return <div className="markdown-content">{elements}</div>;
};

// Simple inline markdown renderer
const renderInlineMarkdown = (text) => {
  if (!text) return text;
  
  // Handle bold **text**
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold">$1</strong>');
  
  // Handle italic *text*
  text = text.replace(/\*(.*?)\*/g, '<em class="italic">$1</em>');
  
  // Handle code `text`
  text = text.replace(/`(.*?)`/g, '<code class="bg-gray-200 px-1 py-0.5 rounded text-sm font-mono">$1</code>');
  
  // Convert to JSX (dangerouslySetInnerHTML for simplicity)
  return <span dangerouslySetInnerHTML={{ __html: text }} />;
};

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
                      <MarkdownText text={message.userContent} />
                    </p>
                  )}
                  {message.aiContent && (
                    <p className="mt-1 text-xs text-gray-700 whitespace-pre-wrap break-words">
                      <span className="font-semibold text-gray-900">AcceleraQA:</span>{' '}
                      <MarkdownText text={message.aiContent} />
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
