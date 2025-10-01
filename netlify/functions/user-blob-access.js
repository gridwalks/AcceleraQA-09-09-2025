import { getBlobFile } from '../lib/blob-helper.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, x-user-roles, x-user-organization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

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

const isUserAuthorizedForBlob = (blobKey, userId) => {
  if (!userId || !blobKey) return false;
  
  // Check if the blob key contains the user's ID
  // This assumes blob keys follow the pattern: rag-documents/{userId}/...
  const keySegments = blobKey.split('/');
  if (keySegments.length >= 2) {
    const blobUserId = keySegments[1];
    return blobUserId === userId;
  }
  
  return false;
};

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
    const userId = extractUserId(event, context);
    if (!userId) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'User authentication required' }),
      };
    }

    const query = event.queryStringParameters || {};
    const keyParam = typeof query.key === 'string' ? query.key.trim() : '';

    if (!keyParam) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Blob key is required' }),
      };
    }

    // Check if user is authorized to access this blob
    if (!isUserAuthorizedForBlob(keyParam, userId)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ 
          error: 'Access denied', 
          message: 'You can only access your own documents' 
        }),
      };
    }

    const file = await getBlobFile({ key: keyParam });

    if (!file) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          error: 'Blob not found',
          message: `No blob found for key ${keyParam}`,
          requestedBy: userId,
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ...file,
        requestedBy: userId,
      }),
    };
  } catch (error) {
    console.error('Failed to access user blob:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to access blob',
        message: error.message,
      }),
    };
  }
};
