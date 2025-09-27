import { jest } from '@jest/globals';
import { TextEncoder, TextDecoder } from 'util';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

const pdfSupported = false;

function createPdfFile() {
  const pdfContent = `%PDF-1.3\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT\n/F1 24 Tf\n72 96 Td\n(Hello PDF) Tj\nET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f \n0000000010 00000 n \n0000000061 00000 n \n0000000112 00000 n \n0000000221 00000 n \n0000000332 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n383\n%%EOF`;
  const buffer = Buffer.from(pdfContent, 'utf-8');
  const arrayBuf = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return {
    name: 'sample.pdf',
    type: 'application/pdf',
    size: buffer.length,
    arrayBuffer: async () => arrayBuf,
  };
}

const createDocumentApiMock = (userStore) => {
  const calls = [];
  const handler = async (action, userId, payload = {}) => {
    calls.push([action, userId, payload]);
    if (!userStore.has(userId)) {
      userStore.set(userId, { vectorStoreId: null, documents: [] });
    }
    const state = userStore.get(userId);

    switch (action) {
      case 'health':
        return { status: 'ok' };
      case 'get_vector_store':
        return { vectorStoreId: state.vectorStoreId };
      case 'set_vector_store':
        state.vectorStoreId = payload.vectorStoreId;
        return { vectorStoreId: state.vectorStoreId };
      case 'list_documents':
        return { documents: state.documents };
      case 'save_document': {
        const incoming = payload.document || {};
        const id = incoming.id || incoming.fileId;
        const stored = {
          ...incoming,
          id,
          fileId: incoming.fileId || id,
          createdAt: incoming.createdAt || new Date().toISOString(),
        };
        const existingIndex = state.documents.findIndex(doc => doc.id === id);
        if (existingIndex >= 0) {
          state.documents[existingIndex] = stored;
        } else {
          state.documents.push(stored);
        }
        return { document: stored };
      }
      case 'delete_document':
        state.documents = state.documents.filter(doc => doc.id !== payload.documentId);
        return { success: true };
      default:
        return { error: `unsupported action: ${action}` };
    }
  };

  handler.calls = calls;
  handler.clear = () => {
    calls.length = 0;
  };

  return handler;
};

const loadRagService = async ({ documentApiMock, uploadFileId = 'file_mock', vectorStoreId = 'vs_mock' } = {}) => {
  jest.resetModules();

  process.env.REACT_APP_OPENAI_API_KEY = 'test-key';
  process.env.REACT_APP_RAG_BACKEND = 'openai';

  const authModule = await import('./authService.js');
  const getTokenSpy = jest.spyOn(authModule, 'getToken').mockResolvedValue('test-token');
  const getUserIdSpy = jest.spyOn(authModule, 'getUserId').mockResolvedValue('test-user');

  const openaiModule = await import('./openaiService.js');
  const uploadFileSpy = jest.spyOn(openaiModule.default, 'uploadFile').mockResolvedValue(uploadFileId);
  const createVectorStoreSpy = jest
    .spyOn(openaiModule.default, 'createVectorStore')
    .mockResolvedValue(vectorStoreId);
  const attachFileSpy = jest
    .spyOn(openaiModule.default, 'attachFileToVectorStore')
    .mockResolvedValue({});
  const makeRequestSpy = jest
    .spyOn(openaiModule.default, 'makeRequest')
    .mockImplementation(async (endpoint) => {
      if (endpoint === '/files') {
        return { data: [{ id: uploadFileId }] };
      }
      return { success: true };
    });

  const module = await import('./ragService.js');
  const ragServiceInstance = module.default;
  const convertMock = jest.fn(async (file) => ({
    file,
    converted: false,
    originalFileName: file?.name || null,
    originalMimeType: file?.type || null,
    conversion: null,
  }));
  ragServiceInstance.convertDocxToPdfIfNeeded = convertMock;
  let documentApiSpy = null;
  if (documentApiMock) {
    documentApiSpy = jest
      .spyOn(ragServiceInstance, 'makeDocumentMetadataRequest')
      .mockImplementation((action, userId, payload = {}) => documentApiMock(action, userId, payload));
  }

  return {
    ragService: ragServiceInstance,
    mocks: {
      getToken: getTokenSpy,
      getUserId: getUserIdSpy,
      openai: {
        uploadFile: uploadFileSpy,
        createVectorStore: createVectorStoreSpy,
        attachFileToVectorStore: attachFileSpy,
        makeRequest: makeRequestSpy,
      },
      convertDocxToPdfIfNeeded: convertMock,
      documentApi: documentApiSpy,
    },
  };
};

