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

let mockConvertDocxToPdfIfNeeded = async (file) => ({
  file,
  converted: false,
  originalFileName: file?.name || null,
  originalMimeType: file?.type || null,
});

jest.mock('../utils/fileConversion', () => ({
  convertDocxToPdfIfNeeded: (...args) => mockConvertDocxToPdfIfNeeded(...args),
}));

import openAIService from './openaiService';
import { OPENAI_CONFIG } from '../config/constants';

describe('openAIService uploadFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConvertDocxToPdfIfNeeded = jest.fn(async (file) => ({
      file,
      converted: false,
      originalFileName: file?.name || null,
      originalMimeType: file?.type || null,
    }));
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'file-id' }),
    });
    global.FormData = class {
      constructor() {
        this.entries = [];
      }
      append(key, value) {
        this.entries.push([key, value]);
      }
    };
  });

  it('uploads supported file types', async () => {
    const file = { name: 'doc.pdf', type: 'application/pdf' };
    const id = await openAIService.uploadFile(file);
    expect(id).toBe('file-id');
    expect(fetch).toHaveBeenCalled();
    expect(mockConvertDocxToPdfIfNeeded).toHaveBeenCalledWith(file);
  });

  it('rejects unsupported file types', async () => {
    const file = { name: 'image.png', type: 'image/png' };
    await expect(openAIService.uploadFile(file)).rejects.toThrow('Unsupported file type; please upload a PDF, TXT, MD, or DOCX file');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('converts DOCX files before uploading', async () => {
    const originalFile = {
      name: 'policy.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };

    const convertedFile = {
      name: 'policy.pdf',
      type: 'application/pdf',
    };

    mockConvertDocxToPdfIfNeeded.mockResolvedValue({
      file: convertedFile,
      converted: true,
      originalFileName: originalFile.name,
      originalMimeType: originalFile.type,
    });

    const id = await openAIService.uploadFile(originalFile);

    expect(id).toBe('file-id');
    expect(mockConvertDocxToPdfIfNeeded).toHaveBeenCalledWith(originalFile);
    const options = fetch.mock.calls[0][1];
    expect(options.body).toBeInstanceOf(FormData);
    const appendedFile = options.body.entries.find(([key]) => key === 'file')[1];
    expect(appendedFile).toBe(convertedFile);
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

    const [, options] = openAIService.makeRequest.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.input).toEqual([
      {
        role: 'system',
        content: [{ type: 'input_text', text: OPENAI_CONFIG.SYSTEM_PROMPT }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }],
      },
    ]);
  });

  it('handles responses API payload with output array not first element', async () => {
    openAIService.makeRequest.mockResolvedValue({
      output: [
        { role: 'meta' },
        {
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: { value: 'response from output array' },
            },
          ],
        },
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

  it('extracts assistant text from structured choice content arrays', async () => {
    openAIService.makeRequest.mockResolvedValue({
      choices: [
        {
          message: {
            content: [
              {
                type: 'output_text',
                text: { value: 'response from structured choices' },
              },
            ],
          },
        },
      ],
      usage: { total_tokens: 6 },
    });

    const result = await openAIService.getChatResponse('structured');
    expect(result.answer).toBe('response from structured choices');
  });

  it('includes prior messages in payload when history is provided', async () => {
    openAIService.makeRequest.mockResolvedValue({
      output_text: 'response with history',
      usage: { total_tokens: 12 },
    });

    const history = [
      { role: 'user', content: 'What is GMP?' },
      { role: 'assistant', content: 'It is Good Manufacturing Practice.' },
    ];

    const result = await openAIService.getChatResponse('Explain validation steps', null, history);
    expect(result.answer).toBe('response with history');

    const [, options] = openAIService.makeRequest.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.input).toEqual([
      {
        role: 'system',
        content: [{ type: 'input_text', text: OPENAI_CONFIG.SYSTEM_PROMPT }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'What is GMP?' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: 'It is Good Manufacturing Practice.' }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Explain validation steps' }],
      },
    ]);
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

    const [, options] = openAIService.makeRequest.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.input[0]).toEqual({
      role: 'system',
      content: [{ type: 'input_text', text: OPENAI_CONFIG.SYSTEM_PROMPT }],
    });
    expect(body.input[1]).toEqual({
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: 'hi',
        },
      ],
    });
    body.input[1].content.forEach(part => {
      expect(part.attachments).toBeUndefined();
    });
    expect(body.attachments).toEqual([
      {
        vector_store_id: 'vs-456',
        tools: [{ type: 'file_search' }],
      },
    ]);
    expect(body.tools).toEqual([{ type: 'file_search' }]);
    expect(body).not.toHaveProperty('tool_resources');
  });
});

describe('openAIService makeRequest sanitization', () => {
  beforeEach(() => {
    openAIService.apiKey = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('removes tool_resources and consolidates attachments at the root for responses payloads', async () => {
    const payload = {
      model: 'test-model',
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: 'system prompt' }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'hello',
              attachments: [
                { vector_store_id: 'content-vs', tool_resources: { example: true } },
              ],
            },
          ],
          attachments: [{ vector_store_id: 'message-vs' }],
        },
      ],
      tool_resources: {
        file_search: { vector_store_ids: ['root-vs'] },
      },
      attachments: [{ vector_store_id: 'root-vs' }],
    };

    await openAIService.makeRequest('/responses', {
      body: JSON.stringify(payload),
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [, options] = fetch.mock.calls[0];
    const sanitized = JSON.parse(options.body);

    expect(sanitized.tool_resources).toBeUndefined();
    expect(Array.isArray(sanitized.attachments)).toBe(true);
    expect(sanitized.attachments).toEqual([
      { vector_store_id: 'root-vs' },
      { vector_store_id: 'content-vs' },
      { vector_store_id: 'message-vs' },
    ]);

    expect(Array.isArray(sanitized.input)).toBe(true);
    const userMessage = sanitized.input.find(msg => msg.role === 'user');
    expect(userMessage).toBeDefined();
    expect(userMessage.attachments).toBeUndefined();

    userMessage.content.forEach(part => {
      if (part && typeof part === 'object') {
        expect(part.attachments).toBeUndefined();
      }
    });

    sanitized.attachments.forEach(attachment => {
      expect(attachment.tool_resources).toBeUndefined();
    });
  });
});
