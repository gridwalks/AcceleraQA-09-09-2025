import { buildChatHistory } from './messageUtils';

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
});
