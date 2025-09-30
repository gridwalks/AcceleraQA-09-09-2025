import { jest } from '@jest/globals';

describe('s3-helper path prefix', () => {
  afterEach(() => {
    delete process.env.RAG_S3_PREFIX;
    delete process.env.S3_PREFIX;
    jest.resetModules();
  });

  const loadInternal = async () => {
    jest.resetModules();
    const module = await import('./s3-helper.js');
    return module.__internal;
  };

  test('uses configured prefix when building object key', async () => {
    process.env.RAG_S3_PREFIX = 'allowed/uploads';

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
    process.env.RAG_S3_PREFIX = '   ';

    const { buildObjectKey } = await loadInternal();
    const key = buildObjectKey({
      userId: 'user',
      documentId: 'doc',
      filename: 'file.txt',
    });

    expect(key.startsWith('rag-documents/')).toBe(true);
  });
});

describe('uploadDocumentToS3 error handling', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env.RAG_S3_BUCKET = 'test-bucket';
    process.env.RAG_S3_REGION = 'us-east-1';
    process.env.RAG_S3_ACCESS_KEY_ID = 'key';
    process.env.RAG_S3_SECRET_ACCESS_KEY = 'secret';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.RAG_S3_BUCKET;
    delete process.env.RAG_S3_REGION;
    delete process.env.RAG_S3_ACCESS_KEY_ID;
    delete process.env.RAG_S3_SECRET_ACCESS_KEY;
    jest.resetModules();
  });

  test('attaches raw response body to thrown error', async () => {
    const responseBody = '<Error>SignatureDoesNotMatch</Error>';
    const textMock = jest.fn().mockResolvedValue(responseBody);

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: textMock,
      headers: { get: () => null },
    });

    const module = await import('./s3-helper.js');

    await expect(
      module.uploadDocumentToS3({
        body: Buffer.from('payload'),
        contentType: 'application/octet-stream',
        userId: 'user',
        documentId: 'doc',
        filename: 'file.txt',
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      responseBody,
    });

    expect(textMock).toHaveBeenCalledTimes(1);
  });
});
