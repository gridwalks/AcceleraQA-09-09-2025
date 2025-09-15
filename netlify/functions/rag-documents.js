import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

let sqlClient = null;
let schemaPromise = null;

const getSqlClient = () => {
  if (!sqlClient) {
    const connectionString = process.env.NEON_DATABASE_URL;
    if (!connectionString) {
      throw new Error('NEON_DATABASE_URL environment variable is not set');
    }
    sqlClient = neon(connectionString);
  }
  return sqlClient;
};

const ensureSchema = async (sql) => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS rag_user_vector_stores (
          user_id TEXT PRIMARY KEY,
          vector_store_id TEXT NOT NULL,
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS rag_user_documents (
          document_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          file_id TEXT NOT NULL,
          filename TEXT NOT NULL,
          content_type TEXT,
          size BIGINT,
          metadata JSONB DEFAULT '{}'::jsonb,
          chunks INTEGER DEFAULT 0,
          vector_store_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS idx_rag_user_documents_user_id
        ON rag_user_documents(user_id)
      `;
    })();
  }

  return schemaPromise;
};

const getHeaderValue = (headersMap, key) => {
  if (!headersMap) return null;
  const direct = headersMap[key];
  if (direct) return direct;

  const lower = key.toLowerCase();
  if (headersMap[lower]) return headersMap[lower];

  const upper = key.toUpperCase();
  if (headersMap[upper]) return headersMap[upper];

  return null;
};

const extractUserId = (event, context) => {
  const headerUserId =
    getHeaderValue(event.headers, 'x-user-id') ||
    getHeaderValue(event.headers, 'x-userid') ||
    getHeaderValue(event.headers, 'x_user_id');

  if (headerUserId) {
    return { userId: headerUserId, source: 'header' };
  }

  const contextUser = context?.clientContext?.user?.sub;
  if (contextUser) {
    return { userId: contextUser, source: 'netlify-context' };
  }

  if (process.env.NODE_ENV === 'development' || process.env.NETLIFY_DEV === 'true') {
    return { userId: `dev-user-${Date.now()}`, source: 'development-fallback' };
  }

  return { userId: null, source: 'unknown' };
};

const createResponse = (statusCode, body) => ({
  statusCode,
  headers,
  body: JSON.stringify(body),
});

const mapDocumentRow = (row) => ({
  id: row.document_id,
  fileId: row.file_id,
  filename: row.filename,
  type: row.content_type,
  size: row.size == null ? 0 : Number(row.size),
  metadata: row.metadata || {},
  chunks: row.chunks == null ? 0 : Number(row.chunks),
  vectorStoreId: row.vector_store_id || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const handleHealth = async (sql) => {
  await sql`SELECT 1`;
  return createResponse(200, {
    status: 'ok',
    message: 'Document metadata service reachable',
    timestamp: new Date().toISOString(),
  });
};

const handleGetVectorStore = async (sql, userId) => {
  const rows = await sql`
    SELECT vector_store_id, metadata, created_at, updated_at
    FROM rag_user_vector_stores
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  const record = rows[0];
  return createResponse(200, {
    vectorStoreId: record?.vector_store_id || null,
    metadata: record?.metadata || {},
    createdAt: record?.created_at || null,
    updatedAt: record?.updated_at || null,
  });
};

const handleSetVectorStore = async (sql, userId, payload) => {
  const { vectorStoreId, metadata = {} } = payload || {};

  if (!vectorStoreId) {
    return createResponse(400, { error: 'vectorStoreId is required' });
  }

  const rows = await sql`
    INSERT INTO rag_user_vector_stores (user_id, vector_store_id, metadata)
    VALUES (${userId}, ${vectorStoreId}, ${metadata})
    ON CONFLICT (user_id) DO UPDATE
    SET vector_store_id = EXCLUDED.vector_store_id,
        metadata = EXCLUDED.metadata,
        updated_at = CURRENT_TIMESTAMP
    RETURNING vector_store_id, metadata, created_at, updated_at
  `;

  const record = rows[0];
  return createResponse(200, {
    vectorStoreId: record.vector_store_id,
    metadata: record.metadata || {},
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  });
};

const handleListDocuments = async (sql, userId) => {
  const rows = await sql`
    SELECT document_id, file_id, filename, content_type, size, metadata, chunks, vector_store_id, created_at, updated_at
    FROM rag_user_documents
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;

  return createResponse(200, {
    documents: rows.map(mapDocumentRow),
    total: rows.length,
  });
};

const handleSaveDocument = async (sql, userId, payload) => {
  const document = payload?.document;
  const vectorStoreId = payload?.vectorStoreId || document?.vectorStoreId || null;

  if (!document) {
    return createResponse(400, { error: 'Document payload is required' });
  }

  const documentId = document.id || document.documentId || document.fileId || randomUUID();
  const normalizedMetadata = document.metadata && typeof document.metadata === 'object'
    ? document.metadata
    : {};

  const rows = await sql`
    INSERT INTO rag_user_documents (
      document_id,
      user_id,
      file_id,
      filename,
      content_type,
      size,
      metadata,
      chunks,
      vector_store_id
    ) VALUES (
      ${documentId},
      ${userId},
      ${document.fileId || documentId},
      ${document.filename || document.name || 'Uploaded Document'},
      ${document.type || document.contentType || null},
      ${document.size ?? 0},
      ${normalizedMetadata},
      ${document.chunks ?? 0},
      ${vectorStoreId}
    )
    ON CONFLICT (document_id) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        file_id = EXCLUDED.file_id,
        filename = EXCLUDED.filename,
        content_type = EXCLUDED.content_type,
        size = EXCLUDED.size,
        metadata = EXCLUDED.metadata,
        chunks = EXCLUDED.chunks,
        vector_store_id = EXCLUDED.vector_store_id,
        updated_at = CURRENT_TIMESTAMP
    RETURNING document_id, file_id, filename, content_type, size, metadata, chunks, vector_store_id, created_at, updated_at
  `;

  return createResponse(200, {
    document: mapDocumentRow(rows[0]),
  });
};

const handleDeleteDocument = async (sql, userId, payload) => {
  const { documentId } = payload || {};

  if (!documentId) {
    return createResponse(400, { error: 'documentId is required' });
  }

  await sql`
    DELETE FROM rag_user_documents
    WHERE user_id = ${userId}
      AND document_id = ${documentId}
  `;

  return createResponse(200, { success: true });
};

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'ok' }),
    };
  }

  if (event.httpMethod !== 'POST') {
    return createResponse(405, { error: 'Method not allowed' });
  }

  try {
    const sql = getSqlClient();
    await ensureSchema(sql);

    const { userId } = extractUserId(event, context);
    if (!userId) {
      return createResponse(401, {
        error: 'User authentication required',
        message: 'Missing x-user-id header or authenticated context.',
      });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (parseError) {
      return createResponse(400, { error: 'Invalid JSON payload', message: parseError.message });
    }

    const { action, ...data } = payload;
    if (!action) {
      return createResponse(400, { error: 'Action is required' });
    }

    switch (action) {
      case 'health':
        return await handleHealth(sql);
      case 'get_vector_store':
        return await handleGetVectorStore(sql, userId);
      case 'set_vector_store':
        return await handleSetVectorStore(sql, userId, data);
      case 'list_documents':
        return await handleListDocuments(sql, userId);
      case 'save_document':
        return await handleSaveDocument(sql, userId, data);
      case 'delete_document':
        return await handleDeleteDocument(sql, userId, data);
      default:
        return createResponse(400, { error: `Unsupported action: ${action}` });
    }
  } catch (error) {
    console.error('Document metadata handler error:', error);
    return createResponse(500, {
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};
