import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';

jest.mock('pdfjs-dist/build/pdf', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
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
  }),
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
  it('uses the PdfBlobViewer when rendering blob-based PDFs', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DocumentViewer
          isOpen
          title="Test PDF"
          url="blob:https://example.com/test"
          contentType="application/pdf"
          filename="test.pdf"
          isLoading={false}
          error={null}
          onClose={() => {}}
          allowDownload
        />
      );
    });

    const pdfViewer = container.querySelector('[data-testid="pdf-blob-viewer"]');
    expect(pdfViewer).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });
});
