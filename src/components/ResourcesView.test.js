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
import { DocumentViewer } from './ResourcesView';

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

  it('uses the PdfBlobViewer when rendering blob-based PDFs', async () => {
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
            blobData={new Uint8Array([1, 2, 3])}
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
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);
      global.fetch = originalFetch;
    }
  });
});
