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

jest.mock('../services/ragService', () => ({
  __esModule: true,
  default: {
    downloadDocument: jest.fn(),
  },
}));

// eslint-disable-next-line import/first
import { gzipSync, gunzipSync } from 'zlib';
// eslint-disable-next-line import/first
import { DocumentViewer, decodeBase64ToUint8Array } from './ResourcesView';

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
});
