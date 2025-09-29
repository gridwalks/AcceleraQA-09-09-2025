import { jest } from '@jest/globals';

const uploadDocumentToS3Mock = jest.fn();

let handleUpload;

const loadModule = async () => {
  jest.resetModules();
  uploadDocumentToS3Mock.mockReset();
  uploadDocumentToS3Mock.mockResolvedValue({
    bucket: 'bucket-123',
    region: 'us-east-1',
    key: 'rag-documents/user/doc-1',
    url: 'https://bucket-123.s3.amazonaws.com/rag-documents/user/doc-1',
    etag: 'etag-123',
    size: 4,
    versionId: 'version-1',
  });

  process.env.RAG_S3_BUCKET = 'bucket-123';
  process.env.RAG_S3_REGION = 'us-east-1';
  global.__UPLOAD_DOCUMENT_TO_S3_MOCK__ = uploadDocumentToS3Mock;

  const module = await import('../netlify/functions/neon-rag-fixed.js');
  handleUpload = module.__testHelpers.handleUpload;
};

beforeEach(async () => {
  jest.resetAllMocks();
  await loadModule();
});

afterEach(() => {
  delete process.env.RAG_S3_BUCKET;
  delete process.env.RAG_S3_REGION;
  delete process.env.RAG_S3_PREFIX;
  delete process.env.S3_PREFIX;
  delete global.__UPLOAD_DOCUMENT_TO_S3_MOCK__;
});

describe('neon-rag-fixed handleUpload', () => {
  test('uploads binary payload to S3 and persists storage metadata', async () => {
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

    expect(uploadDocumentToS3Mock).toHaveBeenCalledTimes(1);
    const uploadArgs = uploadDocumentToS3Mock.mock.calls[0][0];
    expect(uploadArgs.userId).toBe('user-123');
    expect(uploadArgs.documentId).toBe('doc-1');
    expect(uploadArgs.filename).toBe('Policy.pdf');
    expect(uploadArgs.body.equals(Buffer.from('fake'))).toBe(true);

    expect(capturedMetadata[0].storage).toEqual(
      expect.objectContaining({ provider: 's3', bucket: 'bucket-123', key: expect.any(String) })
    );

    const parsed = JSON.parse(response.body);
    expect(parsed.storageLocation).toEqual(
      expect.objectContaining({ bucket: 'bucket-123', key: expect.stringContaining('rag-documents/user') })
    );
    expect(parsed.document.metadata.storage).toEqual(
      expect.objectContaining({ provider: 's3', url: expect.stringContaining('https://bucket-123.s3.amazonaws.com') })
    );
  });

  test('surfaces helpful message when S3 denies access', async () => {
    const error = new Error('Access denied');
    error.name = 'AccessDenied';
    error.statusCode = 403;
    uploadDocumentToS3Mock.mockRejectedValueOnce(error);

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
      message: expect.stringContaining('Access denied when uploading document to S3'),
      statusCode: 403,
    });
  });
});
