import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';

const mockGetDocument = jest.fn();

jest.mock('pdfjs-dist/build/pdf', () => ({
  GlobalWorkerOptions: {},
  getDocument: (...args) => mockGetDocument(...args),
}), { virtual: true });

jest.mock('pdfjs-dist/build/pdf.worker.entry', () => 'pdf-worker-stub', { virtual: true });

jest.mock('../services/learningSuggestionsService', () => ({
  __esModule: true,
  default: {
    getLearningSuggestions: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../config/featureFlags', () => ({
  FEATURE_FLAGS: {
    ENABLE_AI_SUGGESTIONS: false,
  },
}));

jest.mock('../services/ragService', () => ({
  __esModule: true,
  default: {
    downloadDocument: jest.fn(),
  },
}));

// eslint-disable-next-line import/first
import { gzipSync, gunzipSync } from 'zlib';
// eslint-disable-next-line import/first
import ResourcesView, { DocumentViewer, decodeBase64ToUint8Array, buildNetlifyBlobDownloadUrl } from './ResourcesView';
// eslint-disable-next-line import/first
import ragService from '../services/ragService';

if (typeof global.TextEncoder === 'undefined') {
  // eslint-disable-next-line global-require
  const { TextEncoder: PolyfillTextEncoder } = require('util');
  global.TextEncoder = PolyfillTextEncoder;
}

if (typeof global.TextDecoder === 'undefined') {
  // eslint-disable-next-line global-require
  const { TextDecoder: PolyfillTextDecoder } = require('util');
  global.TextDecoder = PolyfillTextDecoder;
}

beforeEach(() => {
  ragService.downloadDocument.mockReset();
});

describe('DocumentViewer', () => {
  beforeEach(() => {
    mockGetDocument.mockReset();
    mockGetDocument.mockImplementation(() => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
          render: () => ({ promise: Promise.resolve() }),
          cleanup: () => {},
        }),
        cleanup: () => {},
        destroy: () => {},
      }),
      destroy: () => {},
    }));
  });

  it('inflates gzipped PDFs and feeds expanded bytes to pdf.js', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const originalPako = global.pako;
    global.pako = {
      ungzip: (input) => {
        const buffer = input instanceof Uint8Array ? Buffer.from(input) : input;
        const result = gunzipSync(buffer);
        return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
      },
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const pdfSource = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n';
    const encodedPdf = new TextEncoder().encode(pdfSource);
    const gzippedPdf = gzipSync(Buffer.from(encodedPdf));
    const base64Payload = Buffer.from(gzippedPdf).toString('base64');
    const decodedBytes = await decodeBase64ToUint8Array(base64Payload);

    expect(Array.from(decodedBytes)).toEqual(Array.from(encodedPdf));

    try {
      await act(async () => {
        root.render(
          <DocumentViewer
            isOpen
            title="Test PDF"
            url="blob:https://example.com/test"
            blobData={decodedBytes}
            contentType="application/pdf"
            filename="test.pdf"
            isLoading={false}
            error={null}
            onClose={() => {}}
            allowDownload
          />
        );
      });

      await act(async () => {
        await Promise.resolve();
      });

      const pdfViewer = container.querySelector('[data-testid="pdf-blob-viewer"]');
      expect(pdfViewer).not.toBeNull();
      expect(mockGetDocument).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Uint8Array) }));
      const [{ data }] = mockGetDocument.mock.calls[0];
      const header = new TextDecoder().decode(data.subarray(0, 5));
      expect(header).toBe('%PDF-');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);
      global.fetch = originalFetch;
      global.pako = originalPako;
    }
  });

  it('accepts PDF bytes when the %PDF- header has a BOM or leading whitespace', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      const encoder = new TextEncoder();
      const pdfBody = '%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n';
      const encoded = encoder.encode(pdfBody);
      const bomPrefixed = new Uint8Array(encoded.length + 4);
      bomPrefixed.set([0xef, 0xbb, 0xbf, 0x0a]);
      bomPrefixed.set(encoded, 4);

      await act(async () => {
        root.render(
          <DocumentViewer
            isOpen
            title="Test PDF"
            url="blob:https://example.com/test"
            blobData={bomPrefixed}
            contentType="application/pdf"
            filename="test.pdf"
            isLoading={false}
            error={null}
            onClose={() => {}}
            allowDownload
          />
        );
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockGetDocument).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Uint8Array) }));
      const [{ data }] = mockGetDocument.mock.calls[0];
      const header = new TextDecoder().decode(data.subarray(0, 5));
      expect(header).toBe('%PDF-');
    } finally {
      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);
    }
  });

  it('shows a friendly CSP warning when blob URLs lack blobData', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <DocumentViewer
            isOpen
            title="Test PDF"
            url="blob:https://example.com/test"
            blobData={null}
            contentType="application/pdf"
            filename="test.pdf"
            isLoading={false}
            error={null}
            onClose={() => {}}
            allowDownload
          />
        );
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(fetchMock).not.toHaveBeenCalled();

      const pdfViewer = container.querySelector('[data-testid="pdf-blob-viewer"]');
      expect(pdfViewer).not.toBeNull();
      expect(pdfViewer.textContent).toContain(
        'Browser security settings prevented the PDF preview. Please download the file to view it.'
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);
      global.fetch = originalFetch;
    }
  });

  it('renders detailed error information with attempted paths', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <DocumentViewer
            isOpen
            title="Errored Document"
            url=""
            blobData={null}
            contentType="application/pdf"
            filename="error.pdf"
            isLoading={false}
            error={{
              message: 'Unable to fetch the requested document.',
              hint: 'Please try downloading the file directly or contact support.',
              attemptedPaths: [
                { label: 'Netlify Blob', path: '/.netlify/blobs/blob/path/to/document.pdf' },
                { label: 'Document reference', path: 'documentId=doc-1 fileId=file-1' },
              ],
              debugMessage: 'Status 500: Internal Server Error',
            }}
            onClose={() => {}}
            allowDownload={false}
          />
        );
      });

      const attemptedPathContainer = container.querySelector('[data-testid="document-viewer-error-paths"]');
      expect(attemptedPathContainer).not.toBeNull();

      const primaryPathContainer = container.querySelector('[data-testid="document-viewer-error-primary-path"]');
      expect(primaryPathContainer).not.toBeNull();
      expect(primaryPathContainer.textContent).toContain('/.netlify/blobs/blob/path/to/document.pdf');

      const pathEntries = Array.from(
        container.querySelectorAll('[data-testid="document-viewer-error-path"]')
      ).map((node) => node.textContent);
      expect(pathEntries).toContain('/.netlify/blobs/blob/path/to/document.pdf');
      expect(pathEntries).toContain('documentId=doc-1 fileId=file-1');

      const debugPre = container.querySelector('details pre');
      expect(debugPre).not.toBeNull();
      expect(debugPre.textContent).toContain('Status 500: Internal Server Error');
      expect(container.textContent).toContain('Unable to fetch the requested document.');
      expect(container.textContent).toContain('Please try downloading the file directly or contact support.');
    } finally {
      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);
    }
  });
});

