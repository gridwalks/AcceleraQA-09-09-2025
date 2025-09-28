import { jest } from '@jest/globals';

describe('s3-helper key prefix', () => {
  afterEach(() => {
    delete process.env.RAG_S3_PREFIX;
    delete process.env.S3_KEY_PREFIX;
    delete process.env.AWS_S3_PREFIX;
    jest.resetModules();
  });

  test('uses configured prefix when building object keys', async () => {
    jest.resetModules();
    process.env.RAG_S3_PREFIX = 'allowed/uploads';

    const { __internal } = await import('./s3-helper.js');
    const key = __internal.buildObjectKey({
      userId: 'auth0|example',
      documentId: 'doc id',
      filename: 'Quarterly Report.pdf',
    });

    expect(key.split('/').slice(0, 2).join('/')).toBe('allowed/uploads');
    expect(key).toContain('auth0-example');
    expect(key).toMatch(/\.pdf$/);
  });

  test('falls back to default prefix when override is empty', async () => {
    jest.resetModules();
    process.env.RAG_S3_PREFIX = '   ';

    const { __internal } = await import('./s3-helper.js');
    const key = __internal.buildObjectKey({
      userId: 'user',
      documentId: 'doc',
      filename: 'file.txt',
    });

    expect(key.startsWith('rag-documents/')).toBe(true);
  });
});
