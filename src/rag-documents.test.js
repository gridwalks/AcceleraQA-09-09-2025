import { __testHelpers } from '../netlify/functions/rag-documents.js';
import { jest } from '@jest/globals';

const { downloadDocumentContentFromOpenAI } = __testHelpers;

const createMockResponse = ({
  ok = true,
  status = 200,
  contentType = 'application/octet-stream',
  textBody = '',
  arrayBufferData,
}) => {
  const toArrayBuffer = () => {
    if (arrayBufferData instanceof ArrayBuffer) {
      return arrayBufferData;
    }

    if (arrayBufferData) {
      if (Buffer.isBuffer(arrayBufferData)) {
        return arrayBufferData.buffer.slice(
          arrayBufferData.byteOffset,
          arrayBufferData.byteOffset + arrayBufferData.byteLength
        );
      }

      if (ArrayBuffer.isView(arrayBufferData)) {
        return arrayBufferData.buffer.slice(
          arrayBufferData.byteOffset,
          arrayBufferData.byteOffset + arrayBufferData.byteLength
        );
      }
    }

    const fallbackBuffer = Buffer.from(textBody, 'utf8');
    return fallbackBuffer.buffer.slice(
      fallbackBuffer.byteOffset,
      fallbackBuffer.byteOffset + fallbackBuffer.byteLength
    );
  };

  const response = {
    ok,
    status,
    headers: { get: () => contentType },
    arrayBuffer: async () => toArrayBuffer(),
    text: async () => textBody,
  };

  response.clone = () => ({
    text: async () => textBody,
  });

  return response;
};

describe('downloadDocumentContentFromOpenAI', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('falls back to file endpoint when vector store endpoint returns JSON payload', async () => {
    const vectorStoreJson = {
      object: 'vector_store.file_content',
      data: [
        {
          object: 'vector_store.file_chunk',
          chunk: 'example',
        },
      ],
    };

    const vectorStoreResponse = createMockResponse({
      ok: true,
      status: 200,
      contentType: 'application/json',
      textBody: JSON.stringify(vectorStoreJson),
    });

    const fileBytes = Buffer.from('file-content');
    const fileResponse = createMockResponse({
      ok: true,
      status: 200,
      contentType: 'application/pdf',
      arrayBufferData: fileBytes,
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(vectorStoreResponse)
      .mockResolvedValueOnce(fileResponse);

    const result = await downloadDocumentContentFromOpenAI({
      apiKey: 'test-key',
      fileId: 'file-123',
      vectorStoreId: 'vs-456',
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.openai.com/v1/vector_stores/vs-456/files/file-123/content',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.openai.com/v1/files/file-123/content',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      })
    );

    expect(result.contentType).toBe('application/pdf');
    expect(result.buffer.equals(fileBytes)).toBe(true);

    expect(warnSpy).toHaveBeenCalledWith(
      'Received vector store JSON payload while retrieving document content via vector-store endpoint. Falling back to next endpoint.'
    );

    warnSpy.mockRestore();
  });
});
