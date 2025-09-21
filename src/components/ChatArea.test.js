import { getSourceSnippet, isDisallowedSnippet } from './ChatArea';

describe('getSourceSnippet', () => {
  it('preserves non-Latin snippets instead of dropping them', () => {
    const multilingualSnippet = '这是一个测试片段，用于验证多语言支持。';
    const source = {
      snippet: multilingualSnippet,
      metadata: {
        language: 'zh-CN',
      },
    };

    const result = getSourceSnippet(source);

    expect(result).toBe(multilingualSnippet);
  });
});

describe('isDisallowedSnippet', () => {
  it('allows multilingual text that includes non-Latin characters', () => {
    const multilingualSnippet = '这是一个测试片段，用于验证多语言支持。';
    expect(isDisallowedSnippet(multilingualSnippet)).toBe(false);
  });

  it('still filters typical opaque identifiers', () => {
    expect(isDisallowedSnippet('file-1A2B3C4D5E')).toBe(true);
  });
});
