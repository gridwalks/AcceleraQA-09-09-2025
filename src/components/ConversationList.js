import React, { memo } from 'react';
import { MessageSquare } from 'lucide-react';
import { parseMarkdown } from '../utils/messageUtils';

// Simple component to render markdown-parsed text
const MarkdownText = ({ text }) => {
  const segments = parseMarkdown(text);
  
  // Group consecutive list items, table rows, and handle paragraph breaks
  const groupedSegments = [];
  let currentList = null;
  let currentTable = null;
  let currentCodeBlock = null;
  
  segments.forEach((segment, index) => {
    if (segment.type === 'numbered-list-item') {
      if (currentTable) {
        groupedSegments.push(currentTable);
        currentTable = null;
      }
      if (currentCodeBlock) {
        groupedSegments.push(currentCodeBlock);
        currentCodeBlock = null;
      }
      if (!currentList || currentList.type !== 'numbered-list') {
        if (currentList) groupedSegments.push(currentList);
        currentList = { type: 'numbered-list', items: [] };
      }
      currentList.items.push(segment);
    } else if (segment.type === 'bulleted-list-item') {
      if (currentTable) {
        groupedSegments.push(currentTable);
        currentTable = null;
      }
      if (currentCodeBlock) {
        groupedSegments.push(currentCodeBlock);
        currentCodeBlock = null;
      }
      if (!currentList || currentList.type !== 'bulleted-list') {
        if (currentList) groupedSegments.push(currentList);
        currentList = { type: 'bulleted-list', items: [] };
      }
      currentList.items.push(segment);
    } else if (segment.type === 'table-row') {
      if (currentList) {
        groupedSegments.push(currentList);
        currentList = null;
      }
      if (currentCodeBlock) {
        groupedSegments.push(currentCodeBlock);
        currentCodeBlock = null;
      }
      if (!currentTable) {
        currentTable = { type: 'table', rows: [] };
      }
      currentTable.rows.push(segment);
    } else if (segment.type === 'table-separator') {
      // Skip separator rows, they're just for formatting
    } else if (segment.type === 'code-block-start') {
      if (currentList) {
        groupedSegments.push(currentList);
        currentList = null;
      }
      if (currentTable) {
        groupedSegments.push(currentTable);
        currentTable = null;
      }
      currentCodeBlock = { type: 'code-block', language: segment.language, content: '' };
    } else {
      if (currentList) {
        groupedSegments.push(currentList);
        currentList = null;
      }
      if (currentTable) {
        groupedSegments.push(currentTable);
        currentTable = null;
      }
      if (currentCodeBlock) {
        if (segment.content !== '```') {
          currentCodeBlock.content += segment.content + '\n';
        } else {
          groupedSegments.push(currentCodeBlock);
          currentCodeBlock = null;
        }
      } else {
        groupedSegments.push(segment);
      }
    }
  });
  
  if (currentList) {
    groupedSegments.push(currentList);
  }
  if (currentTable) {
    groupedSegments.push(currentTable);
  }
  if (currentCodeBlock) {
    groupedSegments.push(currentCodeBlock);
  }
  
  return (
    <>
      {groupedSegments.map((segment, index) => {
        switch (segment.type) {
          case 'bold':
            return <strong key={index} className="font-semibold">{segment.content}</strong>;
          case 'italic':
            return <em key={index} className="italic">{segment.content}</em>;
          case 'code':
            return (
              <code 
                key={index} 
                className="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono"
              >
                {segment.content}
              </code>
            );
          case 'heading':
            const HeadingTag = `h${Math.min(segment.level + 1, 6)}`;
            const headingClasses = {
              1: 'text-lg font-bold mt-4 mb-2',
              2: 'text-base font-bold mt-3 mb-2',
              3: 'text-sm font-semibold mt-2 mb-1',
              4: 'text-xs font-semibold mt-2 mb-1',
              5: 'text-xs font-semibold mt-1 mb-1',
              6: 'text-xs font-semibold mt-1 mb-1'
            };
            return (
              <HeadingTag 
                key={index} 
                className={`${headingClasses[segment.level] || headingClasses[2]} text-gray-900`}
              >
                {segment.content}
              </HeadingTag>
            );
          case 'code-block':
            return (
              <pre 
                key={index} 
                className="bg-gray-900 text-gray-100 p-3 rounded overflow-x-auto text-xs font-mono my-2"
              >
                <code>{segment.content.trim()}</code>
              </pre>
            );
          case 'table':
            return (
              <div key={index} className="overflow-x-auto my-2">
                <table className="min-w-full border-collapse border border-gray-300 text-xs">
                  <tbody>
                    {segment.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className={rowIndex === 0 ? 'bg-gray-50' : ''}>
                        {row.cells.map((cell, cellIndex) => (
                          <td 
                            key={cellIndex} 
                            className={`border border-gray-300 px-2 py-1 ${rowIndex === 0 ? 'font-semibold' : ''}`}
                          >
                            <MarkdownText text={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'break':
            return <br key={index} />;
          case 'paragraph-break':
            return <div key={index} className="h-1" />;
          case 'numbered-list':
            return (
              <ol key={index} className="list-decimal list-inside my-2 space-y-0 text-sm text-left">
                {segment.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="text-left" value={item.number}>
                    <MarkdownText text={item.content} />
                  </li>
                ))}
              </ol>
            );
          case 'bulleted-list':
            return (
              <ul key={index} className="list-disc list-inside my-2 space-y-0 text-sm text-left">
                {segment.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="text-left">
                    <MarkdownText text={item.content} />
                  </li>
                ))}
              </ul>
            );
          case 'text':
          default:
            return segment.content;
        }
      })}
    </>
  );
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
