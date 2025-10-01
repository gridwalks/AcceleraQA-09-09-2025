import { jest } from '@jest/globals';

const uploadDocumentToBlobMock = jest.fn();

let downloadDocumentContentFromOpenAI;
let handleSaveDocument;
let handleDownloadDocument;
let handleListDocuments;

const loadModule = async () => {
  jest.resetModules();
  uploadDocumentToBlobMock.mockReset();
  uploadDocumentToBlobMock.mockResolvedValue({
    provider: 'netlify-blobs',
    store: 'rag-documents',
    key: 'rag-documents/user/doc-1',
    path: 'rag-documents/rag-documents/user/doc-1',
    url: null,
    size: 4,
    contentType: 'application/pdf',
  });

  process.env.RAG_BLOB_STORE = 'rag-documents';
  process.env.RAG_BLOB_PREFIX = 'rag-documents';
  global.__UPLOAD_DOCUMENT_TO_BLOB_MOCK__ = uploadDocumentToBlobMock;

  const module = await import('../netlify/functions/rag-documents.js');
  downloadDocumentContentFromOpenAI = module.__testHelpers.downloadDocumentContentFromOpenAI;
  handleSaveDocument = module.__testHelpers.handleSaveDocument;
  handleDownloadDocument = module.__testHelpers.handleDownloadDocument;
  handleListDocuments = module.__testHelpers.handleListDocuments;
};

beforeEach(async () => {
  jest.resetAllMocks();
  await loadModule();
});

afterEach(() => {
  delete global.fetch;
  delete process.env.RAG_BLOB_STORE;
  delete process.env.RAG_BLOB_PREFIX;
  delete process.env.RAG_S3_PREFIX;
  delete process.env.S3_PREFIX;
  delete global.__UPLOAD_DOCUMENT_TO_BLOB_MOCK__;
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

describe('rag-documents Netlify Blob integration', () => {
  test('handleSaveDocument uploads content to Netlify Blob store and stores metadata reference', async () => {
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

    expect(uploadDocumentToBlobMock).toHaveBeenCalledTimes(1);
    const uploadArgs = uploadDocumentToBlobMock.mock.calls[0][0];
    expect(uploadArgs.filename).toBe('Policy.pdf');
    expect(Buffer.isBuffer(uploadArgs.body)).toBe(true);
    expect(uploadArgs.body.equals(Buffer.from('fake'))).toBe(true);
    expect(uploadArgs.userId).toBe('user-123');

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].metadata.storage).toEqual(
      expect.objectContaining({
        provider: 'netlify-blobs',
        store: 'rag-documents',
        key: expect.stringContaining('rag-documents/user'),
      })
    );

    const parsed = JSON.parse(response.body);
    expect(parsed.storageLocation).toEqual(
      expect.objectContaining({
        provider: 'netlify-blobs',
        store: 'rag-documents',
        key: expect.stringContaining('rag-documents/user'),
      })
    );
    expect(parsed.document.metadata.storage).toEqual(
      expect.objectContaining({ provider: 'netlify-blobs', store: 'rag-documents' })
    );
  });
});

describe('handleDownloadDocument', () => {
  test('returns Neon metadata when rag_user_documents has no entry', async () => {
    const storageLocation = {
      provider: 'netlify-blobs',
      url: 'https://example.com/blob',
      size: 2048,
      contentType: 'application/pdf',
    };

    const neonRow = {
      id: 42,
      filename: 'Doc.pdf',
      file_type: 'application/pdf',
      file_size: 2048,
      metadata: {
        storage: storageLocation,
        fileName: 'Doc.pdf',
      },
    };

    const sqlMock = jest.fn(async (strings, ...values) => {
      const query = strings.join(' ').replace(/\s+/g, ' ').trim();

      if (query.includes('FROM rag_user_documents')) {
        expect(query).toContain("metadata->>'sharedWithAllUsers'");
        expect(values).toEqual(expect.arrayContaining(['user-1']));
        return [];
      }

      if (query.includes('FROM rag_documents') && query.includes('id =')) {
        expect(values).toEqual(expect.arrayContaining(['user-1', 42]));
        return [neonRow];
      }

      throw new Error(`Unexpected query executed: ${query}`);
    });

    const response = await handleDownloadDocument(sqlMock, 'user-1', { documentId: '42' });
    expect(response.statusCode).toBe(200);

    const payload = JSON.parse(response.body);
    expect(payload).toMatchObject({
      documentId: '42',
      filename: 'Doc.pdf',
      storageLocation,
      contentType: 'application/pdf',
      size: 2048,
    });
  });

  test('returns 404 when neither table contains a match', async () => {
    const sqlMock = jest.fn(async (strings, ...values) => {
      const query = strings.join(' ').replace(/\s+/g, ' ').trim();

      if (query.includes('FROM rag_user_documents')) {
        return [];
      }

      if (query.includes('FROM rag_documents')) {
        return [];
      }

      throw new Error(`Unexpected query executed: ${query}`);
    });

    const response = await handleDownloadDocument(sqlMock, 'user-1', { documentId: '99' });
    expect(response.statusCode).toBe(404);
    const payload = JSON.parse(response.body);
    expect(payload.error).toBe('Document not found or access is restricted');
  });
});