describe('ResourcesView component', () => {
  it('fetches Netlify blob documents directly from metadata when available', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const originalCreateObjectURL = typeof URL !== 'undefined' ? URL.createObjectURL : undefined;
    const originalRevokeObjectURL = typeof URL !== 'undefined' ? URL.revokeObjectURL : undefined;

    const createObjectURLMock = jest.fn(() => 'blob:mock-url');
    const revokeObjectURLMock = jest.fn();

    if (typeof URL !== 'undefined') {
      URL.createObjectURL = createObjectURLMock;
      URL.revokeObjectURL = revokeObjectURLMock;
    }

    const headers = {
      get: (key) => (key && key.toLowerCase() === 'content-type' ? 'application/pdf' : null),
    };

    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers,
      blob: async () => ({
        type: 'application/pdf',
        arrayBuffer: async () => pdfBytes.buffer,
      }),
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const resource = {
      title: 'Policy Document',
      type: 'Guideline',
      metadata: {
        documentId: 'doc-123',
        filename: 'Policy.pdf',
        contentType: 'application/pdf',
        storage: {
          provider: 'netlify-blobs',
          path: 'rag-documents/user/doc-123.pdf',
          contentType: 'application/pdf',
        },
      },
    };

    try {
      await act(async () => {
        root.render(<ResourcesView currentResources={[resource]} user={{ sub: 'user-1' }} />);
      });

      const card = container.querySelector('[role="button"]');
      expect(card).not.toBeNull();

      await act(async () => {
        card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        '/.netlify/blobs/blob/rag-documents/user/doc-123.pdf',
        { credentials: 'include' }
      );
      expect(ragService.downloadDocument).not.toHaveBeenCalled();
      expect(createObjectURLMock).toHaveBeenCalled();
      expect(revokeObjectURLMock).not.toHaveBeenCalled();

      const pdfViewer = container.querySelector('[data-testid="pdf-blob-viewer"]');
      expect(pdfViewer).not.toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);
      global.fetch = originalFetch;
      if (typeof URL !== 'undefined') {
        if (originalCreateObjectURL) {
          URL.createObjectURL = originalCreateObjectURL;
        } else {
          delete URL.createObjectURL;
        }
        if (originalRevokeObjectURL) {
          URL.revokeObjectURL = originalRevokeObjectURL;
        } else {
          delete URL.revokeObjectURL;
        }
      }
    }
  });

  it('falls back to base64 content when Netlify downloads fail with 404', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: false, status: 404 });
    global.fetch = fetchMock;

    const originalCreateObjectURL = typeof URL !== 'undefined' ? URL.createObjectURL : undefined;
    const originalRevokeObjectURL = typeof URL !== 'undefined' ? URL.revokeObjectURL : undefined;

    const createObjectURLMock = jest.fn(() => 'blob:base64-fallback');
    const revokeObjectURLMock = jest.fn();

    if (typeof URL !== 'undefined') {
      URL.createObjectURL = createObjectURLMock;
      URL.revokeObjectURL = revokeObjectURLMock;
    }

    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const base64Content = Buffer.from(pdfBytes).toString('base64');

    ragService.downloadDocument.mockResolvedValue({
      filename: 'Fallback.pdf',
      contentType: 'application/pdf',
      storageLocation: {
        provider: 'netlify-blobs',
        path: 'rag-documents/user/doc-999.pdf',
        contentType: 'application/pdf',
      },
      content: base64Content,
      encoding: 'base64',
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const resource = {
      title: 'Fallback Policy',
      type: 'Guideline',
      metadata: {
        documentId: 'doc-999',
        filename: 'Fallback.pdf',
        contentType: 'application/pdf',
        storage: {
          provider: 'netlify-blobs',
          path: 'rag-documents/user/doc-999.pdf',
          contentType: 'application/pdf',
        },
      },
    };

    try {
      await act(async () => {
        root.render(<ResourcesView currentResources={[resource]} user={{ sub: 'user-3' }} />);
      });

      const card = container.querySelector('[role="button"]');
      expect(card).not.toBeNull();

      await act(async () => {
        card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledWith(
        '/.netlify/blobs/blob/rag-documents/user/doc-999.pdf',
        { credentials: 'include' }
      );
      expect(ragService.downloadDocument).toHaveBeenCalledWith(
        { documentId: 'doc-999', fileId: '' },
        'user-3'
      );
      expect(createObjectURLMock).toHaveBeenCalledTimes(1);

      const pdfViewer = container.querySelector('[data-testid="pdf-blob-viewer"]');
      expect(pdfViewer).not.toBeNull();

      const errorPaths = container.querySelector('[data-testid="document-viewer-error-paths"]');
      expect(errorPaths).toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);
      global.fetch = originalFetch;
      if (typeof URL !== 'undefined') {
        if (originalCreateObjectURL) {
          URL.createObjectURL = originalCreateObjectURL;
        } else {
          delete URL.createObjectURL;
        }
        if (originalRevokeObjectURL) {
          URL.revokeObjectURL = originalRevokeObjectURL;
        } else {
          delete URL.revokeObjectURL;
        }
      }
    }
  });

  it('shows attempted document paths when downloads fail', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    global.fetch = fetchMock;

    const originalCreateObjectURL = typeof URL !== 'undefined' ? URL.createObjectURL : undefined;
    const originalRevokeObjectURL = typeof URL !== 'undefined' ? URL.revokeObjectURL : undefined;

    if (typeof URL !== 'undefined') {
      URL.createObjectURL = jest.fn(() => 'blob:mock');
      URL.revokeObjectURL = jest.fn();
    }

    ragService.downloadDocument.mockRejectedValue(new Error('Upstream download error'));

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const resource = {
      title: 'Failed Policy',
      type: 'Guideline',
      metadata: {
        documentId: 'doc-404',
        fileId: 'file-404',
        filename: 'failed.pdf',
        contentType: 'application/pdf',
        storage: {
          provider: 'netlify-blobs',
          path: 'rag-documents/user/doc-404.pdf',
          contentType: 'application/pdf',
        },
      },
    };

    try {
      await act(async () => {
        root.render(<ResourcesView currentResources={[resource]} user={{ sub: 'user-2' }} />);
      });

      const card = container.querySelector('[role="button"]');
      expect(card).not.toBeNull();

      await act(async () => {
        card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(ragService.downloadDocument).toHaveBeenCalledWith(
        { documentId: 'doc-404', fileId: 'file-404' },
        'user-2'
      );

      const primaryPathContainer = container.querySelector('[data-testid="document-viewer-error-primary-path"]');
      expect(primaryPathContainer).not.toBeNull();
      expect(primaryPathContainer.textContent).toContain('/.netlify/blobs/blob/rag-documents/user/doc-404.pdf');

      const attemptedPathsContainer = container.querySelector('[data-testid="document-viewer-error-paths"]');
      expect(attemptedPathsContainer).not.toBeNull();

      const pathEntries = Array.from(
        container.querySelectorAll('[data-testid="document-viewer-error-path"]')
      ).map((node) => node.textContent);

      expect(pathEntries).toContain('/.netlify/blobs/blob/rag-documents/user/doc-404.pdf');
      expect(pathEntries).toContain('documentId=doc-404 fileId=file-404');

      const debugPre = container.querySelector('details pre');
      expect(debugPre).not.toBeNull();
      expect(debugPre.textContent).toContain('Upstream download error');
    } finally {
      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);
      global.fetch = originalFetch;

      if (typeof URL !== 'undefined') {
        if (originalCreateObjectURL) {
          URL.createObjectURL = originalCreateObjectURL;
        } else {
          delete URL.createObjectURL;
        }

        if (originalRevokeObjectURL) {
          URL.revokeObjectURL = originalRevokeObjectURL;
        } else {
          delete URL.revokeObjectURL;
        }
      }
    }
  });
});

