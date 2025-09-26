import { jest } from '@jest/globals';

let mockGetToken;
let mockGetUserId;

jest.mock('./authService', () => ({
  getToken: (...args) => mockGetToken(...args),
  getUserId: (...args) => mockGetUserId(...args),
}));

import summaryPipelineService, {
  buildSummaryRequest,
  DETAIL_LEVELS,
  SummaryPipelineService,
} from './summaryPipelineService';

describe('buildSummaryRequest', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2025-09-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('normalizes document metadata and mode defaults', () => {
    const payload = buildSummaryRequest({
      document: {
        title: 'Validation Plan',
        content: 'Section 1. Overview.\n\nThis plan validates equipment.\n\nSection 2. Testing. IQ and OQ complete.',
        owner: 'QA Team',
      },
      mode: { role: 'Auditor', detail: 'deep dive' },
      query: 'Provide regulatory summary',
    });

    expect(payload.document.doc_id).toMatch(/^doc_/);
    expect(payload.document.title).toBe('Validation Plan');
    expect(payload.mode.role).toBe('Auditor');
    expect(payload.mode.detail).toBe(DETAIL_LEVELS.DEEP_DIVE);
    expect(payload.chunkConfig).toEqual({ chunkSize: 1200, chunkOverlap: 180 });
    expect(payload.metadata.requestTimestamp).toBe('2025-09-09T12:00:00.000Z');
    expect(typeof payload.requestId).toBe('string');
  });

  it('throws when content is missing', () => {
    expect(() => buildSummaryRequest({ document: { title: 'Empty' } })).toThrow('document content must be a non-empty string');
  });
});

describe('SummaryPipelineService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = jest.fn();
    mockGetToken = jest.fn().mockResolvedValue('token-123');
    mockGetUserId = jest.fn().mockResolvedValue('user-456');
  });

  it('POSTs to create a summary with auth headers', async () => {
    const fakeResponse = { summary: { summary_id: 'sum_abc' } };
    fetch.mockResolvedValue({ ok: true, json: async () => fakeResponse });

    const result = await summaryPipelineService.createSummary({
      document: { title: 'Doc', content: 'A test document.' },
      mode: { lens: 'Risk & CAPA' },
      query: 'Highlight risks',
    });

    expect(result).toEqual(fakeResponse);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toContain('/.netlify/functions/summary-pipeline');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer token-123');
    expect(options.headers['x-user-id']).toBe('user-456');
    expect(JSON.parse(options.body).mode.lens).toBe('Risk & CAPA');
  });

  it('throws normalized error when backend responds with failure', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: 'Unsupported mode' }),
    });

    await expect(summaryPipelineService.createSummary({
      document: { content: 'text' },
    })).rejects.toThrow('Unsupported mode');
  });

  it('retrieves a persisted summary by id', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ summary: { summary_id: 'sum_123' } }) });

    const service = new SummaryPipelineService('https://api.example.com/summary-pipeline');
    const result = await service.getSummary('sum_123');

    expect(result.summary.summary_id).toBe('sum_123');
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/summary-pipeline?summary_id=sum_123', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer token-123',
        'x-user-id': 'user-456',
        'X-Client-Version': '2.1.0',
      },
    });
  });
});
