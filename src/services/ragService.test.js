import { jest } from '@jest/globals';
import { TextEncoder, TextDecoder } from 'util';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

const setupNeonRagService = async ({ neonResponses = {}, chatResponse } = {}) => {
  jest.resetModules();

  process.env.REACT_APP_RAG_BACKEND = 'neon';
  process.env.REACT_APP_OPENAI_API_KEY = 'test-key';

  const ragModule = await import('./ragService.js');
  const ragService = ragModule.default;

  const makeNeonRequestSpy = jest
    .spyOn(ragService, 'makeNeonRequest')
    .mockImplementation(async (action, userId, payload = {}) => {
      const handler = neonResponses[action];
      if (typeof handler === 'function') {
        return handler(userId, payload);
      }
      if (handler) {
        return handler;
      }
      return {};
    });

  jest.spyOn(ragService, 'extractTextFromFile').mockResolvedValue('Document text');
  jest.spyOn(ragService, 'captureBlobContent').mockResolvedValue({ base64: 'ZmFrZQ==', byteLength: 4 });

  const openaiModule = await import('./openaiService.js');
  const chatSpy = jest
    .spyOn(openaiModule.default, 'getChatResponse')
    .mockResolvedValue(chatResponse || { answer: 'Example response', resources: [] });

  return { ragService, makeNeonRequestSpy, chatSpy };
};

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.REACT_APP_RAG_BACKEND;
  delete process.env.REACT_APP_OPENAI_API_KEY;
});

