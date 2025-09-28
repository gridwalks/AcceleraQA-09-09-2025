import learningSuggestionsService, { clearSuggestionCache } from './learningSuggestionsService';

describe('learningSuggestionsService (Neon heuristics)', () => {
  let mathRandomSpy;

  beforeEach(() => {
    mathRandomSpy = jest.spyOn(global.Math, 'random').mockReturnValue(0.123456789);
  });

  afterEach(() => {
    clearSuggestionCache('test-user');
    mathRandomSpy.mockRestore();
  });

  it('derives topic-specific suggestions from recent Neon conversations', async () => {
    const suggestions = await learningSuggestionsService.generateSuggestionsFromConversations([
      {
        messages: [
          { type: 'user', content: 'We ran into GMP compliance gaps and need a CAPA strategy.' },
          { type: 'assistant', content: 'Consider tightening your risk management workflow.' }
        ]
      }
    ]);

    const titles = suggestions.map(s => s.title);

    expect(titles).toContain('Strengthen GMP Inspection Readiness');
    expect(titles).toContain('CAPA Effectiveness Deep Dive');
    expect(suggestions.length).toBeLessThanOrEqual(6);
    expect(suggestions.every(s => s.source === 'neon_conversation_analysis')).toBe(true);
    expect(suggestions.every(s => typeof s.url === 'string' && s.url.length > 0)).toBe(true);
  });

  it('adds engagement and complexity suggestions when topics are limited', async () => {
    const suggestions = await learningSuggestionsService.generateSuggestionsFromConversations([
      {
        messages: [
          { type: 'user', content: 'Thanks for the help earlier.' }
        ]
      }
    ]);

    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    expect(suggestions.some(s => s.title === 'Turn Neon Conversations into a Knowledge Base')).toBe(true);
    expect(suggestions.some(s => s.type === 'Learning Path' || s.type === 'Workshop' || s.type === 'Program')).toBe(true);
  });
});
