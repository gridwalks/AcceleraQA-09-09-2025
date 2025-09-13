import { jest } from '@jest/globals';
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
