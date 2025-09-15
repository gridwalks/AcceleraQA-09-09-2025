import { jest } from '@jest/globals';
import { TextEncoder, TextDecoder } from 'util';
import { hasAdminRole } from '../utils/auth';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

describe('AuthService initialize', () => {
  beforeEach(() => {
    jest.resetModules();
  });
  afterEach(() => {
    jest.dontMock('@auth0/auth0-spa-js');
  });

  it('stores tokens in local storage with refresh support', async () => {
    process.env.REACT_APP_AUTH0_DOMAIN = 'test.auth0.com';
    process.env.REACT_APP_AUTH0_CLIENT_ID = 'abc123';

    const createAuth0Client = jest.fn().mockResolvedValue({});
    jest.doMock('@auth0/auth0-spa-js', () => ({ createAuth0Client }));

    const authService = (await import('./authService')).default;

    await authService.initialize();

    expect(createAuth0Client).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheLocation: 'localstorage',
        useRefreshTokens: true,
        useRefreshTokensFallback: true
      })
    );
  });
});

describe('AuthService getUser', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns user data with roles and organization when claim is present', async () => {
    process.env.REACT_APP_AUTH0_ROLES_CLAIM = 'https://example.com/roles';
    process.env.REACT_APP_AUTH0_ORG_CLAIM = 'https://example.com/org';
    const authService = require('./authService').default;

    authService.auth0Client = {
      getUser: jest.fn().mockResolvedValue({ sub: 'user123', name: 'Test User' }),
      getIdTokenClaims: jest.fn().mockResolvedValue({
        'https://example.com/roles': ['admin', 'editor'],
        'https://example.com/org': 'Acme Corp'
      })
    };
    authService.isAuthenticated = jest.fn().mockResolvedValue(true);

    const result = await authService.getUser();

    expect(authService.auth0Client.getUser).toHaveBeenCalled();
    expect(result).toEqual({
      sub: 'user123',
      name: 'Test User',
      roles: ['admin', 'editor'],
      organization: 'Acme Corp'
    });
  });

  it('attempts silent authentication when user data is initially missing', async () => {
    const authService = require('./authService').default;

    const getUserMock = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ sub: 'user456', name: 'Another User' });

    authService.auth0Client = {
      getUser: getUserMock,
      getIdTokenClaims: jest.fn().mockResolvedValue({}),
      getTokenSilently: jest.fn().mockResolvedValue('fake-token')
    };

    const result = await authService.getUser();

    expect(authService.auth0Client.getTokenSilently).toHaveBeenCalled();
    expect(getUserMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      sub: 'user456',
      name: 'Another User',
      roles: [],
      organization: null
    });
  });
});

describe('hasAdminRole', () => {
  it('handles mixed-case role names consistently', () => {
    expect(hasAdminRole({ roles: ['Admin'] })).toBe(true);
    expect(hasAdminRole({ roles: ['Administrator'] })).toBe(true);
    expect(hasAdminRole({ roles: ['administrator'] })).toBe(true);
    expect(hasAdminRole({ roles: ['editor'] })).toBe(false);
  });
});
