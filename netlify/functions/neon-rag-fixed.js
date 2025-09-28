
import { neon, neonConfig } from '@neondatabase/serverless';

export const config = {
  nodeRuntime: 'nodejs18.x',
};

const DEFAULT_CHUNK_SIZE = 800;
const MAX_CHUNKS = 5000;
const MAX_TEXT_LENGTH = DEFAULT_CHUNK_SIZE * MAX_CHUNKS;
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

let sqlClientPromise = null;
let ensuredSchemaPromise = null;
let documentTypeOptionsPromise = null;

function getFirstNonEmptyString(...values) {
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
}
function ensureFetchAvailable() {
  if (typeof globalThis.fetch === 'function') {
    return;
  }

  const error = new Error(
    'Fetch API is not available in this runtime. Please upgrade to Node.js 18+ or provide a compatible global fetch implementation.'
  );
  error.statusCode = 500;
  throw error;
}

function resolveConnectionString() {
  const connectionString =
    process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (!connectionString) {
    const error = new Error(
      'NEON_DATABASE_URL (or DATABASE_URL) environment variable is not set'
    );
    error.statusCode = 500;
    throw error;
  }
  if (!/sslmode=/i.test(connectionString)) {
    console.warn('Connection string missing sslmode parameter; Neon recommends sslmode=require');
  }

  return connectionString;
}

async function getSqlClient() {
  if (!sqlClientPromise) {
    sqlClientPromise = (async () => {
      ensureFetchAvailable();
      const connectionString = resolveConnectionString();
      neonConfig.fetchConnectionCache = true;
      neonConfig.poolQueryViaFetch = true;
      return neon(connectionString);
    })().catch(error => {
      sqlClientPromise = null;
      throw error;
    });
  }

  return sqlClientPromise;
}

