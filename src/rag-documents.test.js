import { jest } from '@jest/globals';

const uploadDocumentToOneDriveMock = jest.fn();

let downloadDocumentContentFromOpenAI;
let handleSaveDocument;

const loadModule = async () => {
  jest.resetModules();
  uploadDocumentToOneDriveMock.mockReset();
  uploadDocumentToOneDriveMock.mockResolvedValue({
    driveId: 'drive-123',
    siteId: null,
    path: 'rag-documents/user/doc-1',
    itemId: 'item-456',
    url: 'https://contoso.sharepoint.com/sites/site/Documents/rag-documents/user/doc-1',
    etag: 'etag-123',
    size: 4,
  });

  process.env.RAG_ONEDRIVE_ACCESS_TOKEN = 'token';
  process.env.RAG_ONEDRIVE_DRIVE_ID = 'drive-123';
  global.__UPLOAD_DOCUMENT_TO_ONEDRIVE_MOCK__ = uploadDocumentToOneDriveMock;

  const module = await import('../netlify/functions/rag-documents.js');
  downloadDocumentContentFromOpenAI = module.__testHelpers.downloadDocumentContentFromOpenAI;
  handleSaveDocument = module.__testHelpers.handleSaveDocument;
};

beforeEach(async () => {
  jest.resetAllMocks();
  await loadModule();
});

afterEach(() => {
  delete global.fetch;
  delete process.env.RAG_ONEDRIVE_ACCESS_TOKEN;
  delete process.env.RAG_ONEDRIVE_DRIVE_ID;
  delete process.env.RAG_ONEDRIVE_ROOT_PATH;
  delete process.env.ONEDRIVE_ROOT_PATH;
  delete global.__UPLOAD_DOCUMENT_TO_ONEDRIVE_MOCK__;
});

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

describe('rag-documents OneDrive integration', () => {
  test('handleSaveDocument uploads content to OneDrive and stores metadata reference', async () => {
    const insertedRows = [];
    const sqlMock = jest.fn(async (strings, ...values) => {
      const query = strings.join(' ');
      if (query.includes('INSERT INTO rag_user_documents')) {
        const [documentId, userId, fileId, filename, contentType, size, metadata] = values;
        insertedRows.push({ documentId, userId, fileId, filename, contentType, size, metadata });
        return [
          {
            document_id: documentId,
            file_id: fileId,
            filename,
            content_type: contentType,
            size,
            metadata,
            chunks: values[7],
            vector_store_id: values[8],
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
          },
        ];
      }
      return [];
    });

    const response = await handleSaveDocument(sqlMock, 'user-123', {
      document: {
        id: 'doc-1',
        fileId: 'doc-1',
        filename: 'Policy.pdf',
        type: 'application/pdf',
        content: Buffer.from('fake').toString('base64'),
        encoding: 'base64',
        metadata: { category: 'Policy' },
      },
    });

    expect(uploadDocumentToOneDriveMock).toHaveBeenCalledTimes(1);
    const uploadArgs = uploadDocumentToOneDriveMock.mock.calls[0][0];
    expect(uploadArgs.filename).toBe('Policy.pdf');
    expect(Buffer.isBuffer(uploadArgs.body)).toBe(true);
    expect(uploadArgs.body.equals(Buffer.from('fake'))).toBe(true);
    expect(uploadArgs.userId).toBe('user-123');

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].metadata.storage).toEqual(
      expect.objectContaining({ provider: 'onedrive', driveId: 'drive-123', path: expect.stringContaining('rag-documents/user') })
    );

    const parsed = JSON.parse(response.body);
    expect(parsed.storageLocation).toEqual(
      expect.objectContaining({ driveId: 'drive-123', path: expect.stringContaining('rag-documents/user') })
    );
    expect(parsed.document.metadata.storage).toEqual(
      expect.objectContaining({ provider: 'onedrive', url: expect.stringContaining('https://contoso.sharepoint.com') })
    );
  });
});

describe('downloadDocumentContentFromOpenAI', () => {
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
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.buffer.equals(fileBytes)).toBe(true);

    warnSpy.mockRestore();
  });
});
