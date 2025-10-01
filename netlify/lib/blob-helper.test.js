import { jest } from '@jest/globals';

describe('blob-helper path prefix', () => {
  afterEach(() => {
    delete process.env.RAG_BLOB_PREFIX;
    delete process.env.RAG_S3_PREFIX;
    delete process.env.S3_PREFIX;
    jest.resetModules();
  });

  const loadInternal = async () => {
    jest.resetModules();
    const module = await import('./blob-helper.js');
    return module.__internal;
  };

  test('uses configured prefix when building object key', async () => {
    process.env.RAG_BLOB_PREFIX = 'allowed/uploads';

    const { buildObjectKey } = await loadInternal();
    const key = buildObjectKey({
      userId: 'auth0|example',
      documentId: 'doc id',
      filename: 'Quarterly Report.pdf',
    });

    expect(key.split('/').slice(0, 2).join('/')).toBe('allowed/uploads');
    expect(key).toContain('auth0-example');
    expect(key).toMatch(/\.pdf$/);
  });

  test('falls back to default prefix when override is empty', async () => {
    process.env.RAG_BLOB_PREFIX = '   ';

    const { buildObjectKey } = await loadInternal();
    const key = buildObjectKey({
      userId: 'user',
      documentId: 'doc',
      filename: 'file.txt',
    });

    expect(key.startsWith('rag-documents/')).toBe(true);
  });
});

describe('uploadDocumentToBlobStore integration', () => {
  afterEach(() => {
    delete process.env.RAG_BLOB_STORE;
    delete process.env.RAG_BLOB_PREFIX;
    delete process.env.NETLIFY_BLOBS_SITE_ID;
    delete process.env.NETLIFY_SITE_ID;
    delete process.env.NETLIFY_BLOBS_TOKEN;
    delete process.env.NETLIFY_AUTH_TOKEN;
    delete global.__UPLOAD_DOCUMENT_TO_BLOB_MOCK__;
    jest.resetModules();
  });

  test('passes metadata and configuration to blob mock', async () => {
    const uploadMock = jest.fn().mockResolvedValue({
      provider: 'netlify-blobs',
      store: 'custom-store',
      key: 'custom-prefix/user/doc',
      path: 'custom-store/custom-prefix/user/doc',
      url: null,
      size: 4,
      contentType: 'application/pdf',
    });

    process.env.RAG_BLOB_STORE = 'custom-store';
    process.env.RAG_BLOB_PREFIX = 'custom-prefix';
    global.__UPLOAD_DOCUMENT_TO_BLOB_MOCK__ = uploadMock;

    const module = await import('./blob-helper.js');

    const result = await module.uploadDocumentToBlobStore({
      body: Buffer.from('test'),
      contentType: 'application/pdf',
      userId: 'user-123',
      documentId: 'doc-456',
      filename: 'Policy.pdf',
      metadata: { 'x-user-id': 'user-123' },
    });

    expect(uploadMock).toHaveBeenCalledTimes(1);
    const payload = uploadMock.mock.calls[0][0];
    expect(payload.store).toBe('custom-store');
    expect(payload.prefix).toBe('custom-prefix');
    expect(payload.userId).toBe('user-123');
    expect(payload.documentId).toBe('doc-456');
    expect(payload.filename).toBe('Policy.pdf');

    expect(result).toEqual(
      expect.objectContaining({ provider: 'netlify-blobs', store: 'custom-store' })
    );
  });
});

