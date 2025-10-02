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
  
  console.log('Authorization check:', { blobKey, userId });
  
  // Normalize user ID (replace | with - for blob key comparison)
  const normalizedUserId = userId.replace(/\|/g, '-');
  
  // Check if the blob key contains the user's ID
  // This handles patterns like: prod/uploads/{userId}/... or rag-documents/{userId}/...
  const keySegments = blobKey.split('/');
  
  // Look for the user ID in any segment of the path
  for (let i = 0; i < keySegments.length; i++) {
    const segment = keySegments[i];
    if (segment === normalizedUserId || segment === userId) {
      console.log('User authorized - found userId in segment:', segment);
      return true;
    }
  }
  
  console.log('User not authorized - userId not found in blob key');
  return false;
};

export const handler = async (event, context) => {
  console.log('user-blob-access function called');
  console.log('Event headers:', JSON.stringify(event.headers, null, 2));
  console.log('Context:', JSON.stringify(context, null, 2));
  
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
    console.log('Extracted userId:', userId);
    if (!userId) {
      console.log('No userId found, returning 401');
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          error: 'User authentication required',
          debug: {
            headers: Object.keys(event.headers || {}),
            hasContext: !!context,
            hasClientContext: !!context?.clientContext,
            hasUser: !!context?.clientContext?.user
          }
        }),
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
      console.log('Authorization failed for user:', userId, 'key:', keyParam);
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ 
          error: 'Access denied', 
          message: 'You can only access your own documents',
          debug: {
            userId,
            keyParam,
            normalizedUserId: userId.replace(/\|/g, '-')
          }
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
