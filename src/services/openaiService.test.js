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

  it('handles responses API payload with output array not first element', async () => {
    openAIService.makeRequest.mockResolvedValue({
      output: [
        { role: 'meta' },
        { role: 'assistant', content: [{ text: 'response from output array' }] },
      ],
      usage: { total_tokens: 7 },
    });

    const result = await openAIService.getChatResponse('howdy');
    expect(result.answer).toBe('response from output array');
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

  it('uses file search when a document is provided', async () => {
    const file = { name: 'doc.pdf', type: 'application/pdf' };

    jest.spyOn(openAIService, 'uploadFile').mockResolvedValue('file-123');
    jest.spyOn(openAIService, 'createVectorStore').mockResolvedValue('vs-456');
    jest.spyOn(openAIService, 'attachFileToVectorStore').mockResolvedValue({});

    openAIService.makeRequest.mockResolvedValue({
      output_text: 'response from file',
      usage: { total_tokens: 3 },
    });

    const result = await openAIService.getChatResponse('hi', file);

    expect(openAIService.uploadFile).toHaveBeenCalledWith(file);
    expect(openAIService.createVectorStore).toHaveBeenCalled();
    expect(openAIService.attachFileToVectorStore).toHaveBeenCalledWith('vs-456', 'file-123');
    expect(result.answer).toBe('response from file');
  });
});
