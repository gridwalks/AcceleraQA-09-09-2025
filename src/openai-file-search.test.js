import { handler } from '../netlify/functions/openai-file-search.js';
import { jest } from '@jest/globals';

describe('openai-file-search handler', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    jest.restoreAllMocks();
  });

  test('returns 500 when API key is missing', async () => {
    const res = await handler({ httpMethod: 'GET', path: '/api/rag/test', headers: {}, rawQuery: '' });
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(500);
    expect(body.error).toBe('OPENAI_API_KEY is not set');
  });

  test('proxies request to OpenAI API when key provided', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => 'ok',
    });

    const event = {
      httpMethod: 'POST',
      path: '/api/rag/chat',
      headers: { 'content-type': 'application/json' },
      rawQuery: '',
      body: '{"a":1}',
    };

    const res = await handler(event);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        body: '{"a":1}',
      })
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ok');
  });

  test('handles CORS preflight requests', async () => {
    const res = await handler({ httpMethod: 'OPTIONS', path: '/api/rag/anything', headers: {} });
    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });
});