describe('Netlify Blob environment fallback', () => {
  afterEach(() => {
    delete process.env.NETLIFY_BLOBS_SITE_ID;
    delete process.env.NETLIFY_SITE_ID;
    delete process.env.NETLIFY_BLOBS_TOKEN;
    delete process.env.NETLIFY_AUTH_TOKEN;
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('retries getStore with manual credentials when default environment is missing', async () => {
    jest.resetModules();

    const missingEnvError = new Error(
      'The environment has not been configured to use Netlify Blobs'
    );
    missingEnvError.name = 'MissingBlobsEnvironmentError';

    const storeSet = jest.fn().mockResolvedValue();
    const getStoreMock = jest
      .fn()
      .mockImplementationOnce(() => {
        throw missingEnvError;
      })
      .mockReturnValue({ set: storeSet });

    jest.unstable_mockModule('@netlify/blobs', () => ({
      getStore: getStoreMock,
    }));

    process.env.NETLIFY_BLOBS_SITE_ID = 'site-123';
    process.env.NETLIFY_BLOBS_TOKEN = 'token-abc';

    const module = await import('./blob-helper.js');

    await module.uploadDocumentToBlobStore({
      body: Buffer.from('data'),
      userId: 'user-1',
      documentId: 'doc-1',
      filename: 'file.txt',
    });

    expect(getStoreMock).toHaveBeenNthCalledWith(1, 'rag-documents');
    expect(getStoreMock).toHaveBeenNthCalledWith(2, {
      name: 'rag-documents',
      siteID: 'site-123',
      token: 'token-abc',
    });
    expect(storeSet).toHaveBeenCalledTimes(1);
  });
});

describe('listBlobFiles', () => {
  afterEach(() => {
    delete process.env.RAG_BLOB_PREFIX;
    delete process.env.RAG_BLOB_STORE;
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('returns normalized blob metadata with derived fields', async () => {
    jest.resetModules();

    const listMock = jest.fn().mockResolvedValue({
      blobs: [
        { key: 'rag-documents/user-1/doc-abc/report.pdf', etag: 'etag-1' },
        { key: 'rag-documents/user-2/doc-def/manual.txt', etag: 'etag-2' },
      ],
      directories: [],
    });

    const getMetadataMock = jest
      .fn()
      .mockResolvedValueOnce({
        etag: 'etag-1',
        metadata: {
          'x-user-id': 'user-1',
          'x-document-id': 'doc-abc',
          'size-bytes': '2048',
          'content-type': 'application/pdf',
          uploadedAt: '2024-02-01T10:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({ etag: 'etag-2', metadata: {} });

    jest.unstable_mockModule('@netlify/blobs', () => ({
      getStore: jest.fn().mockReturnValue({
        list: listMock,
        getMetadata: getMetadataMock,
      }),
    }));

    const module = await import('./blob-helper.js');
    const result = await module.listBlobFiles();

    expect(listMock).toHaveBeenCalledWith({ prefix: 'rag-documents/' });
    expect(result.store).toBe('rag-documents');
    expect(result.blobs).toHaveLength(2);
    expect(result.blobs[0]).toEqual(
      expect.objectContaining({
        key: 'rag-documents/user-1/doc-abc/report.pdf',
        userId: 'user-1',
        documentId: 'doc-abc',
        size: 2048,
        contentType: 'application/pdf',
        uploadedAt: '2024-02-01T10:00:00.000Z',
      })
    );
    expect(result.blobs[0].metadata['x-user-id']).toBe('user-1');
    expect(result.blobs[1]).toEqual(
      expect.objectContaining({
        key: 'rag-documents/user-2/doc-def/manual.txt',
        userId: 'user-2',
        documentId: 'doc-def',
        size: null,
      })
    );
    expect(result.truncated).toBe(false);
  });

  test('honors custom prefix and limit options', async () => {
    jest.resetModules();

    process.env.RAG_BLOB_PREFIX = 'custom-prefix';

    const listMock = jest.fn().mockResolvedValue({
      blobs: [
        { key: 'custom-prefix/user-a/doc-1/file-one.txt', etag: 'etag-1' },
        { key: 'custom-prefix/user-b/doc-2/file-two.txt', etag: 'etag-2' },
      ],
      directories: [],
    });

    const getMetadataMock = jest.fn().mockResolvedValue({ etag: 'etag-1', metadata: {} });

    jest.unstable_mockModule('@netlify/blobs', () => ({
      getStore: jest.fn().mockReturnValue({
        list: listMock,
        getMetadata: getMetadataMock,
      }),
    }));

    const module = await import('./blob-helper.js');
    const result = await module.listBlobFiles({ prefix: 'custom-prefix', limit: 1 });

    expect(listMock).toHaveBeenCalledWith({ prefix: 'custom-prefix/' });
    expect(result.blobs).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(result.prefix).toBe('custom-prefix');
  });
});