async function ensureRagSchema(sql) {
  if (ensuredSchemaPromise) {
    return ensuredSchemaPromise;
  }

  ensuredSchemaPromise = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS rag_documents (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        original_filename TEXT,
        file_type TEXT,
        file_size BIGINT,
        text_content TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        title TEXT,
        summary TEXT,
        version TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS rag_document_chunks (
        id BIGSERIAL PRIMARY KEY,
        document_id BIGINT NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        word_count INTEGER,
        character_count INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_rag_documents_user_id
        ON rag_documents(user_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_rag_document_chunks_document
        ON rag_document_chunks(document_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_rag_document_chunks_document_index
        ON rag_document_chunks(document_id, chunk_index)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_rag_document_chunks_fts
        ON rag_document_chunks USING GIN (to_tsvector('english', chunk_text))
    `;

    await sql`
      ALTER TABLE rag_documents
        ADD COLUMN IF NOT EXISTS title TEXT
    `;

    await sql`
      ALTER TABLE rag_documents
        ADD COLUMN IF NOT EXISTS summary TEXT
    `;

    await sql`
      ALTER TABLE rag_documents
        ADD COLUMN IF NOT EXISTS version TEXT
    `;
  })().catch(error => {
    ensuredSchemaPromise = null;
    throw error;
  });

  return ensuredSchemaPromise;
}

async function getDocumentTypeOptions(sql) {
  if (documentTypeOptionsPromise) {
    return documentTypeOptionsPromise;
  }

  documentTypeOptionsPromise = (async () => {
    try {
      const rows = await sql`
        SELECT enumlabel
          FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'document_type'
      `;

      return rows.map(row => row.enumlabel);
    } catch (error) {
      console.warn('Unable to load document_type enum options, defaulting to empty list', error.message);
      return [];
    }
  })().catch(error => {
    documentTypeOptionsPromise = null;
    throw error;
  });

  return documentTypeOptionsPromise;
}

function guessExtension(filename) {
  if (typeof filename !== 'string') {
    return '';
  }

  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function normalizeDocumentTypeValue({ mimeType, filename, allowedTypes }) {
  if (!Array.isArray(allowedTypes) || allowedTypes.length === 0) {
    return null;
  }

  const normalizedMime = typeof mimeType === 'string' ? mimeType.toLowerCase() : '';
  const extension = guessExtension(filename);

  const mimeCandidates = new Set();
  if (normalizedMime) {
    mimeCandidates.add(normalizedMime);
    const slashIndex = normalizedMime.indexOf('/');
    if (slashIndex >= 0) {
      mimeCandidates.add(normalizedMime.slice(slashIndex + 1));
    }
  }

  if (extension) {
    mimeCandidates.add(extension);
  }

  const canonicalMap = {
    pdf: 'pdf',
    'application/pdf': 'pdf',
    doc: 'doc',
    'application/msword': 'doc',
    docx: 'docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    ppt: 'ppt',
    'application/vnd.ms-powerpoint': 'ppt',
    pptx: 'pptx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    xls: 'xls',
    'application/vnd.ms-excel': 'xls',
    xlsx: 'xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    csv: 'csv',
    'text/csv': 'csv',
    txt: 'text',
    text: 'text',
    'text/plain': 'text',
    md: 'markdown',
    markdown: 'markdown',
    'text/markdown': 'markdown',
    json: 'json',
    'application/json': 'json',
    html: 'html',
    'text/html': 'html',
    xml: 'xml',
    'application/xml': 'xml',
  };
  for (const candidate of mimeCandidates) {
    const mapped = canonicalMap[candidate];
    if (mapped && allowedTypes.includes(mapped)) {
      return mapped;
    }
    if (allowedTypes.includes(candidate)) {
      return candidate;
    }
  }

  if (allowedTypes.includes('other')) {
    return 'other';
  }

  if (allowedTypes.includes('unknown')) {
    return 'unknown';
  }

  if (allowedTypes.includes('text')) {
    return 'text';
  }

  return null;
}

function requireUserId(event) {
  const headers = event.headers || {};
  const userId =
    headers['x-user-id'] ||
    headers['X-User-Id'] ||
    headers['X-User-ID'] ||
    headers['x-user-id'.toLowerCase()];
  if (!userId || typeof userId !== 'string') {
    const error = new Error('Missing x-user-id header');
    error.statusCode = 401;
    throw error;
  }
  return userId;
}

function sanitizeTextForPostgres(text) {
  if (typeof text !== 'string') {
    return '';
  }

  // PostgreSQL does not allow the null byte (\u0000) in text columns.
  // Strip them proactively so uploads containing binary remnants don't fail.
  return text.replace(/\u0000/g, '');
}

function chunkText(text, chunkSize = DEFAULT_CHUNK_SIZE) {
  if (typeof text !== 'string') {
    return [];
  }

  const safeText = sanitizeTextForPostgres(text);

  const normalizedSize = Math.max(200, Math.min(chunkSize, 2000));
  const chunks = [];
  let index = 0;

  for (let offset = 0; offset < safeText.length; offset += normalizedSize) {
    const chunkTextValue = safeText.slice(offset, offset + normalizedSize);
    chunks.push({
      index: index++,
      text: chunkTextValue,
      wordCount: chunkTextValue.split(/\s+/).filter(Boolean).length,
      characterCount: chunkTextValue.length,
    });
    if (chunks.length >= MAX_CHUNKS) {
      break;
    }
  }

  return chunks;
}

function parseMetadata(rawMetadata) {
  if (!rawMetadata) {
    return {};
  }

  if (typeof rawMetadata === 'object' && !Array.isArray(rawMetadata)) {
    return { ...rawMetadata };
  }

  if (typeof rawMetadata === 'string') {
    try {
      const parsed = JSON.parse(rawMetadata);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  return {};
}

function normalizeDocumentRow(row) {
  const metadata = parseMetadata(row.metadata);
  metadata.processingMode = 'neon-postgresql';

  if (row.title && !metadata.title) {
    metadata.title = row.title;
  }

  if (row.title && !metadata.fileTitle) {
    metadata.fileTitle = row.title;
  }

  if (row.title && !metadata.documentTitle) {
    metadata.documentTitle = row.title;
  }

  if (row.summary && !metadata.summary) {
    metadata.summary = row.summary;
  }

  if (row.summary && !metadata.description) {
    metadata.description = row.summary;
  }

  if (row.version && !metadata.version) {
    metadata.version = row.version;
  }

  if (!metadata.fileName) {
    metadata.fileName = row.filename;
  }

  const resolvedTitle = getFirstNonEmptyString(
    row.title,
    metadata.title,
    metadata.fileTitle,
    metadata.documentTitle,
    row.filename,
  );

  if (resolvedTitle) {
    metadata.title = metadata.title || resolvedTitle;
    metadata.fileTitle = metadata.fileTitle || resolvedTitle;
    metadata.documentTitle = metadata.documentTitle || resolvedTitle;
    metadata.displayTitle = metadata.displayTitle || resolvedTitle;
  }

  const resolvedSummary = getFirstNonEmptyString(
    row.summary,
    metadata.summary,
    metadata.description,
  );

  if (resolvedSummary) {
    metadata.summary = metadata.summary || resolvedSummary;
    metadata.description = metadata.description || resolvedSummary;
    if (!metadata.displaySummary) {
      metadata.displaySummary = resolvedSummary;
    }
  }

  return {
    id: row.id,
    filename: row.filename,
    originalFilename: row.original_filename || null,
    fileType: row.file_type || null,
    fileSize: row.file_size != null ? Number(row.file_size) : null,
    title: resolvedTitle || null,
    summary: resolvedSummary || null,
    version: row.version || metadata.version || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata,
    chunkCount: row.chunk_count != null ? Number(row.chunk_count) : undefined,
    storage: 'neon-postgresql',
  };
}

function buildSearchResult(row) {
  const metadata = parseMetadata(row.metadata);
  metadata.processingMode = 'neon-postgresql';

  if (row.title && !metadata.title) {
    metadata.title = row.title;
  }

  if (row.title && !metadata.documentTitle) {
    metadata.documentTitle = row.title;
  }

  if (row.summary && !metadata.summary) {
    metadata.summary = row.summary;
  }

  if (row.summary && !metadata.description) {
    metadata.description = row.summary;
  }

  if (row.version && !metadata.version) {
    metadata.version = row.version;
  }

  const resolvedTitle = getFirstNonEmptyString(
    row.title,
    metadata.title,
    metadata.documentTitle,
    metadata.fileTitle,
    row.filename,
  );

  if (resolvedTitle) {
    metadata.title = metadata.title || resolvedTitle;
    metadata.documentTitle = metadata.documentTitle || resolvedTitle;
  }

  const resolvedSummary = getFirstNonEmptyString(
    row.summary,
    metadata.summary,
    metadata.description,
  );

  if (resolvedSummary) {
    metadata.summary = metadata.summary || resolvedSummary;
    metadata.description = metadata.description || resolvedSummary;
  }

  return {
    documentId: row.document_id,
    chunkId: row.id,
    chunkIndex: row.chunk_index,
    text: row.snippet || row.chunk_text,
    filename: row.filename,
    documentTitle: resolvedTitle || row.filename,
    summary: resolvedSummary || null,
    version: row.version || metadata.version || null,
    score: Number(row.rank || 0),
    metadata,
  };
}

async function handleTest(sql, userId) {
  await ensureRagSchema(sql);
  await sql`SELECT 1`;
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Neon RAG service reachable',
      userId,
    }),
  };
}

async function handleList(sql, userId) {
  await ensureRagSchema(sql);
  const rows = await sql`
    SELECT d.id,
           d.filename,
           d.original_filename,
           d.file_type,
           d.file_size,
           d.metadata,
           d.title,
           d.summary,
           d.version,
           d.created_at,
           d.updated_at,
           COUNT(c.id)::int AS chunk_count
      FROM rag_documents d
      LEFT JOIN rag_document_chunks c ON c.document_id = d.id
     WHERE d.user_id = ${userId}
     GROUP BY d.id
     ORDER BY d.created_at DESC
  `;

  return {
    statusCode: 200,
    body: JSON.stringify({
      documents: rows.map(normalizeDocumentRow),
    }),
  };
}

async function handleDelete(sql, userId, payload = {}) {
  await ensureRagSchema(sql);
  const documentId = payload.documentId;

  if (documentId == null) {
    const error = new Error('documentId is required');
    error.statusCode = 400;
    throw error;
  }

  const result = await sql`
    DELETE FROM rag_documents
     WHERE id = ${documentId} AND user_id = ${userId}
     RETURNING id
  `;

  if (result.length === 0) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Document not found' }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, documentId }),
  };
}

async function handleUpload(sql, userId, payload = {}) {
  await ensureRagSchema(sql);

  const document = payload.document || {};
  const filename = typeof document.filename === 'string' ? document.filename.trim() : '';
  const text = typeof document.text === 'string' ? sanitizeTextForPostgres(document.text) : '';
  const mimeType = [
    document.mimeType,
    document.type,
    document.fileType,
    document.contentType,
  ].find(value => typeof value === 'string' && value.trim());

  if (!filename) {
    const error = new Error('Document filename is required');
    error.statusCode = 400;
    throw error;
  }

  if (!text) {
    const error = new Error('Document text is required');
    error.statusCode = 400;
    throw error;
  }

  if (text.length > MAX_TEXT_LENGTH) {
    const error = new Error('Document text exceeds maximum length');
    error.statusCode = 413;
    throw error;
  }

  const metadata = parseMetadata(document.metadata);
  metadata.processingMode = 'neon-postgresql';
  if (mimeType) {
    metadata.mimeType = mimeType;
  }

  metadata.fileName = metadata.fileName || filename;

  const normalizedOriginalFilename = getFirstNonEmptyString(
    document.originalFilename,
    metadata.originalFilename,
    metadata.fileName,
    filename,
  );

  if (normalizedOriginalFilename) {
    metadata.originalFilename = metadata.originalFilename || normalizedOriginalFilename;
  }

  const normalizedTitle = getFirstNonEmptyString(
    document.title,
    metadata.title,
    metadata.fileTitle,
    metadata.documentTitle,
    metadata.displayTitle,
    filename,
  );

  const normalizedSummary = getFirstNonEmptyString(
    document.summary,
    metadata.summary,
    metadata.description,
  );

  const normalizedVersion = getFirstNonEmptyString(
    document.version,
    metadata.version,
  );

  if (normalizedTitle) {
    metadata.title = metadata.title || normalizedTitle;
    metadata.fileTitle = metadata.fileTitle || normalizedTitle;
    metadata.documentTitle = metadata.documentTitle || normalizedTitle;
    metadata.displayTitle = metadata.displayTitle || normalizedTitle;
  }

  if (normalizedSummary) {
    metadata.summary = metadata.summary || normalizedSummary;
    metadata.description = metadata.description || normalizedSummary;
  }

  if (normalizedVersion) {
    metadata.version = metadata.version || normalizedVersion;
  }

  const metadataJson = JSON.stringify(metadata);

  const chunkSize = Number.isFinite(document.chunkSize) ? document.chunkSize : DEFAULT_CHUNK_SIZE;
  const chunks = chunkText(text, chunkSize);
  const allowedDocumentTypes = await getDocumentTypeOptions(sql);
  const normalizedDocumentType = normalizeDocumentTypeValue({
    mimeType,
    filename,
    allowedTypes: allowedDocumentTypes,
  });

  let insertedDocument;
  try {
    const [row] = await sql`
      INSERT INTO rag_documents (
        user_id,
        filename,
        original_filename,
        file_type,
        file_size,
        text_content,
        metadata,
        title,
        summary,
        version
      ) VALUES (
        ${userId},
        ${filename},
        ${normalizedOriginalFilename || filename},
        ${normalizedDocumentType},
        ${Number.isFinite(document.size) ? Number(document.size) : null},
        ${text},
        ${metadataJson}::jsonb,
        ${normalizedTitle || null},
        ${normalizedSummary || null},
        ${normalizedVersion || null}
      )
      RETURNING id,
                filename,
                original_filename,
                file_type,
                file_size,
                metadata,
                title,
                summary,
                version,
                created_at,
                updated_at
    `;

    insertedDocument = row;

    for (const chunk of chunks) {
      await sql`
        INSERT INTO rag_document_chunks (
          document_id,
          chunk_index,
          chunk_text,
          word_count,
          character_count
        ) VALUES (
          ${row.id},
          ${chunk.index},
          ${chunk.text},
          ${chunk.wordCount},
          ${chunk.characterCount}
        )
      `;
    }
  } catch (error) {
    if (insertedDocument?.id) {
      await sql`
        DELETE FROM rag_documents WHERE id = ${insertedDocument.id}
      `;
    }
    throw error;
  }

  const responseDocument = normalizeDocumentRow({
    ...insertedDocument,
    chunk_count: chunks.length,
  });

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Document stored',
      document: responseDocument,
      chunks: chunks.length,
    }),
  };
}

async function handleSearch(sql, userId, payload = {}) {
  await ensureRagSchema(sql);
  const query = typeof payload.query === 'string' ? payload.query.trim() : '';

  if (!query) {
    const error = new Error('Search query is required');
    error.statusCode = 400;
    throw error;
  }

  const limit = Math.max(1, Math.min(Number(payload.options?.limit) || 10, 50));

  const rows = await sql`
    SELECT c.id,
           c.document_id,
           c.chunk_index,
           c.chunk_text,
           d.filename,
           d.metadata,
           d.title,
           d.summary,
           d.version,
           ts_rank_cd(
             to_tsvector('english', c.chunk_text),
             plainto_tsquery('english', ${query})
           ) AS rank,
            ts_headline(
             'english',
             c.chunk_text,
             plainto_tsquery('english', ${query}),
             'MaxWords=40, MinWords=20, ShortWord=3, HighlightAll=TRUE'
           ) AS snippet
      FROM rag_document_chunks c
      JOIN rag_documents d ON d.id = c.document_id
     WHERE d.user_id = ${userId}
       AND to_tsvector('english', c.chunk_text) @@ plainto_tsquery('english', ${query})
     ORDER BY rank DESC NULLS LAST, c.created_at DESC
     LIMIT ${limit}
  `;

  const results = rows.map(buildSearchResult);

  return {
    statusCode: 200,
    body: JSON.stringify({
      query,
      results,
    }),
  };
}

async function handleStats(sql, userId) {
  await ensureRagSchema(sql);

  const [documentStats] = await sql`
    SELECT COUNT(*)::int AS total_documents,
           COALESCE(SUM(file_size), 0)::bigint AS total_size
      FROM rag_documents
     WHERE user_id = ${userId}
  `;

  const [chunkStats] = await sql`
    SELECT COUNT(*)::int AS total_chunks
      FROM rag_document_chunks c
      JOIN rag_documents d ON d.id = c.document_id
     WHERE d.user_id = ${userId}
  `;

  return {
    statusCode: 200,
    body: JSON.stringify({
      totalDocuments: Number(documentStats?.total_documents || 0),
      totalChunks: Number(chunkStats?.total_chunks || 0),
      totalSize: Number(documentStats?.total_size || 0),
      storage: 'neon-postgresql',
    }),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: JSON.stringify({ message: 'ok' }) };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  let requestBody = {};
  try {
    requestBody = JSON.parse(event.body || '{}');
  } catch (error) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON payload' }),
    };
  }

  let userId;
  try {
    userId = requireUserId(event);
  } catch (error) {
    return {
      statusCode: error.statusCode || 401,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }

  const action = requestBody.action;
  if (!action) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Action is required' }),
    };
  }

  let sql;
  try {
    sql = await getSqlClient();
  } catch (error) {
    const statusCode = error.statusCode || 500;
    console.error('Failed to initialize Neon client', error);
    return {
      statusCode,
      headers,
      body: JSON.stringify({ error: error.message || 'Failed to initialize Neon client' }),
    };
  }

  try {
    switch (action) {
      case 'test':
        return { ...(await handleTest(sql, userId)), headers };
      case 'list':
        return { ...(await handleList(sql, userId)), headers };
      case 'upload':
        return { ...(await handleUpload(sql, userId, requestBody)), headers };
      case 'delete':
        return { ...(await handleDelete(sql, userId, requestBody)), headers };
      case 'search':
        return { ...(await handleSearch(sql, userId, requestBody)), headers };
      case 'stats':
        return { ...(await handleStats(sql, userId)), headers };
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Unknown action: ${action}` }),
        };
    }
  } catch (error) {
    const statusCode = error.statusCode || 500;
    console.error(`Neon RAG action "${action}" failed`, error);
    return {
      statusCode,
      headers,
      body: JSON.stringify({
        error: error.message || 'Unexpected server error',
      }),
    };
  }
};