describe('ragService neon backend integration', () => {
  test('uploadDocument sends sanitized metadata to Neon', async () => {
    const neonResponses = {
      upload: (_userId, payload) => ({
        document: {
          id: 'doc-1',
          filename: payload.document.filename,
          metadata: {
            ...payload.document.metadata,
            storage: {
              provider: 'netlify-blobs',
              store: 'rag-documents',
              key: 'rag/doc-1',
              path: 'rag-documents/rag/doc-1',
              url: null,
            },
          },
        },
        storageLocation: {
          provider: 'netlify-blobs',
          store: 'rag-documents',
          key: 'rag/doc-1',
          path: 'rag-documents/rag/doc-1',
          url: null,
        },
        message: 'stored',
      }),
    };

    const { ragService, makeNeonRequestSpy } = await setupNeonRagService({ neonResponses });

    const file = { name: 'Policy.pdf', type: 'application/pdf', size: 2048 };

    const result = await ragService.uploadDocument(
      file,
      { title: '  Policy Overview ', description: ' Summary of the quality policy. ', version: ' v1 ', tags: ' gmp , qa ' },
      'user-1'
    );

    expect(makeNeonRequestSpy).toHaveBeenCalledWith(
      'upload',
      'user-1',
      expect.objectContaining({
        document: expect.objectContaining({
          filename: 'Policy.pdf',
          content: 'ZmFrZQ==',
          encoding: 'base64',
          title: 'Policy Overview',
          summary: 'Summary of the quality policy.',
          version: 'v1',
          metadata: expect.objectContaining({
            title: 'Policy Overview',
            tags: ['gmp', 'qa'],
            summary: 'Summary of the quality policy.',
            description: 'Summary of the quality policy.',
            version: 'v1',
            processingMode: 'neon-postgresql',
          }),
        }),
      })
    );

    expect(result.storage).toBe('netlify-blobs');
    expect(result.storageLocation).toEqual(
      expect.objectContaining({ provider: 'netlify-blobs', store: 'rag-documents', key: 'rag/doc-1' })
    );
    expect(result.metadata.title).toBe('Policy Overview');
    expect(result.metadata.summary).toBe('Summary of the quality policy.');
    expect(result.metadata.version).toBe('v1');
    expect(result.metadata.tags).toEqual(['gmp', 'qa']);
    expect(result.metadata.storage).toEqual(
      expect.objectContaining({ provider: 'netlify-blobs', store: 'rag-documents', key: 'rag/doc-1' })
    );
  });

  test('downloadDocument delegates to document metadata endpoint for Neon backend', async () => {
    const { ragService, makeNeonRequestSpy } = await setupNeonRagService();

    const metadataSpy = jest
      .spyOn(ragService, 'makeDocumentMetadataRequest')
      .mockResolvedValue({ downloadUrl: 'https://example.com/doc.pdf', filename: 'doc.pdf' });

    const result = await ragService.downloadDocument({ documentId: 'doc-42' }, 'user-9');

    expect(metadataSpy).toHaveBeenCalledWith(
      'download_document',
      'user-9',
      expect.objectContaining({ documentId: 'doc-42' })
    );
    expect(makeNeonRequestSpy).not.toHaveBeenCalledWith('download_document', expect.anything(), expect.anything());
    expect(result).toEqual(expect.objectContaining({ downloadUrl: 'https://example.com/doc.pdf' }));
  });

  test('getDocuments returns Neon document list', async () => {
    const neonResponses = {
      list: () => ({
        documents: [
          { id: 'doc-1', filename: 'Doc.pdf', metadata: { title: 'Doc' } },
          { id: 'doc-2', filename: 'Guide.pdf', metadata: { title: 'Guide' } },
        ],
      }),
    };

    const { ragService, makeNeonRequestSpy } = await setupNeonRagService({ neonResponses });

    const documents = await ragService.getDocuments('user-2');

    expect(makeNeonRequestSpy).toHaveBeenCalledWith('list', 'user-2');
    expect(documents).toHaveLength(2);
    expect(documents[0].filename).toBe('Doc.pdf');
  });

  test('searchDocuments proxies to Neon search', async () => {
    const neonResponses = {
      search: (_userId, payload) => {
        expect(payload.query).toBe('gmp compliance');
        return {
          results: [
            {
              documentId: 'doc-1',
              filename: 'Doc.pdf',
              chunkIndex: 0,
              text: 'Example text',
            },
          ],
        };
      },
    };

    const { ragService, makeNeonRequestSpy } = await setupNeonRagService({ neonResponses });

    const result = await ragService.searchDocuments('gmp compliance', { limit: 1 }, 'user-3');

    expect(makeNeonRequestSpy).toHaveBeenCalledWith(
      'search',
      'user-3',
      expect.objectContaining({ query: 'gmp compliance', options: expect.objectContaining({ limit: 1 }) })
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0].documentId).toBe('doc-1');
  });

  test('updateDocumentMetadata sends sanitized changes to Neon', async () => {
    const neonResponses = {
      update_metadata: (_userId, payload) => {
        expect(payload.documentId).toBe(123);
        expect(payload.metadata).toEqual({
          title: 'New Title',
          category: 'guidelines',
          version: '2.0',
        });
        expect(Array.isArray(payload.clearFields)).toBe(true);
        expect(payload.clearFields).toEqual(expect.arrayContaining(['description', 'tags']));
        expect(payload.clearFields).toHaveLength(2);

        return {
          document: {
            id: 123,
            filename: 'policy.pdf',
            metadata: {
              title: 'New Title',
              summary: 'Prior summary',
              description: 'Prior summary',
              category: 'guidelines',
              version: '2.0',
              tags: [],
              processingMode: 'neon-postgresql',
            },
          },
        };
      },
    };

    const { ragService, makeNeonRequestSpy } = await setupNeonRagService({ neonResponses });

    const result = await ragService.updateDocumentMetadata(
      123,
      {
        title: ' New Title ',
        description: '   ',
        category: ' guidelines ',
        version: ' 2.0 ',
        tags: [],
      },
      'user-5'
    );

    expect(makeNeonRequestSpy).toHaveBeenCalledWith(
      'update_metadata',
      'user-5',
      expect.objectContaining({
        documentId: 123,
        metadata: {
          title: 'New Title',
          category: 'guidelines',
          version: '2.0',
        },
        clearFields: expect.arrayContaining(['description', 'tags']),
      })
    );

    expect(result.id).toBe(123);
    expect(result.metadata.title).toBe('New Title');
    expect(result.metadata.category).toBe('guidelines');
    expect(result.metadata.version).toBe('2.0');
  });

  test('generateRAGResponse builds context from Neon search results', async () => {
    const neonResponses = {
      search: () => ({
        results: [
          {
            documentId: 'doc-1',
            filename: 'Doc.pdf',
            chunkIndex: 0,
            text: 'Follow GMP Annex 1 guidance for aseptic processing.',
            metadata: { documentTitle: 'GMP Annex 1' },
          },
        ],
      }),
    };

    const chatResponse = {
      answer: 'Maintain aseptic controls as outlined in GMP Annex 1.',
      resources: [{ title: 'Internal SOP', url: 'https://example.com/sop' }],
    };

    const { ragService, makeNeonRequestSpy, chatSpy } = await setupNeonRagService({
      neonResponses,
      chatResponse,
    });

    const result = await ragService.generateRAGResponse('How do we maintain aseptic controls?', 'user-4');

    expect(makeNeonRequestSpy).toHaveBeenCalledWith(
      'search',
      'user-4',
      expect.objectContaining({ query: 'How do we maintain aseptic controls?' })
    );
    expect(chatSpy).toHaveBeenCalled();
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].metadata.citationNumber).toBe(1);
    expect(result.answer).toContain('References');
    expect(result.resources).toEqual(chatResponse.resources);
  });

  test('generateNeonRagResponse incorporates conversation history into prompt', async () => {
    const neonResponses = {
      search: () => ({
        results: [
          {
            documentId: 'doc-99',
            filename: 'Procedure.pdf',
            chunkIndex: 1,
            text: 'Ensure batch release reviews cover prior deviations.',
          },
        ],
      }),
    };

    const { ragService, chatSpy } = await setupNeonRagService({
      neonResponses,
      chatResponse: { answer: 'Context aware response', resources: [] },
    });

    const conversationHistory = [
      { role: 'user', content: 'How should we prepare for the audit?' },
      { role: 'assistant', content: 'Review SOP QA-101 and compile recent CAPAs.' },
    ];

    await ragService.generateNeonRagResponse(
      'What should we emphasize in the follow-up report?',
      'user-7',
      {},
      conversationHistory
    );

    expect(chatSpy).toHaveBeenCalled();
    const promptArgument = chatSpy.mock.calls[0][0];
    expect(promptArgument).toContain('User: How should we prepare for the audit?');
    expect(promptArgument).toContain('Assistant: Review SOP QA-101 and compile recent CAPAs.');
    expect(promptArgument).toContain('Latest question: What should we emphasize in the follow-up report?');
  });
});

