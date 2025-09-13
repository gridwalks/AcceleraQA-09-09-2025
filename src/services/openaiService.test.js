import { jest } from '@jest/globals';

jest.mock('../utils/resourceGenerator', () => ({
  generateResources: () => [],
}));

jest.mock('../utils/tokenUsage', () => ({
  recordTokenUsage: () => {},
}));

jest.mock('../config/modelConfig', () => ({
  getCurrentModel: () => 'test-model',
}));

import openAIService from './openaiService';

describe('openAIService uploadFile', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'file-id' }),
    });
    global.FormData = class {
      constructor() { this.append = jest.fn(); }
      append() {}
    };
  });

  it('uploads supported file types', async () => {
    const file = { name: 'doc.pdf', type: 'application/pdf' };
    const id = await openAIService.uploadFile(file);
    expect(id).toBe('file-id');
    expect(fetch).toHaveBeenCalled();
  });

  it('rejects unsupported file types', async () => {
    const file = { name: 'image.png', type: 'image/png' };
    await expect(openAIService.uploadFile(file)).rejects.toThrow('Unsupported file type; please upload a PDF, TXT, or MD file');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('openAIService getChatResponse', () => {
  beforeEach(() => {
    openAIService.apiKey = 'test-key';
    jest.spyOn(openAIService, 'makeRequest');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('handles responses API payload with output_text', async () => {
    openAIService.makeRequest.mockResolvedValue({
      output_text: 'response from output_text',
      usage: { total_tokens: 10 },
    });

    const result = await openAIService.getChatResponse('hello');
    expect(result.answer).toBe('response from output_text');
  });

  it('handles chat/completions payload with choices message content', async () => {
    openAIService.makeRequest.mockResolvedValue({
      choices: [{ message: { content: 'response from choices' } }],
      usage: { total_tokens: 5 },
    });

    const result = await openAIService.getChatResponse('hi');
    expect(result.answer).toBe('response from choices');
  });

  it('throws descriptive error when response has no text', async () => {
    openAIService.makeRequest.mockResolvedValue({});

    await expect(openAIService.getChatResponse('hi')).rejects.toThrow(/No response generated.*Raw response/);
  });
});
