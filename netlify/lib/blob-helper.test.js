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
