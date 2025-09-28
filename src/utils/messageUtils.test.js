import {
  buildChatHistory,
  combineMessagesIntoConversations,
  groupConversationsByThread,
} from './messageUtils';

describe('buildChatHistory', () => {
  it('filters conversation to user and assistant roles in order', () => {
    const messages = [
      { id: '1', type: 'user', content: 'Hello there', timestamp: 1 },
      { id: '2', type: 'ai', content: 'Hi! How can I help?', timestamp: 2 },
      { id: '3', role: 'assistant', type: 'ai', content: 'Not for chat', isResource: true, timestamp: 3 },
      { id: '4', type: 'user', content: 'Walk me through GMP validation.', timestamp: 4 },
      { id: '5', role: 'assistant', type: 'ai', content: 'Validation follows IQ/OQ/PQ phases.', timestamp: 5 },
      { id: '6', type: 'ai', content: '   ', timestamp: 6 },
    ];

    const history = buildChatHistory(messages);

    expect(history).toEqual([
      { role: 'user', content: 'Hello there' },
      { role: 'assistant', content: 'Hi! How can I help?' },
      { role: 'user', content: 'Walk me through GMP validation.' },
      { role: 'assistant', content: 'Validation follows IQ/OQ/PQ phases.' },
    ]);
  });

  it('returns an empty array for invalid inputs', () => {
    expect(buildChatHistory(null)).toEqual([]);
    expect(buildChatHistory(undefined)).toEqual([]);
    expect(buildChatHistory([{ id: '1', type: 'ai', content: '   ' }])).toEqual([]);
  });

  it('omits empty or unsupported entries and trims retained content', () => {
    const messages = [
      { id: '7', role: 'system', content: 'Ignore me', timestamp: 7 },
      { id: '8', role: 'user', content: '  Prior question?  ', timestamp: 8 },
      { id: '9', role: 'assistant', content: ['Prior answer.  ', '   '], timestamp: 9 },
      { id: '10', role: 'assistant', content: '   ', timestamp: 10 },
    ];

    expect(buildChatHistory(messages)).toEqual([
      { role: 'user', content: 'Prior question?' },
      { role: 'assistant', content: 'Prior answer.' },
    ]);
  });
});

describe('combineMessagesIntoConversations', () => {
  it('carries forward conversation ids from raw messages', () => {
    const messages = [
      {
        id: 'user-1',
        role: 'user',
        type: 'user',
        timestamp: '2024-03-01T12:00:00.000Z',
        content: 'Hi',
        conversationId: 'conv-123',
      },
      {
        id: 'ai-1',
        role: 'assistant',
        type: 'ai',
        timestamp: '2024-03-01T12:00:10.000Z',
        content: 'Hello!',
        conversationId: 'conv-123',
      },
      {
        id: 'ai-2',
        role: 'assistant',
        type: 'ai',
        timestamp: '2024-03-01T12:00:20.000Z',
        content: 'Need anything else?',
        conversation: { id: 'conv-456' },
      },
    ];

    const combined = combineMessagesIntoConversations(messages);

    expect(combined).toHaveLength(2);
    expect(combined[0].conversationId).toBe('conv-123');
    expect(combined[0].originalAiMessage.conversationId).toBe('conv-123');
    expect(combined[1].conversationId).toBe('conv-456');
  });
});

