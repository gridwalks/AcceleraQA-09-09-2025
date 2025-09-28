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
        id: 'doc-1',
        filename: payload.document.filename,
        metadata: payload.document.metadata,
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

    expect(result.storage).toBe('neon-postgresql');
    expect(result.metadata.title).toBe('Policy Overview');
    expect(result.metadata.summary).toBe('Summary of the quality policy.');
    expect(result.metadata.version).toBe('v1');
    expect(result.metadata.tags).toEqual(['gmp', 'qa']);
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
