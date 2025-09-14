import { jest } from '@jest/globals';
import { TextEncoder, TextDecoder } from 'util';
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
const mockGetToken = jest.fn();
let RAGService;
beforeAll(async () => {
  await jest.unstable_mockModule('./authService', () => ({ getToken: mockGetToken, default: {} }));
  ({ default: RAGService } = await import('./ragService'));
});

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

describe('ragService PDF extraction', () => {
  test('extracts text from a PDF', async () => {
    const rag = RAGService;
    const file = createPdfFile();
    const text = await rag.extractTextFromFile(file);
    expect(text).toContain('Hello PDF');
  });
});

describe('neon-rag-fixed upload chunking', () => {
  test('stores PDF text chunks', async () => {
    const rag = RAGService;
    const file = createPdfFile();
    const text = await rag.extractTextFromFile(file);

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
