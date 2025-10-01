import { jest } from '@jest/globals';

const uploadDocumentToBlobMock = jest.fn();

let handleUpload;

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

  const module = await import('../netlify/functions/neon-rag-fixed.js');
  handleUpload = module.__testHelpers.handleUpload;
};

beforeEach(async () => {
  jest.resetAllMocks();
  await loadModule();
});

afterEach(() => {
  delete process.env.RAG_BLOB_STORE;
  delete process.env.RAG_BLOB_PREFIX;
  delete process.env.RAG_S3_PREFIX;
  delete process.env.S3_PREFIX;
  delete global.__UPLOAD_DOCUMENT_TO_BLOB_MOCK__;
});

describe('neon-rag-fixed handleUpload', () => {
  test('uploads binary payload to Netlify Blob store and persists storage metadata', async () => {
    const capturedMetadata = [];
    const sqlMock = jest.fn(async (strings, ...values) => {
      const query = strings.join(' ');
      if (query.includes('SELECT enumlabel')) {
        return [];
      }
      if (query.includes('INSERT INTO rag_documents')) {
        const metadataJson = values[6];
        const metadata = metadataJson ? JSON.parse(metadataJson) : {};
        capturedMetadata.push(metadata);
        return [
          {
            id: 42,
            filename: values[1],
            original_filename: values[2],
            file_type: values[3],
            file_size: values[4],
            metadata,
            title: values[7],
            summary: values[8],
            version: values[9],
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
          },
        ];
      }
      if (query.includes('INSERT INTO rag_document_chunks')) {
        return [];
      }
      return [];
    });

    const payload = {
      document: {
        documentId: 'doc-1',
        filename: 'Policy.pdf',
        text: 'Document body',
        type: 'application/pdf',
        content: Buffer.from('fake').toString('base64'),
        encoding: 'base64',
        metadata: { category: 'Policy' },
      },
    };

    const response = await handleUpload(sqlMock, 'user-123', payload);

    expect(uploadDocumentToBlobMock).toHaveBeenCalledTimes(1);
    const uploadArgs = uploadDocumentToBlobMock.mock.calls[0][0];
    expect(uploadArgs.userId).toBe('user-123');
    expect(uploadArgs.documentId).toBe('doc-1');
    expect(uploadArgs.filename).toBe('Policy.pdf');
    expect(uploadArgs.body.equals(Buffer.from('fake'))).toBe(true);

    expect(capturedMetadata[0].storage).toEqual(
      expect.objectContaining({
        provider: 'netlify-blobs',
        store: 'rag-documents',
        key: expect.any(String),
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

  test('surfaces helpful message when Netlify Blob store upload fails', async () => {
    const error = new Error('Access denied');
    error.statusCode = 403;
    uploadDocumentToBlobMock.mockRejectedValueOnce(error);

    const sqlMock = jest.fn(async (strings) => {
      const query = strings.join(' ');
      if (query.includes('SELECT enumlabel')) {
        return [];
      }
      return [];
    });

    const payload = {
      document: {
        documentId: 'doc-1',
        filename: 'Policy.pdf',
        text: 'Document body',
        type: 'application/pdf',
        content: Buffer.from('fake').toString('base64'),
        encoding: 'base64',
      },
    };

    await expect(handleUpload(sqlMock, 'user-123', payload)).rejects.toMatchObject({
      message: expect.stringContaining('Failed to upload document to Netlify Blob store'),
      statusCode: 403,
    });
  });
});
