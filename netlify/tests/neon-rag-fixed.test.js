import { jest } from '@jest/globals';

jest.unstable_mockModule('@neondatabase/serverless', () => ({
  neon: jest.fn(() => {
    const sql = jest.fn(async () => []);
    return sql;
  }),
  neonConfig: {},
}));

describe('Neon error diagnostics', () => {
  const originalNeonEnv = {
    NEON_DATABASE_URL: process.env.NEON_DATABASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    POSTGRES_URL: process.env.POSTGRES_URL,
  };

  const restoreEnv = () => {
    for (const [key, value] of Object.entries(originalNeonEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  beforeEach(() => {
    jest.resetModules();
    delete process.env.NEON_DATABASE_URL;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
  });

  afterEach(() => {
    jest.resetModules();
    restoreEnv();
  });

  test('surfaces guidance when connection string is missing', async () => {
    const module = await import('../functions/neon-rag-fixed.js');
    const { buildNeonErrorDetails } = module.__testHelpers;

    const error = new Error('FetchError: request to https://neon failed');
    error.code = 'ENOTFOUND';

    const details = buildNeonErrorDetails(error);

    expect(details.provider).toBe('neon-postgresql');
    expect(details.connectionConfigured).toBe(false);
    expect(details.suggestion).toMatch(/NEON_DATABASE_URL/);
    expect(Array.isArray(details.recommendations)).toBe(true);
    expect(details.recommendations[0]).toEqual(details.suggestion);
    expect(typeof details.timestamp).toBe('string');
  });

  test('includes host information and credential guidance when authentication fails', async () => {
    process.env.NEON_DATABASE_URL = 'postgres://user:secret@db.neon.tech/example';

    const module = await import('../functions/neon-rag-fixed.js');
    const { buildNeonErrorDetails } = module.__testHelpers;

    const error = new Error('password authentication failed for user "user"');
    error.code = '28P01';

    const details = buildNeonErrorDetails(error);

    expect(details.connectionConfigured).toBe(true);
    expect(details.host).toBe('db.neon.tech');
    expect(details.database).toBe('example');
    expect(details.userPresent).toBe(true);
    expect(details.suggestion).toMatch(/username/i);
  });

  test('recommends enabling sslmode when absent and SSL errors occur', async () => {
    process.env.NEON_DATABASE_URL = 'postgres://user:secret@db.neon.tech/example';

    const module = await import('../functions/neon-rag-fixed.js');
    const { buildNeonErrorDetails } = module.__testHelpers;

    const error = new Error('self signed certificate in certificate chain');

    const details = buildNeonErrorDetails(error);

    expect(details.hasSslMode).toBe(false);
    expect(details.suggestion).toMatch(/sslmode=require/);
  });
});