describe('admin document sharing controls', () => {
  test('handleSaveDocument marks admin uploads as shared for all users', async () => {
    const insertedRows = [];
    const sqlMock = jest.fn(async (strings, ...values) => {
      const query = strings.join(' ').replace(/\s+/g, ' ').trim();

      if (query.includes('INSERT INTO rag_user_documents')) {
        const [, , , , , , metadata] = values;
        insertedRows.push(metadata);
        return [
          {
            document_id: values[0],
            file_id: values[2],
            filename: values[3],
            content_type: values[4],
            size: values[5],
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

    const response = await handleSaveDocument(
      sqlMock,
      'admin-user',
      {
        document: {
          id: 'doc-admin',
          fileId: 'doc-admin',
          filename: 'Guide.pdf',
          type: 'application/pdf',
          metadata: { title: 'Admin Guide' },
        },
      },
      { isAdmin: true, organization: 'Acme Pharma' }
    );

    expect(insertedRows).toHaveLength(1);
    const storedMetadata = insertedRows[0];
    expect(storedMetadata.sharedWithAllUsers).toBe(true);
    expect(storedMetadata.shared_with_all_users).toBe(true);
    expect(storedMetadata.visibility).toBe('global');
    expect(storedMetadata.audience).toBe('all');
    expect(storedMetadata.sharedAudience).toBe('all-users');
    expect(storedMetadata.organization).toBe('Acme Pharma');
    expect(storedMetadata.uploaderRole).toBe('admin');

    const payload = JSON.parse(response.body);
    expect(payload.document.metadata.sharedWithAllUsers).toBe(true);
    expect(payload.document.metadata.visibility).toBe('global');
  });

  test('handleSaveDocument strips shared metadata from non-admin uploads', async () => {
    const insertedRows = [];
    const sqlMock = jest.fn(async (strings, ...values) => {
      const query = strings.join(' ').replace(/\s+/g, ' ').trim();

      if (query.includes('INSERT INTO rag_user_documents')) {
        insertedRows.push(values[6]);
        return [
          {
            document_id: values[0],
            file_id: values[2],
            filename: values[3],
            content_type: values[4],
            size: values[5],
            metadata: values[6],
            chunks: values[7],
            vector_store_id: values[8],
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
          },
        ];
      }

      return [];
    });

    const response = await handleSaveDocument(sqlMock, 'user-55', {
      document: {
        id: 'doc-user',
        fileId: 'doc-user',
        filename: 'Checklist.pdf',
        type: 'application/pdf',
        metadata: {
          title: 'Checklist',
          sharedWithAllUsers: true,
          visibility: 'global',
        },
      },
    });

    expect(insertedRows).toHaveLength(1);
    const storedMetadata = insertedRows[0];
    expect(storedMetadata.sharedWithAllUsers).toBeUndefined();
    expect(storedMetadata.visibility).not.toBe('global');

    const payload = JSON.parse(response.body);
    expect(payload.document.metadata.sharedWithAllUsers).toBeUndefined();
    expect(payload.document.metadata.visibility).not.toBe('global');
  });

  test('handleListDocuments includes shared admin documents for all users', async () => {
    const sqlMock = jest.fn(async (strings, ...values) => {
      const query = strings.join(' ').replace(/\s+/g, ' ').trim();
      expect(query).toContain("metadata->>'sharedWithAllUsers'");
      expect(values).toContain('user-b');

      return [
        {
          document_id: 'doc-user',
          file_id: 'doc-user',
          filename: 'User.pdf',
          content_type: 'application/pdf',
          size: 1024,
          metadata: { title: 'User Doc' },
          chunks: 0,
          vector_store_id: 'vs-1',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
        {
          document_id: 'doc-shared',
          file_id: 'doc-shared',
          filename: 'Admin.pdf',
          content_type: 'application/pdf',
          size: 2048,
          metadata: { title: 'Admin Doc', sharedWithAllUsers: true },
          chunks: 0,
          vector_store_id: 'vs-2',
          created_at: '2024-01-02T00:00:00.000Z',
          updated_at: '2024-01-02T00:00:00.000Z',
        },
      ];
    });

    const response = await handleListDocuments(sqlMock, 'user-b');
    expect(response.statusCode).toBe(200);

    const payload = JSON.parse(response.body);
    expect(payload.total).toBe(2);
    const ids = payload.documents.map(doc => doc.id);
    expect(ids).toEqual(expect.arrayContaining(['doc-user', 'doc-shared']));
  });

  test('handleDownloadDocument returns shared admin document for non-owner', async () => {
    const sqlMock = jest.fn(async (strings, ...values) => {
      const query = strings.join(' ').replace(/\s+/g, ' ').trim();

      if (query.includes('FROM rag_user_documents')) {
        return [
          {
            user_id: 'admin-user',
            document_id: 'doc-shared',
            file_id: 'doc-shared',
            filename: 'Admin.pdf',
            content_type: 'application/pdf',
            size: 2048,
            metadata: { sharedWithAllUsers: true, storage: { url: 'https://example.com/shared.pdf', provider: 'netlify-blobs' } },
            vector_store_id: null,
            content_base64: null,
            content_encoding: null,
          },
        ];
      }

      return [];
    });

    const response = await handleDownloadDocument(sqlMock, 'user-b', { documentId: 'doc-shared' });
    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.documentId).toBe('doc-shared');
    expect(payload.storageLocation.url).toBe('https://example.com/shared.pdf');
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
