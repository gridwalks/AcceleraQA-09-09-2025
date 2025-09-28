import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';

import { uploadDocumentToS3 } from '../lib/s3-helper.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

let sqlClient = null;
let schemaPromise = null;

const MAX_BASE64_LENGTH = 12 * 1024 * 1024; // ~9 MB binary payload
const BASE64_CLEANUP_REGEX = /\s+/g;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const DEFAULT_CONTENT_ENCODING = 'base64';

const getOpenAIApiKey = () => process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY || null;

const getFirstNonEmptyString = (...values) => {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return '';
};

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
          content_base64 TEXT,
          content_encoding TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS idx_rag_user_documents_user_id
        ON rag_user_documents(user_id)
      `;

      await sql`
        ALTER TABLE rag_user_documents
        ADD COLUMN IF NOT EXISTS content_base64 TEXT
      `;

      await sql`
        ALTER TABLE rag_user_documents
        ADD COLUMN IF NOT EXISTS content_encoding TEXT
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

const mapDocumentRow = (row) => {
  const metadata = row.metadata && typeof row.metadata === 'object' ? { ...row.metadata } : {};
  const storageLocation =
    metadata.storage && typeof metadata.storage === 'object' ? { ...metadata.storage } : null;

  return {
    id: row.document_id,
    fileId: row.file_id,
    filename: row.filename,
    type: row.content_type,
    size: row.size == null ? 0 : Number(row.size),
    metadata,
    chunks: row.chunks == null ? 0 : Number(row.chunks),
    vectorStoreId: row.vector_store_id || null,
    storageLocation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const isAccessDeniedError = (error) => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = error.name || error.Code || error.code;
  const status = error.$metadata?.httpStatusCode || error.statusCode;
  const message = typeof error.message === 'string' ? error.message : '';

  return (
    code === 'AccessDenied' ||
    code === 'Forbidden' ||
    status === 403 ||
    /access\s*denied/i.test(message)
  );
};

const logS3AccessDeniedHint = (error) => {
  if (isAccessDeniedError(error)) {
    console.error(
      'If the policy is scoped to arn:aws:s3:::acceleraqa-kb/uploads/* but your app is writing to rag-documents/, S3 will return Access Denied'
    );
  }
};

const estimateBinarySizeFromBase64 = (base64 = '') => {
  if (!base64) return 0;

  const sanitized = base64.replace(BASE64_CLEANUP_REGEX, '');
  const padding = sanitized.endsWith('==') ? 2 : sanitized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((sanitized.length * 3) / 4) - padding);
};

const normalizeDocumentContent = (document = {}) => {
  if (!document || typeof document !== 'object') {
    return { base64: null, encoding: null, truncated: false };
  }

  const rawContent = typeof document.content === 'string' ? document.content.trim() : '';
  if (!rawContent) {
    return { base64: null, encoding: null, truncated: false };
  }

  const declaredEncoding = typeof document.encoding === 'string' ? document.encoding.trim().toLowerCase() : '';
  const normalizedEncoding = declaredEncoding || DEFAULT_CONTENT_ENCODING;

  if (normalizedEncoding === 'base64') {
    const sanitized = rawContent.replace(BASE64_CLEANUP_REGEX, '');
    if (!BASE64_PATTERN.test(sanitized)) {
      throw new Error('Invalid base64 document content');
    }

    if (sanitized.length > MAX_BASE64_LENGTH) {
      return { base64: null, encoding: null, truncated: true };
    }

    return { base64: sanitized, encoding: DEFAULT_CONTENT_ENCODING, truncated: false };
  }

  if (normalizedEncoding === 'utf8' || normalizedEncoding === 'text') {
    const buffer = Buffer.from(rawContent, 'utf8');
    let base64 = buffer.toString('base64');
    let truncated = false;

    if (base64.length > MAX_BASE64_LENGTH) {
      return { base64: null, encoding: null, truncated: true };
    }

    return { base64, encoding: DEFAULT_CONTENT_ENCODING, truncated };
  }

  throw new Error(`Unsupported document encoding: ${declaredEncoding || 'unknown'}`);
};

