import { jest } from '@jest/globals';

describe('onedrive-helper path prefix', () => {
  afterEach(() => {
    delete process.env.RAG_ONEDRIVE_ROOT_PATH;
    delete process.env.ONEDRIVE_ROOT_PATH;
    jest.resetModules();
  });

  const loadInternal = async () => {
    jest.resetModules();
    const module = await import('./onedrive-helper.js');
    return module.__internal;
  };

  test('uses configured prefix when building drive path', async () => {
    process.env.RAG_ONEDRIVE_ROOT_PATH = 'allowed/uploads';

    const { buildDrivePath } = await loadInternal();
    const path = buildDrivePath({
      userId: 'auth0|example',
      documentId: 'doc id',
      filename: 'Quarterly Report.pdf',
    });

    expect(path.split('/').slice(0, 2).join('/')).toBe('allowed/uploads');
    expect(path).toContain('auth0-example');
    expect(path).toMatch(/\.pdf$/);
  });

  test('falls back to default prefix when override is empty', async () => {
    process.env.RAG_ONEDRIVE_ROOT_PATH = '   ';

    const { buildDrivePath } = await loadInternal();
    const path = buildDrivePath({
      userId: 'user',
      documentId: 'doc',
      filename: 'file.txt',
    });

    expect(path.startsWith('rag-documents/')).toBe(true);
  });
});
