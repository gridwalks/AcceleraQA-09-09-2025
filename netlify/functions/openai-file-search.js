const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const client = jwksClient({
  jwksUri: `https://${process.env.REACT_APP_AUTH0_DOMAIN}/.well-known/jwks.json`,
  requestHeaders: {},
  timeout: 30000,
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 5
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      console.error('Error getting signing key:', err);
      return callback(err);
    }
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
}

const extractUserId = async (event, context) => {
  let userId = null;
  if (event.headers['x-user-id']) {
    return { userId: event.headers['x-user-id'], source: 'x-user-id header' };
  }
  if (event.headers.authorization) {
    const authHeader = event.headers.authorization;
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      try {
        const decoded = await new Promise((resolve, reject) => {
          jwt.verify(token, getKey, {
            audience: process.env.REACT_APP_AUTH0_AUDIENCE,
            issuer: `https://${process.env.REACT_APP_AUTH0_DOMAIN}/`,
            algorithms: ['RS256']
          }, (err, decoded) => {
            if (err) reject(err); else resolve(decoded);
          });
        });
        if (decoded && decoded.sub) {
          userId = decoded.sub;
        }
      } catch (err) {
        console.error('JWT verification failed:', err.message);
      }
    }
  }
  if (!userId && context.clientContext?.user?.sub) {
    userId = context.clientContext.user.sub;
  }
  if (!userId && (process.env.NODE_ENV === 'development' || process.env.NETLIFY_DEV === 'true')) {
    userId = 'dev-user-' + Date.now();
  }
  return { userId };
};

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

async function openaiRequest(path, { method = 'GET', body, isForm = false } = {}) {
  const url = `https://api.openai.com/v1${path}`;
  const requestHeaders = {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  };
  if (!isForm) {
    requestHeaders['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    method,
    headers: requestHeaders,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  return res;
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight' }) };
  }

  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const { userId } = await extractUserId(event, context);
    if (!userId) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'User authentication required' }) };
    }

    let requestData = {};
    try {
      requestData = JSON.parse(event.body || '{}');
    } catch (err) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON in request body' }) };
    }

    const { action } = requestData;
    switch (action) {
      case 'upload':
        return await handleUpload(requestData.document);
      case 'list':
        return await handleList();
      case 'delete':
        return await handleDelete(requestData.fileId);
      case 'search':
        return await handleSearch(requestData.query);
      case 'stats':
        return await handleStats();
      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid action: ${action}` }) };
    }
  } catch (error) {
    console.error('openai-file-search error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error', message: error.message }) };
  }
};

async function handleUpload(document = {}) {
  try {
    const form = new FormData();
    const blob = new Blob([document.text || ''], { type: 'text/plain' });
    form.append('file', blob, document.filename || 'document.txt');
    form.append('purpose', 'assistants');

    const fileRes = await openaiRequest('/files', { method: 'POST', body: form, isForm: true });
    const fileData = await fileRes.json();

    if (process.env.OPENAI_VECTOR_STORE_ID) {
      await openaiRequest(`/vector_stores/${process.env.OPENAI_VECTOR_STORE_ID}/files`, {
        method: 'POST',
        body: { file_id: fileData.id },
      });
    }

    return { statusCode: 201, headers, body: JSON.stringify({ id: fileData.id, filename: fileData.filename }) };
  } catch (err) {
    console.error('Upload error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to upload document', message: err.message }) };
  }
}

async function handleList() {
  try {
    const res = await openaiRequest('/files');
    const data = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify({ files: data.data || [] }) };
  } catch (err) {
    console.error('List error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to list files', message: err.message }) };
  }
}

async function handleDelete(fileId) {
  try {
    if (!fileId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'fileId is required' }) };
    }
    const res = await openaiRequest(`/files/${fileId}`, { method: 'DELETE' });
    const data = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (err) {
    console.error('Delete error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to delete file', message: err.message }) };
  }
}

async function handleSearch(query) {
  try {
    if (!query) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Query is required' }) };
    }
    const payload = {
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      input: [{ role: 'user', content: query }],
      tools: [{ type: 'file_search' }]
    };
    if (process.env.OPENAI_VECTOR_STORE_ID) {
      payload.tool_resources = { file_search: { vector_store_ids: [process.env.OPENAI_VECTOR_STORE_ID] } };
    }
    const res = await openaiRequest('/responses', { method: 'POST', body: payload });
    const data = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify({ answer: data.output_text || '', raw: data }) };
  } catch (err) {
    console.error('Search error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Search failed', message: err.message }) };
  }
}

async function handleStats() {
  try {
    const res = await openaiRequest('/files');
    const data = await res.json();
    const files = data.data || [];
    const totalSize = files.reduce((sum, f) => sum + (f.bytes || 0), 0);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        totalFiles: files.length,
        totalSize,
        lastUpdated: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error('Stats error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to get stats', message: err.message }) };
  }
}