const sanitizeDocumentMetadata = (metadata = {}) => {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }

  const sanitized = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        sanitized[key] = trimmed;
      }
      continue;
    }

    if (Array.isArray(value)) {
      const normalizedArray = value
        .map(item => (typeof item === 'string' ? item.trim() : item))
        .filter(item => {
          if (item === null || item === undefined) {
            return false;
          }

          if (typeof item === 'string') {
            return item !== '';
          }

          return true;
        });

      if (normalizedArray.length > 0) {
        sanitized[key] = normalizedArray;
      }
      continue;
    }

    sanitized[key] = value;
  }

  if (sanitized.summary && !sanitized.description) {
    sanitized.description = sanitized.summary;
  }

  if (sanitized.description && !sanitized.summary) {
    sanitized.summary = sanitized.description;
  }

  const resolvedTitle = getFirstNonEmptyString(
    sanitized.title,
    sanitized.fileTitle,
    sanitized.documentTitle,
    sanitized.displayTitle,
  );

  if (resolvedTitle) {
    if (!sanitized.title) {
      sanitized.title = resolvedTitle;
    }
    if (!sanitized.fileTitle) {
      sanitized.fileTitle = resolvedTitle;
    }
    if (!sanitized.documentTitle) {
      sanitized.documentTitle = resolvedTitle;
    }
    if (!sanitized.displayTitle) {
      sanitized.displayTitle = resolvedTitle;
    }
  }

  if (!sanitized.fileName) {
    const fallbackFileName = getFirstNonEmptyString(
      sanitized.filename,
      sanitized.file_name,
      sanitized.name,
    );
    if (fallbackFileName) {
      sanitized.fileName = fallbackFileName;
    }
  }

  return sanitized;
};

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
  const normalizedMetadata = sanitizeDocumentMetadata(
    document.metadata && typeof document.metadata === 'object' ? document.metadata : {}
  );

  let contentBuffer = null;
  let contentEncoding = null;
  let storageLocation = null;
  try {
    const normalizedContent = normalizeDocumentContent(document);
    if (normalizedContent.base64) {
      contentBuffer = Buffer.from(normalizedContent.base64, 'base64');
      contentEncoding = normalizedContent.encoding;
    } else if (normalizedContent.truncated) {
      console.warn(
        `Document content for ${documentId} exceeded persistence limit and will not be persisted locally. Uploading original payload skipped.`
      );
    }
  } catch (contentError) {
    console.warn('Unable to normalize document content for persistence:', contentError);
  }

  if (contentBuffer) {
    try {
      storageLocation = await uploadDocumentToS3({
        body: contentBuffer,
        contentType: document.type || document.contentType || document.mimeType || 'application/octet-stream',
        documentId,
        userId,
        filename: document.filename || document.name,
        metadata: {
          'x-user-id': userId,
          'x-document-id': documentId,
        },
      });
    } catch (uploadError) {
      console.error('Failed to upload document content to S3:', uploadError);
      logS3AccessDeniedHint(uploadError);
      storageLocation = null;
    }
  }

  const numericSize = Number.isFinite(Number(document.size)) ? Number(document.size) : null;
  const resolvedSize =
    numericSize ?? (storageLocation?.size != null ? Number(storageLocation.size) : contentBuffer?.length ?? 0);

  if (storageLocation) {
    normalizedMetadata.storage = {
      provider: 's3',
      bucket: storageLocation.bucket,
      region: storageLocation.region,
      key: storageLocation.key,
      url: storageLocation.url,
      etag: storageLocation.etag || null,
      size: storageLocation.size ?? contentBuffer?.length ?? numericSize ?? null,
    };
  }

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
      vector_store_id,
      content_base64,
      content_encoding
    ) VALUES (
      ${documentId},
      ${userId},
      ${document.fileId || documentId},
      ${document.filename || document.name || 'Uploaded Document'},
      ${document.type || document.contentType || null},
      ${resolvedSize},
      ${normalizedMetadata},
      ${document.chunks ?? 0},
      ${vectorStoreId},
      ${storageLocation ? null : contentBuffer ? contentBuffer.toString('base64') : null},
      ${storageLocation ? null : contentEncoding}
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
        content_base64 = COALESCE(EXCLUDED.content_base64, rag_user_documents.content_base64),
        content_encoding = COALESCE(EXCLUDED.content_encoding, rag_user_documents.content_encoding),
        updated_at = CURRENT_TIMESTAMP
    RETURNING document_id, file_id, filename, content_type, size, metadata, chunks, vector_store_id, created_at, updated_at
  `;

  const mapped = mapDocumentRow(rows[0]);
  return createResponse(200, {
    document: mapped,
    storageLocation: mapped.storageLocation || storageLocation,
  });
};

const isJsonLikeContentType = (contentType = '') => {
  const lower = contentType.toLowerCase();
  return lower.includes('application/json') || lower.includes('+json') || lower.includes('text/json');
};

const payloadContainsVectorStoreDescriptor = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const objectValue = typeof payload.object === 'string' ? payload.object.toLowerCase() : '';
  if (objectValue.includes('vector_store')) {
    return true;
  }

  const typeValue = typeof payload.type === 'string' ? payload.type.toLowerCase() : '';
  if (typeValue.includes('vector_store')) {
    return true;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'vector_store') || Object.prototype.hasOwnProperty.call(payload, 'vector_store_id')) {
    return true;
  }

  if (Array.isArray(payload.data)) {
    return payload.data.some(item => payloadContainsVectorStoreDescriptor(item));
  }

  return false;
};

const downloadDocumentContentFromOpenAI = async ({ apiKey, fileId, vectorStoreId }) => {
  if (!fileId) {
    return { error: 'File identifier is required to download document content', statusCode: 400 };
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'OpenAI-Beta': 'assistants=v2',
  };

  const attempts = [];

  if (vectorStoreId) {
    attempts.push({
      type: 'vector-store',
      url: `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files/${fileId}/content`,
    });
  }

  attempts.push({
    type: 'file',
    url: `https://api.openai.com/v1/files/${fileId}/content`,
  });

  let lastError = null;

  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, { method: 'GET', headers });

      if (response.ok) {
        const contentType = response.headers.get('content-type');
        let shouldSkipResponse = false;

        if (isJsonLikeContentType(contentType) || (!contentType && attempt.type === 'vector-store')) {
          try {
            const rawText = await response.clone().text();
            const parsed = JSON.parse(rawText);

            if (payloadContainsVectorStoreDescriptor(parsed)) {
              console.warn(
                `Received vector store JSON payload while retrieving document content via ${attempt.type} endpoint. Falling back to next endpoint.`
              );
              shouldSkipResponse = true;
              lastError = {
                statusCode: 502,
                message: 'Received vector store JSON payload instead of document bytes',
              };
            }
          } catch (jsonInspectionError) {
            if (isJsonLikeContentType(contentType)) {
              console.warn('Unable to inspect JSON response while downloading document content:', jsonInspectionError);
            }
          }
        }

        if (shouldSkipResponse) {
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        return { buffer, contentType };
      }

      let errorMessage = `Failed to retrieve document content (status ${response.status})`;
      try {
        const errorBody = await response.json();
        errorMessage = errorBody?.error?.message || errorBody?.error || errorBody?.message || errorMessage;
      } catch (parseError) {
        console.warn('Unable to parse OpenAI error response for document download:', parseError);
      }

      console.warn(`Document download via ${attempt.type} endpoint failed: ${errorMessage}`);
      lastError = { statusCode: response.status, message: errorMessage };
    } catch (error) {
      console.error(`Document download attempt via ${attempt.type} endpoint encountered an error:`, error);
      lastError = { statusCode: 502, message: error.message };
    }
  }

  return {
    error: lastError?.message || 'Failed to retrieve document content',
    statusCode: lastError?.statusCode || 502,
  };
};

