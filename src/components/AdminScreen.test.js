import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import AdminScreen, { checkStorageHealth } from './AdminScreen';

jest.mock('./RAGConfigurationPage', () => () => <h2>My Resources</h2>);

jest.mock('../services/ragService', () => ({
  __esModule: true,
  default: {
    getStats: jest.fn().mockResolvedValue({ totalDocuments: 0, totalChunks: 0 }),
    runDiagnostics: jest.fn().mockResolvedValue({}),
    testConnection: jest.fn().mockResolvedValue({ success: true }),
    getDocuments: jest.fn().mockResolvedValue([]),
    generateRAGResponse: jest.fn(),
  }
}));

jest.mock('../services/neonService', () => ({
  __esModule: true,
  default: {
    getConversationStats: jest.fn().mockResolvedValue({}),
    isServiceAvailable: jest.fn().mockResolvedValue({ ok: true }),
  }
}));

jest.mock('../services/authService', () => ({
  __esModule: true,
  getToken: jest.fn().mockResolvedValue('token'),
  getTokenInfo: jest.fn().mockReturnValue({}),
}));

jest.mock('../services/blobAdminService', () => ({
  __esModule: true,
  default: {
    listBlobs: jest.fn().mockResolvedValue({
      files: [],
      metadata: { store: 'test-store', prefix: '', timestamp: null, total: 0, truncated: false }
    }),
    downloadBlob: jest.fn().mockResolvedValue({
      data: 'dGVzdCBkYXRh', // base64 for "test data"
      filename: 'test.pdf',
      contentType: 'application/pdf'
    }),
  }
}));

describe('checkStorageHealth', () => {
  it('returns unknown status when navigator storage is unavailable', async () => {
    const originalNavigator = global.navigator;
    // Simulate environment without navigator
    // @ts-ignore - override for testing
    global.navigator = undefined;

    const result = await checkStorageHealth();
    expect(result.status).toBe('unknown');

    // Restore navigator
    // @ts-ignore
    global.navigator = originalNavigator;
  });
});

describe('AdminScreen navigation', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
  });


  it('renders RAG Configuration page when RAG Config tab is selected', async () => {
    const user = { roles: ['admin'], sub: 'test-user' };

    await act(async () => {
      ReactDOM.render(<AdminScreen user={user} onBack={() => {}} />, container);
    });

    const ragButton = Array.from(container.querySelectorAll('button')).find(btn =>
      btn.textContent && btn.textContent.includes('My Resources')
    );

    await act(async () => {
      ragButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const heading = container.querySelector('h2');
    expect(heading && heading.textContent).toMatch(/My Resources/i);
  });

  it('calls onBack when back button is clicked', async () => {
    const user = { roles: ['admin'], sub: 'test-user' };
    const onBack = jest.fn();

    await act(async () => {
      ReactDOM.render(<AdminScreen user={user} onBack={onBack} />, container);
    });

    const backButton = Array.from(container.querySelectorAll('button')).find(btn =>
      btn.textContent && btn.textContent.includes('Back to App')
    );

    await act(async () => {
      backButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onBack).toHaveBeenCalled();
  });

  it('renders Token Usage tab when selected', async () => {
    const user = { roles: ['admin'], sub: 'test-user' };

    await act(async () => {
      ReactDOM.render(<AdminScreen user={user} onBack={() => {}} />, container);
    });

    const usageButton = Array.from(container.querySelectorAll('button')).find(btn =>
      btn.textContent && btn.textContent.includes('Token Usage')
    );

    await act(async () => {
      usageButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const heading = container.querySelector('h3');
    expect(heading && heading.textContent).toMatch(/Token Usage/i);
  });
});