describe('buildNetlifyBlobDownloadUrl', () => {
  it('returns direct url when provided', () => {
    const url = buildNetlifyBlobDownloadUrl({ url: 'https://example.com/file.pdf' });
    expect(url).toBe('https://example.com/file.pdf');
  });

  it('constructs a blob url from path metadata', () => {
    const url = buildNetlifyBlobDownloadUrl({ path: 'rag-documents/user/file.pdf' });
    expect(url).toBe('/.netlify/blobs/blob/rag-documents/user/file.pdf');
  });

  it('constructs a blob url from store and key metadata', () => {
    const url = buildNetlifyBlobDownloadUrl({ store: 'rag-documents', key: 'rag-documents/user/file.pdf' });
    expect(url).toBe('/.netlify/blobs/blob/rag-documents/rag-documents/user/file.pdf');
  });

  it('avoids double encoding already escaped path segments', () => {
    const url = buildNetlifyBlobDownloadUrl({ path: 'rag-documents/user/My%20File%20(1).pdf' });
    expect(url).toBe('/.netlify/blobs/blob/rag-documents/user/My%20File%20(1).pdf');
  });

  it('preserves encoded forward slashes within segments', () => {
    const url = buildNetlifyBlobDownloadUrl({ key: 'rag-documents/user/some%2Fnested%2Fname.txt' });
    expect(url).toBe('/.netlify/blobs/blob/rag-documents/user/some%2Fnested%2Fname.txt');
  });

  it('returns empty string when metadata is incomplete', () => {
    expect(buildNetlifyBlobDownloadUrl()).toBe('');
    expect(buildNetlifyBlobDownloadUrl({})).toBe('');
    expect(buildNetlifyBlobDownloadUrl({ store: 'rag-documents' })).toBe('');
  });
});