describe('ragService PDF extraction', () => {
  (pdfSupported ? test : test.skip)('extracts text from a PDF', async () => {
    const { ragService } = await loadRagService();
    const file = createPdfFile();
    const text = await ragService.extractTextFromFile(file);
    expect(text).toContain('Hello PDF');
  });
});

describe('neon-rag-fixed upload chunking', () => {
  (pdfSupported ? test : test.skip)('stores PDF text chunks', async () => {
    const { ragService } = await loadRagService();
    const file = createPdfFile();
    const text = await ragService.extractTextFromFile(file);

    process.env.NEON_DATABASE_URL = 'postgres://user:pass@localhost/db';
    process.env.REACT_APP_AUTH0_DOMAIN = 'example.com';
    process.env.REACT_APP_AUTH0_AUDIENCE = 'test';

    const client = {
      query: jest.fn().mockImplementation((q, params) => {
        if (q.includes('INSERT INTO rag_documents')) {
          return { rows: [{ id: 1, filename: params[1], created_at: 'now' }] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const connect = jest.fn().mockResolvedValue(client);

    await jest.unstable_mockModule('@neondatabase/serverless', () => ({
      Pool: jest.fn(() => ({ connect })),
      neonConfig: {},
    }));
    await jest.unstable_mockModule('ws', () => ({ default: class {} }));

    const { handler } = await import('../../netlify/functions/neon-rag-fixed.js');
    const event = {
      httpMethod: 'POST',
      headers: { 'x-user-id': 'user1' },
      body: JSON.stringify({ action: 'upload', document: { filename: 'sample.pdf', text } }),
    };
    const res = await handler(event, {});
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(201);
    expect(body.chunks).toBeGreaterThan(0);
    const chunkCalls = client.query.mock.calls.filter(([q]) => q.includes('rag_document_chunks'));
    expect(chunkCalls.length).toBe(body.chunks);
  });
});

describe('document persistence with Neon metadata store', () => {
  const userStore = new Map();
  const documentApiMock = createDocumentApiMock(userStore);

  beforeEach(() => {
    userStore.clear();
    documentApiMock.clear();
  });

  test('documents uploaded in one session are available in a fresh session', async () => {
    const uploadOptions = { documentApiMock, uploadFileId: 'file_doc_1', vectorStoreId: 'vs_persist_1' };
    const { ragService: firstSession, mocks: firstMocks } = await loadRagService(uploadOptions);

    const file = { name: 'SOP.pdf', type: 'application/pdf', size: 2048 };
    await firstSession.uploadDocument(file, { category: 'quality' }, 'user-123');

    expect(firstMocks.openai.uploadFile).toHaveBeenCalledTimes(1);
    expect(firstMocks.openai.createVectorStore).toHaveBeenCalledTimes(1);

    const callSummary = documentApiMock.calls.map(([action, user]) => [action, user]);
    expect(callSummary).toEqual([
      ['get_vector_store', 'user-123'],
      ['set_vector_store', 'user-123'],
      ['save_document', 'user-123'],
    ]);
    expect([...userStore.keys()]).toEqual(['user-123']);

    const persistedAfterUpload = userStore.get('user-123');
    expect(persistedAfterUpload.documents).toHaveLength(1);

    const sessionOneDocs = await firstSession.getDocuments('user-123');
    expect(sessionOneDocs).toHaveLength(1);
    expect(sessionOneDocs[0].filename).toBe('SOP.pdf');

    const { ragService: secondSession, mocks: secondMocks } = await loadRagService(uploadOptions);
    const sessionTwoDocs = await secondSession.getDocuments('user-123');
    expect(sessionTwoDocs).toHaveLength(1);
    expect(sessionTwoDocs[0].id).toBe('file_doc_1');
    expect(sessionTwoDocs[0].filename).toBe('SOP.pdf');

    const vectorStoreId = await secondSession.getVectorStoreId('user-123');
    expect(vectorStoreId).toBe('vs_persist_1');
    expect(secondMocks.openai.createVectorStore).not.toHaveBeenCalled();

    const persistedState = userStore.get('user-123');
    expect(persistedState.vectorStoreId).toBe('vs_persist_1');
    expect(persistedState.documents).toHaveLength(1);
    expect(persistedState.documents[0].id).toBe('file_doc_1');
  });

  test('docx uploads are converted and metadata keeps original details', async () => {
    const uploadOptions = { documentApiMock, uploadFileId: 'file_docx_1', vectorStoreId: 'vs_docx_1' };
    const { ragService, mocks } = await loadRagService(uploadOptions);

    const originalFile = {
      name: 'Guideline.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 1024,
    };

    const convertedFile = {
      name: 'Guideline.pdf',
      type: 'application/pdf',
      size: 2048,
    };

    mocks.convertDocxToPdfIfNeeded.mockResolvedValue({
      file: convertedFile,
      converted: true,
      originalFileName: originalFile.name,
      originalMimeType: originalFile.type,
      conversion: 'docx-to-pdf',
    });

    await ragService.uploadDocument(originalFile, { category: 'quality' }, 'user-456');

    expect(mocks.convertDocxToPdfIfNeeded).toHaveBeenCalledWith(originalFile);
    expect(mocks.openai.uploadFile).toHaveBeenCalledWith(convertedFile);

    const saveCall = documentApiMock.calls.find(([action]) => action === 'save_document');
    expect(saveCall).toBeTruthy();
    const savedDoc = saveCall[2].document;
    expect(savedDoc.filename).toBe(convertedFile.name);
    expect(savedDoc.type).toBe(convertedFile.type);
    expect(savedDoc.metadata.originalFilename).toBe(originalFile.name);
    expect(savedDoc.metadata.originalMimeType).toBe(originalFile.type);
    expect(savedDoc.metadata.conversion).toBe('docx-to-pdf');
  });

  test('captures version metadata when provided', async () => {
    const uploadOptions = { documentApiMock, uploadFileId: 'file_version_1', vectorStoreId: 'vs_version_1' };
    const { ragService } = await loadRagService(uploadOptions);

    const file = { name: 'Procedure.pdf', type: 'application/pdf', size: 4096 };
    await ragService.uploadDocument(file, { category: 'quality', version: '  Rev 2 ' }, 'user-789');

    const saveCall = documentApiMock.calls.find(([action]) => action === 'save_document');
    expect(saveCall).toBeTruthy();
    const savedMetadata = saveCall[2].document.metadata;
    expect(savedMetadata.version).toBe('Rev 2');

    const docs = await ragService.getDocuments('user-789');
    expect(docs).toHaveLength(1);
    expect(docs[0].metadata.version).toBe('Rev 2');
  });

  test('captures base64 document content when file size is within persistence limit', async () => {
    const uploadOptions = { documentApiMock, uploadFileId: 'file_content_1', vectorStoreId: 'vs_content_1' };
    const { ragService } = await loadRagService(uploadOptions);

    const buffer = Buffer.from('document payload for persistence test', 'utf8');
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    const file = {
      name: 'Content.pdf',
      type: 'application/pdf',
      size: buffer.length,
      arrayBuffer: async () => arrayBuffer,
    };

    await ragService.uploadDocument(file, {}, 'user-content');

    const saveCall = documentApiMock.calls.find(([action]) => action === 'save_document');
    expect(saveCall).toBeTruthy();
    const savedDoc = saveCall[2].document;
    expect(savedDoc.encoding).toBe('base64');
    expect(savedDoc.content).toBe(buffer.toString('base64'));
  });

  test('generateRAGResponse merges user upload vector stores into search', async () => {
    const uploadOptions = { documentApiMock, uploadFileId: 'file_rag_1', vectorStoreId: 'vs_default_user' };
    const { ragService, mocks } = await loadRagService(uploadOptions);

    const capturedBodies = [];
    mocks.openai.makeRequest.mockImplementation(async (endpoint, options = {}) => {
      if (endpoint === '/responses') {
        const parsedBody = options?.body ? JSON.parse(options.body) : {};
        capturedBodies.push(parsedBody);
        return {
          output: [],
          output_text: 'Search answer',
          usage: {},
        };
      }

      if (endpoint === '/files') {
        return { data: [] };
      }

      return { success: true };
    });

    const additionalVectorStore = 'vs_active_upload';
    const response = await ragService.generateRAGResponse('Explain CAPA expectations', 'user-search-1', {
      vectorStoreIds: [additionalVectorStore, '  ', null, additionalVectorStore],
    });

    expect(response.answer).toBe('Search answer');
    expect(capturedBodies).toHaveLength(1);
    const tools = capturedBodies[0]?.tools || [];
    expect(tools).toHaveLength(1);
    expect(tools[0].vector_store_ids).toEqual(['vs_default_user', additionalVectorStore]);
  });

  test('generateRAGResponse includes prior conversation turns when provided', async () => {
    const uploadOptions = { documentApiMock, uploadFileId: 'file_rag_history', vectorStoreId: 'vs_history_user' };
    const { ragService, mocks } = await loadRagService(uploadOptions);

    const capturedBodies = [];
    mocks.openai.makeRequest.mockImplementation(async (endpoint, options = {}) => {
      if (endpoint === '/responses') {
        const parsedBody = options?.body ? JSON.parse(options.body) : {};
        capturedBodies.push(parsedBody);
        return {
          output: [],
          output_text: 'History aware answer',
          usage: {},
        };
      }

      if (endpoint === '/files') {
        return { data: [] };
      }

      return { success: true };
    });

    const conversationHistory = [
      { role: 'user', content: 'What is GMP?' },
      { role: 'assistant', content: 'GMP stands for Good Manufacturing Practice.' },
      { role: 'assistant', content: '   ' },
      { role: 'system', content: 'ignored' },
    ];

    await ragService.generateRAGResponse('And what does it ensure?', 'user-history-1', {}, conversationHistory);

    expect(capturedBodies).toHaveLength(1);
    const { input } = capturedBodies[0];
    expect(Array.isArray(input)).toBe(true);
    expect(input).toHaveLength(3);
    expect(input[0]).toEqual({
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: 'What is GMP?',
        },
      ],
    });
    expect(input[1]).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: 'GMP stands for Good Manufacturing Practice.',
        },
      ],
    });
    expect(input[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: 'And what does it ensure?',
        },
      ],
    });
  });
});

describe('downloadDocument', () => {
  test('requests document content through metadata service', async () => {
    const downloadResponse = {
      filename: 'Quality_Event_SOP.pdf',
      contentType: 'application/pdf',
      content: Buffer.from('pdf-content').toString('base64'),
      encoding: 'base64',
    };

    const documentApiMock = jest.fn(async (action, userId, payload) => {
      if (action === 'download_document') {
        expect(userId).toBe('user-download');
        expect(payload).toEqual({ documentId: 'doc-download-1' });
        return downloadResponse;
      }
      return { documents: [] };
    });

    const { ragService } = await loadRagService({ documentApiMock });
    const result = await ragService.downloadDocument('doc-download-1', 'user-download');

    expect(documentApiMock).toHaveBeenCalledWith('download_document', 'user-download', { documentId: 'doc-download-1' });
    expect(result).toEqual(downloadResponse);
  });

  test('throws when no identifier provided', async () => {
    const { ragService } = await loadRagService({ documentApiMock: jest.fn() });
    await expect(ragService.downloadDocument({}, 'user-download')).rejects.toThrow(
      'documentId or fileId is required to download a document'
    );
  });

});