describe('shared document retention for OpenAI backend', () => {
  test('getDocuments retains globally shared documents even without OpenAI file access', async () => {
    jest.resetModules();
    process.env.REACT_APP_RAG_BACKEND = 'openai';

    const ragModule = await import('./ragService.js');
    const ragService = ragModule.default;

    const metadataResponse = {
      documents: [
        {
          id: 'shared-doc',
          filename: 'Admin.pdf',
          metadata: {
            title: 'Admin Doc',
            sharedWithAllUsers: true,
            storage: { url: 'https://example.com/shared.pdf' },
          },
        },
        {
          id: 'private-doc',
          filename: 'User.pdf',
          metadata: { title: 'User Doc' },
        },
      ],
    };

    const metadataSpy = jest
      .spyOn(ragService, 'makeDocumentMetadataRequest')
      .mockResolvedValue(metadataResponse);

    const openaiModule = await import('./openaiService.js');
    const openaiSpy = jest
      .spyOn(openaiModule.default, 'makeRequest')
      .mockResolvedValue({ data: [{ id: 'private-doc' }] });

    const documents = await ragService.getDocuments('user-openai');

    expect(metadataSpy).toHaveBeenCalledWith('list_documents', 'user-openai');
    expect(openaiSpy).toHaveBeenCalledWith('/files', expect.objectContaining({ method: 'GET' }));
    expect(documents).toHaveLength(2);

    const ids = documents.map(doc => doc.id);
    expect(ids).toEqual(expect.arrayContaining(['shared-doc', 'private-doc']));
    const sharedDoc = documents.find(doc => doc.id === 'shared-doc');
    expect(sharedDoc.metadata.sharedWithAllUsers).toBe(true);

    metadataSpy.mockRestore();
    openaiSpy.mockRestore();
    delete process.env.REACT_APP_RAG_BACKEND;
  });
});

describe('extractTextFromFile', () => {
  test('uses pdf.js to extract structured text from PDFs', async () => {
    jest.resetModules();

    const pageMocks = [
      {
        getTextContent: jest.fn(async () => ({ items: [{ str: 'Section 1' }, { str: 'Overview' }] })),
        cleanup: jest.fn(),
      },
      {
        getTextContent: jest.fn(async () => ({ items: [{ str: 'Section 2' }, { str: 'Details' }] })),
        cleanup: jest.fn(),
      },
    ];

    const cleanupMock = jest.fn();
    const destroyMock = jest.fn();

    const getDocumentMock = jest.fn(() => ({
      promise: Promise.resolve({
        numPages: pageMocks.length,
        getPage: jest.fn(async (pageNumber) => pageMocks[pageNumber - 1]),
        cleanup: cleanupMock,
        destroy: destroyMock,
      }),
    }));

    const GlobalWorkerOptions = {};

    const loaderMock = jest.fn(async () => ({
      getDocument: getDocumentMock,
      GlobalWorkerOptions,
    }));

    const ragModule = await import('./ragService.js');
    const ragService = ragModule.default;
    ragModule.__setPdfJsLoaderOverride(loaderMock);

    const encoder = new TextEncoder();
    const pdfBuffer = encoder.encode('%PDF-1.4\n').buffer;
    const file = {
      type: 'application/pdf',
      arrayBuffer: async () => pdfBuffer,
    };

    const text = await ragService.extractTextFromFile(file);

    expect(text).toBe('Section 1 Overview\nSection 2 Details');
    expect(loaderMock).toHaveBeenCalledTimes(1);
    expect(getDocumentMock).toHaveBeenCalledWith({ data: expect.any(Uint8Array) });
    expect(pageMocks[0].getTextContent).toHaveBeenCalled();
    expect(pageMocks[1].getTextContent).toHaveBeenCalled();
    expect(pageMocks[0].cleanup).toHaveBeenCalled();
    expect(pageMocks[1].cleanup).toHaveBeenCalled();
    expect(cleanupMock).toHaveBeenCalled();
    expect(destroyMock).toHaveBeenCalled();

    ragModule.__setPdfJsLoaderOverride(null);
    jest.resetModules();
  });
});