describe('ResourcesView component', () => {
  it('fetches Netlify blob documents directly from metadata when available', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const originalCreateObjectURL = typeof URL !== 'undefined' ? URL.createObjectURL : undefined;
    const originalRevokeObjectURL = typeof URL !== 'undefined' ? URL.revokeObjectURL : undefined;

    const createObjectURLMock = jest.fn(() => 'blob:mock-url');
    const revokeObjectURLMock = jest.fn();

    if (typeof URL !== 'undefined') {
      URL.createObjectURL = createObjectURLMock;
      URL.revokeObjectURL = revokeObjectURLMock;
    }

    const headers = {
      get: (key) => (key && key.toLowerCase() === 'content-type' ? 'application/pdf' : null),
    };

    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers,
      blob: async () => ({
        type: 'application/pdf',
        arrayBuffer: async () => pdfBytes.buffer,
      }),
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const resource = {
      title: 'Policy Document',
      type: 'Guideline',
      metadata: {
        documentId: 'doc-123',
        filename: 'Policy.pdf',
        contentType: 'application/pdf',
        storage: {
          provider: 'netlify-blobs',
          path: 'rag-documents/user/doc-123.pdf',
          contentType: 'application/pdf',
        },
      },
    };

    try {
      await act(async () => {
        root.render(<ResourcesView currentResources={[resource]} user={{ sub: 'user-1' }} />);
      });

      const card = container.querySelector('[role="button"]');
      expect(card).not.toBeNull();

      await act(async () => {
        card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        '/.netlify/blobs/blob/rag-documents/user/doc-123.pdf',
        { credentials: 'include' }
      );
      expect(ragService.downloadDocument).not.toHaveBeenCalled();
      expect(createObjectURLMock).toHaveBeenCalled();
      expect(revokeObjectURLMock).not.toHaveBeenCalled();

      const pdfViewer = container.querySelector('[data-testid="pdf-blob-viewer"]');
      expect(pdfViewer).not.toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);
      global.fetch = originalFetch;
      if (typeof URL !== 'undefined') {
        if (originalCreateObjectURL) {
          URL.createObjectURL = originalCreateObjectURL;
        } else {
          delete URL.createObjectURL;
        }
        if (originalRevokeObjectURL) {
          URL.revokeObjectURL = originalRevokeObjectURL;
        } else {
          delete URL.revokeObjectURL;
        }
      }
    }
  });
});

describe('buildNetlifyBlobDownloadUrl', () => {
  it('returns direct url when provided', () => {
    const url = buildNetlifyBlobDownloadUrl({ url: 'https://example.com/file.pdf' });
    expect(url).toBe('https://example.com/file.pdf');
  });

  it('constructs a blob url from path metadata', () => {
    const url = buildNetlifyBlobDownloadUrl({ path: 'rag-documents/user/file.pdf' });
    expect(url).toBe('/.netlify/blobs/blob/rag-documents/user/file.pdf');
  });

  it('constructs a blob url from store and key metadata', () => {
    const url = buildNetlifyBlobDownloadUrl({ store: 'rag-documents', key: 'rag-documents/user/file.pdf' });
    expect(url).toBe('/.netlify/blobs/blob/rag-documents/rag-documents/user/file.pdf');
  });

  it('returns empty string when metadata is incomplete', () => {
    expect(buildNetlifyBlobDownloadUrl()).toBe('');
    expect(buildNetlifyBlobDownloadUrl({})).toBe('');
    expect(buildNetlifyBlobDownloadUrl({ store: 'rag-documents' })).toBe('');
  });
});
