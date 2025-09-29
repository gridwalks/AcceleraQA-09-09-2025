import { jest } from '@jest/globals';

const uploadDocumentToOneDriveMock = jest.fn();

let handleUpload;

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

  const module = await import('../netlify/functions/neon-rag-fixed.js');
  handleUpload = module.__testHelpers.handleUpload;
};

beforeEach(async () => {
  jest.resetAllMocks();
  await loadModule();
});

afterEach(() => {
  delete process.env.RAG_ONEDRIVE_ACCESS_TOKEN;
  delete process.env.RAG_ONEDRIVE_DRIVE_ID;
  delete global.__UPLOAD_DOCUMENT_TO_ONEDRIVE_MOCK__;
});

describe('neon-rag-fixed handleUpload', () => {
  test('uploads binary payload to OneDrive and persists storage metadata', async () => {
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

    expect(uploadDocumentToOneDriveMock).toHaveBeenCalledTimes(1);
    const uploadArgs = uploadDocumentToOneDriveMock.mock.calls[0][0];
    expect(uploadArgs.userId).toBe('user-123');
    expect(uploadArgs.documentId).toBe('doc-1');
    expect(uploadArgs.filename).toBe('Policy.pdf');
    expect(uploadArgs.body.equals(Buffer.from('fake'))).toBe(true);

    expect(capturedMetadata[0].storage).toEqual(
      expect.objectContaining({ provider: 'onedrive', driveId: 'drive-123', path: expect.any(String) })
    );

    const parsed = JSON.parse(response.body);
    expect(parsed.storageLocation).toEqual(
      expect.objectContaining({ driveId: 'drive-123', path: expect.stringContaining('rag-documents/user') })
    );
    expect(parsed.document.metadata.storage).toEqual(
      expect.objectContaining({ provider: 'onedrive', url: expect.stringContaining('https://contoso.sharepoint.com') })
    );
  });

  test('surfaces helpful message when OneDrive denies access', async () => {
    const error = new Error('Access denied');
    error.name = 'AccessDenied';
    error.statusCode = 403;
    uploadDocumentToOneDriveMock.mockRejectedValueOnce(error);

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
      message: expect.stringContaining('Access denied when uploading document to OneDrive'),
      statusCode: 403,
    });
  });
});
