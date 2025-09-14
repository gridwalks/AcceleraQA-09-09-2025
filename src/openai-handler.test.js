import { handler } from '../netlify/functions/rag-enhanced.js';

describe('OpenAI handler', () => {
  it('returns 405 for non-POST methods', async () => {
    const res = await handler({ httpMethod: 'GET', headers: {} }, {});
    expect(res.statusCode).toBe(405);
  });

  it('requires an action parameter', async () => {
    const res = await handler({ httpMethod: 'POST', body: '{}', headers: {} }, {});
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/Action parameter is required/);
  });

  it('returns stats for stats action', async () => {
    const event = {
      httpMethod: 'POST',
      headers: { 'x-user-id': 'user1' },
      body: JSON.stringify({ action: 'stats' })
    };
    const res = await handler(event, {});
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual(expect.objectContaining({
      totalDocuments: 0,
      totalChunks: 0,
      storage: 'enhanced-memory'
    }));
  });
});