const handleDownloadDocument = async (sql, userId, payload) => {
  const documentId = payload?.documentId;
  const fileId = payload?.fileId;

  if (!documentId && !fileId) {
    return createResponse(400, { error: 'documentId or fileId is required' });
  }

  const rows = await sql`
    SELECT document_id, file_id, filename, content_type, size, metadata, vector_store_id, content_base64, content_encoding
    FROM rag_user_documents
    WHERE user_id = ${userId}
      AND (document_id = ${documentId} OR file_id = ${fileId})
    LIMIT 1
  `;

  const record = rows[0];
  if (!record) {
    return createResponse(404, { error: 'Document not found for this user' });
  }

  const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  const storageLocation = metadata.storage && typeof metadata.storage === 'object' ? metadata.storage : null;

  if (record.content_base64) {
    const encoding = record.content_encoding || DEFAULT_CONTENT_ENCODING;
    const derivedSize = estimateBinarySizeFromBase64(record.content_base64);

    return createResponse(200, {
      documentId: record.document_id,
      fileId: record.file_id,
      filename: record.filename,
      contentType: record.content_type || 'application/octet-stream',
      size: record.size == null ? derivedSize : Number(record.size),
      encoding,
      content: record.content_base64,
      metadata,
      storageLocation,
    });
  }

  if (storageLocation) {
    return createResponse(200, {
      documentId: record.document_id,
      fileId: record.file_id,
      filename: record.filename,
      contentType: record.content_type || 'application/octet-stream',
      size: record.size == null ? Number(storageLocation.size || 0) : Number(record.size),
      storageLocation,
      metadata,
    });
  }

  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    return createResponse(500, { error: 'OpenAI API key is not configured' });
  }

  const resolvedFileId = record.file_id || fileId || documentId;
  const vectorStoreId = record.vector_store_id || null;

  const downloadResult = await downloadDocumentContentFromOpenAI({
    apiKey,
    fileId: resolvedFileId,
    vectorStoreId,
  });

  if (downloadResult.error) {
    const lowered = (downloadResult.error || '').toLowerCase();
    if (/purpose\s*:\s*assistants/.test(lowered)) {
      return createResponse(downloadResult.statusCode === 400 ? 403 : downloadResult.statusCode, {
        error:
          'OpenAI does not permit downloading assistant-ingested files directly. Re-upload the original source document or contact support to recover the content.',
        details: downloadResult.error,
      });
    }

    return createResponse(downloadResult.statusCode, { error: downloadResult.error });
  }

  const base64Content = downloadResult.buffer.toString('base64');
  const computedSize = downloadResult.buffer.length;

  if (base64Content.length <= MAX_BASE64_LENGTH) {
    try {
      await sql`
        UPDATE rag_user_documents
        SET content_base64 = ${base64Content},
            content_encoding = ${DEFAULT_CONTENT_ENCODING},
            size = COALESCE(rag_user_documents.size, ${computedSize}),
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ${userId}
          AND document_id = ${record.document_id}
      `;
    } catch (persistError) {
      console.warn('Failed to persist downloaded document content:', persistError);
    }
  } else {
    console.warn('Downloaded document content exceeds local persistence limit. Serving response without caching.');
  }

  return createResponse(200, {
    documentId: record.document_id,
    fileId: record.file_id,
    filename: record.filename,
    contentType: record.content_type || downloadResult.contentType || 'application/octet-stream',
    size: record.size == null ? computedSize : Number(record.size),
    encoding: DEFAULT_CONTENT_ENCODING,
    content: base64Content,
    metadata,
    storageLocation,
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

const handleUpdateDocument = async (sql, userId, payload) => {
  const documentId = payload?.documentId;
  const metadataUpdates = payload?.metadata;
  const clearFieldsInput = Array.isArray(payload?.clearFields) ? payload.clearFields : [];

  if (!documentId) {
    return createResponse(400, { error: 'documentId is required' });
  }

  const existingRows = await sql`
    SELECT document_id, file_id, filename, content_type, size, metadata, chunks, vector_store_id, created_at, updated_at
    FROM rag_user_documents
    WHERE user_id = ${userId}
      AND document_id = ${documentId}
    LIMIT 1
  `;

  const existingRow = existingRows[0];
  if (!existingRow) {
    return createResponse(404, { error: 'Document not found for this user' });
  }

  const currentMetadata = existingRow.metadata && typeof existingRow.metadata === 'object'
    ? { ...existingRow.metadata }
    : {};

  const fieldsToClear = clearFieldsInput
    .map(field => (typeof field === 'string' ? field.trim() : ''))
    .filter(Boolean);

  fieldsToClear.forEach(field => {
    delete currentMetadata[field];
  });

  const sanitizedUpdates = sanitizeDocumentMetadata(metadataUpdates || {});
  const hasUpdates = Object.keys(sanitizedUpdates).length > 0;
  const hasClears = fieldsToClear.length > 0;

  if (!hasUpdates && !hasClears) {
    return createResponse(200, { document: mapDocumentRow(existingRow) });
  }

  const mergedMetadata = sanitizeDocumentMetadata({
    ...currentMetadata,
    ...sanitizedUpdates,
  });

  const updatedRows = await sql`
    UPDATE rag_user_documents
    SET metadata = ${mergedMetadata},
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ${userId}
      AND document_id = ${documentId}
    RETURNING document_id, file_id, filename, content_type, size, metadata, chunks, vector_store_id, created_at, updated_at
  `;

  const updatedRow = updatedRows[0];
  return createResponse(200, { document: mapDocumentRow(updatedRow) });
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
      case 'update_document':
        return await handleUpdateDocument(sql, userId, data);
      case 'download_document':
        return await handleDownloadDocument(sql, userId, data);
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

export const __testHelpers = {
  downloadDocumentContentFromOpenAI,
  isJsonLikeContentType,
  payloadContainsVectorStoreDescriptor,
  handleSaveDocument,
};
