import { listBlobFiles, getBlobFile } from '../lib/blob-helper.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, x-user-roles, x-user-organization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

const ADMIN_ROLE_KEYWORDS = new Set(['admin', 'administrator', 'superadmin', 'system_admin', 'global_admin']);

const getHeaderValue = (headersMap, key) => {
  if (!headersMap) return null;
  const direct = headersMap[key];
  if (direct) return direct;
  const lowerKey = key.toLowerCase();
  if (headersMap[lowerKey]) return headersMap[lowerKey];
  const upperKey = key.toUpperCase();
  if (headersMap[upperKey]) return headersMap[upperKey];
  return null;
};

const parseRoles = (rawValue) => {
  if (!rawValue || typeof rawValue !== 'string') {
    return [];
  }

  return rawValue
    .split(/[;,]/)
    .map((role) => role.split(/\s+/))
    .flat()
    .map((role) => (typeof role === 'string' ? role.trim().toLowerCase() : ''))
    .filter(Boolean);
};

const extractUserRoles = (event, context) => {
  const headerRoles =
    getHeaderValue(event.headers, 'x-user-roles') ||
    getHeaderValue(event.headers, 'x-user-role') ||
    getHeaderValue(event.headers, 'x_roles');

  let roles = parseRoles(headerRoles);

  if (roles.length === 0) {
    const metadataRoles = context?.clientContext?.user?.app_metadata?.roles;
    if (Array.isArray(metadataRoles)) {
      roles = metadataRoles
        .map((role) => (typeof role === 'string' ? role.trim().toLowerCase() : ''))
        .filter(Boolean);
    }
  }

  if (roles.length === 0) {
    const directRoles = context?.clientContext?.user?.roles;
    if (Array.isArray(directRoles)) {
      roles = directRoles
        .map((role) => (typeof role === 'string' ? role.trim().toLowerCase() : ''))
        .filter(Boolean);
    }
  }

  return Array.from(new Set(roles));
};

const extractUserId = (event, context) => {
  const headerUserId =
    getHeaderValue(event.headers, 'x-user-id') ||
    getHeaderValue(event.headers, 'x-userid') ||
    getHeaderValue(event.headers, 'x_user_id');

  if (headerUserId) {
    return headerUserId;
  }

  const contextUser = context?.clientContext?.user?.sub;
  if (contextUser) {
    return contextUser;
  }

  return null;
};

const rolesIncludeAdmin = (roles = []) =>
  roles.some((role) => ADMIN_ROLE_KEYWORDS.has((role || '').trim().toLowerCase()));

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true }),
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const roles = extractUserRoles(event, context);
    if (!rolesIncludeAdmin(roles)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Administrator privileges required' }),
      };
    }

    const userId = extractUserId(event, context);
    const query = event.queryStringParameters || {};
    const limitParam = Number(query.limit);
    const prefixParam = typeof query.prefix === 'string' ? query.prefix : '';
    const keyParam = typeof query.key === 'string' ? query.key.trim() : '';

    if (keyParam) {
      const file = await getBlobFile({ key: keyParam });

      if (!file) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({
            error: 'Blob not found',
            message: `No blob found for key ${keyParam}`,
            requestedBy: userId || null,
            roles,
          }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ...file,
          requestedBy: userId || null,
          roles,
        }),
      };
    }

    const result = await listBlobFiles({
      prefix: prefixParam,
      limit: Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : undefined,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ...result,
        requestedBy: userId || null,
        roles,
      }),
    };
  } catch (error) {
    console.error('Failed to list Netlify blob files:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to list Netlify blob files',
        message: error.message,
      }),
    };
  }
};