describe('groupConversationsByThread', () => {
  let idCounter = 0;
  const nextId = (prefix) => {
    idCounter += 1;
    return `${prefix}-${idCounter}`;
  };

  const baseUserMessage = (overrides = {}) => ({
    id: nextId('user'),
    role: 'user',
    type: 'user',
    timestamp: '2024-01-01T00:00:00.000Z',
    conversationId: 'conv-1',
    content: 'Question',
    ...overrides,
  });

  const baseAiMessage = (overrides = {}) => ({
    id: nextId('ai'),
    role: 'assistant',
    type: 'ai',
    timestamp: '2024-01-01T00:05:00.000Z',
    conversationId: 'conv-1',
    content: 'Answer',
    ...overrides,
  });

  it('aggregates multiple conversation cards with the same conversation id', () => {
    const conversations = [
      {
        id: '1-2',
        userContent: 'First question',
        aiContent: 'First answer',
        timestamp: '2024-01-01T00:05:00.000Z',
        resources: [{ id: 'res-1', title: 'Doc 1' }],
        originalUserMessage: baseUserMessage({ id: '1', content: 'First question' }),
        originalAiMessage: baseAiMessage({ id: '2', content: 'First answer' }),
      },
      {
        id: '3-4',
        userContent: 'Follow-up question',
        aiContent: 'Follow-up answer',
        timestamp: '2024-01-02T00:05:00.000Z',
        resources: [{ id: 'res-2', title: 'Doc 2' }],
        originalUserMessage: baseUserMessage({
          id: '3',
          timestamp: '2024-01-02T00:00:00.000Z',
          content: 'Follow-up question',
        }),
        originalAiMessage: baseAiMessage({
          id: '4',
          timestamp: '2024-01-02T00:05:00.000Z',
          content: 'Follow-up answer',
        }),
      },
      {
        id: '5-6',
        userContent: 'Another thread question',
        aiContent: 'Another thread answer',
        timestamp: '2024-01-03T00:10:00.000Z',
        resources: [{ id: 'res-3', title: 'Doc 3' }],
        originalUserMessage: baseUserMessage({
          conversationId: 'conv-2',
          id: '5',
          timestamp: '2024-01-03T00:05:00.000Z',
          content: 'Another thread question',
        }),
        originalAiMessage: baseAiMessage({
          conversationId: 'conv-2',
          id: '6',
          timestamp: '2024-01-03T00:10:00.000Z',
          content: 'Another thread answer',
        }),
      },
    ];

    const grouped = groupConversationsByThread(conversations);

    expect(grouped).toHaveLength(2);
    expect(grouped[0].id).toBe('conv-2');
    expect(grouped[0].conversationId).toBe('conv-2');
    expect(grouped[0].userContent).toBe('Another thread question');
    expect(grouped[0].resources).toEqual([{ id: 'res-3', title: 'Doc 3' }]);
    expect(grouped[0].threadMessages).toHaveLength(1);
    expect(grouped[0].threadMessages[0].userContent).toBe('Another thread question');

    const conv1 = grouped.find((item) => item.id === 'conv-1');
    expect(conv1).toBeDefined();
    expect(conv1.conversationId).toBe('conv-1');
    expect(conv1.userContent).toBe('Follow-up question');
    expect(conv1.aiContent).toBe('Follow-up answer');
    expect(conv1.conversationCount).toBe(2);
    expect(conv1.resources).toHaveLength(2);
    expect(conv1.threadMessages).toHaveLength(2);
    expect(conv1.threadMessages[0].userContent).toBe('First question');
    expect(conv1.threadMessages[1].aiContent).toBe('Follow-up answer');
  });

  it('retains standalone cards without conversation identifiers', () => {
    const loneConversation = {
      id: 'solo-card',
      userContent: 'Standalone question',
      aiContent: 'Standalone answer',
      timestamp: 1704153900000,
      resources: null,
      originalUserMessage: { id: 'solo-user', type: 'user' },
      originalAiMessage: { id: 'solo-ai', type: 'ai' },
    };

    const grouped = groupConversationsByThread([loneConversation]);

    expect(grouped).toEqual([
      {
        id: 'solo-card',
        userContent: 'Standalone question',
        aiContent: 'Standalone answer',
        timestamp: 1704153900000,
        resources: [],
        isStudyNotes: false,
        originalUserMessage: { id: 'solo-user', type: 'user' },
        originalAiMessage: { id: 'solo-ai', type: 'ai' },
        isCurrent: false,
        isStored: false,
        conversationId: null,
        conversationCount: 1,
        threadMessages: [
          {
            id: 'solo-card',
            userContent: 'Standalone question',
            aiContent: 'Standalone answer',
            timestamp: 1704153900000,
            resources: [],
            isStudyNotes: false,
            originalUserMessage: { id: 'solo-user', type: 'user' },
            originalAiMessage: { id: 'solo-ai', type: 'ai' },
            isCurrent: false,
            isStored: false,
            conversationId: null,
          },
        ],
      },
    ]);
  });

  it('groups cards when conversation id only exists on the combined entry', () => {
    const conversations = [
      {
        id: 'pair-1',
        conversationId: 'thread-1',
        userContent: 'First question',
        aiContent: 'First answer',
        timestamp: '2024-02-01T10:00:00.000Z',
        resources: [],
        isStored: true,
        isCurrent: false,
      },
      {
        id: 'pair-2',
        conversationId: 'thread-1',
        userContent: 'Second question',
        aiContent: 'Second answer',
        timestamp: '2024-02-01T10:05:00.000Z',
        resources: [],
        isStored: true,
        isCurrent: false,
      },
    ];

    const grouped = groupConversationsByThread(conversations);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].id).toBe('thread-1');
    expect(grouped[0].conversationCount).toBe(2);
    expect(grouped[0].threadMessages).toHaveLength(2);
    expect(grouped[0].threadMessages[0].conversationId).toBe('thread-1');
    expect(grouped[0].threadMessages[1].conversationId).toBe('thread-1');
  });
});
