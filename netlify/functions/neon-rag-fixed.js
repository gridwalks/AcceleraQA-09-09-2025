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

async function getSqlClient() {
  if (!process.env.NEON_DATABASE_URL) {
    const error = new Error('NEON_DATABASE_URL environment variable is not set');
    error.statusCode = 500;
    throw error;
  }

  if (!sqlClientPromise) {
    sqlClientPromise = (async () => {
      const { neon, neonConfig } = await import('@neondatabase/serverless');
      neonConfig.fetchConnectionCache = true;
      neonConfig.poolQueryViaFetch = true;
      return neon(process.env.NEON_DATABASE_URL);
    })();
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
  })().catch(error => {
    ensuredSchemaPromise = null;
    throw error;
  });

  return ensuredSchemaPromise;
}

function requireUserId(event) {
  const userId = event.headers?.['x-user-id'];
  if (!userId || typeof userId !== 'string') {
    const error = new Error('Missing x-user-id header');
    error.statusCode = 401;
    throw error;
  }
  return userId;
}

function chunkText(text, chunkSize = DEFAULT_CHUNK_SIZE) {
  if (typeof text !== 'string') {
    return [];
  }

  const normalizedSize = Math.max(200, Math.min(chunkSize, 2000));
  const chunks = [];
  let index = 0;

  for (let offset = 0; offset < text.length; offset += normalizedSize) {
    const chunkTextValue = text.slice(offset, offset + normalizedSize);
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

  return {
    id: row.id,
    filename: row.filename,
    originalFilename: row.original_filename || null,
    fileType: row.file_type || null,
    fileSize: row.file_size != null ? Number(row.file_size) : null,
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

  return {
    documentId: row.document_id,
    chunkId: row.id,
    chunkIndex: row.chunk_index,
    text: row.snippet || row.chunk_text,
    filename: row.filename,
    documentTitle: metadata.title || metadata.documentTitle || row.filename,
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
  const text = typeof document.text === 'string' ? document.text : '';

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
  const metadataJson = JSON.stringify(metadata);

  const chunkSize = Number.isFinite(document.chunkSize) ? document.chunkSize : DEFAULT_CHUNK_SIZE;
  const chunks = chunkText(text, chunkSize);

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
        metadata
      ) VALUES (
        ${userId},
        ${filename},
        ${document.originalFilename || null},
        ${document.type || document.fileType || null},
        ${Number.isFinite(document.size) ? Number(document.size) : null},
        ${text},
        ${metadataJson}::jsonb
      )
      RETURNING id,
                filename,
                original_filename,
                file_type,
                file_size,
                metadata,
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

exports.handler = async (event) => {
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
