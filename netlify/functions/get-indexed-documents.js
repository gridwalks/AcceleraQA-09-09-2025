import { neon } from '@neondatabase/serverless';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

// Initialize Neon connection
const getDatabaseConnection = () => {
  const connectionString = process.env.NEON_DATABASE_URL;
  if (!connectionString) {
    throw new Error('NEON_DATABASE_URL environment variable is not set');
  }
  return neon(connectionString);
};

// Extract user ID from request
const extractUserId = (event, context) => {
  if (event.headers['x-user-id']) {
    return event.headers['x-user-id'];
  }
  if (event.headers['X-User-ID']) {
    return event.headers['X-User-ID'];
  }
  if (context.clientContext?.user?.sub) {
    return context.clientContext.user.sub;
  }
  if (process.env.NODE_ENV === 'development' || process.env.NETLIFY_DEV === 'true') {
    return 'dev-user-' + Date.now();
  }
  return null;
};

// Get indexed documents with search and filter
async function getIndexedDocuments(sql, userId, options = {}) {
  const {
    search = '',
    documentType = '',
    status = '',
    hasManualSummary = null,
    limit = 50,
    offset = 0,
    sortBy = 'created_at',
    sortOrder = 'desc'
  } = options;

  let query = `
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
           COUNT(c.id)::int AS chunk_count,
           CASE 
             WHEN d.metadata->>'manualSummary' IS NOT NULL 
             THEN d.metadata->>'manualSummary'
             ELSE d.summary
           END AS display_summary
    FROM rag_documents d
    LEFT JOIN rag_document_chunks c ON c.document_id = d.id
    WHERE d.user_id = $1
  `;

  const params = [userId];
  let paramIndex = 2;

  // Add search filter
  if (search.trim()) {
    query += ` AND (
      d.title ILIKE $${paramIndex} OR 
      d.filename ILIKE $${paramIndex} OR 
      d.summary ILIKE $${paramIndex} OR
      d.metadata->>'manualSummary' ILIKE $${paramIndex}
    )`;
    params.push(`%${search.trim()}%`);
    paramIndex++;
  }

  // Add document type filter
  if (documentType.trim()) {
    query += ` AND d.file_type = $${paramIndex}`;
    params.push(documentType.trim());
    paramIndex++;
  }

  // Add status filter
  if (status.trim()) {
    query += ` AND d.metadata->>'status' = $${paramIndex}`;
    params.push(status.trim());
    paramIndex++;
  }

  // Add manual summary filter
  if (hasManualSummary !== null) {
    if (hasManualSummary) {
      query += ` AND d.metadata->>'manualSummary' IS NOT NULL`;
    } else {
      query += ` AND d.metadata->>'manualSummary' IS NULL`;
    }
  }

  // Group by document
  query += ` GROUP BY d.id`;

  // Add sorting
  const validSortFields = ['created_at', 'updated_at', 'title', 'filename'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
  const sortDirection = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  query += ` ORDER BY d.${sortField} ${sortDirection}`;

  // Add pagination
  query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);

  const rows = await sql.unsafe(query, params);

  // Get total count for pagination
  let countQuery = `
    SELECT COUNT(*) as total
    FROM rag_documents d
    WHERE d.user_id = $1
  `;
  const countParams = [userId];
  let countParamIndex = 2;

  if (search.trim()) {
    countQuery += ` AND (
      d.title ILIKE $${countParamIndex} OR 
      d.filename ILIKE $${countParamIndex} OR 
      d.summary ILIKE $${countParamIndex} OR
      d.metadata->>'manualSummary' ILIKE $${countParamIndex}
    )`;
    countParams.push(`%${search.trim()}%`);
    countParamIndex++;
  }

  if (documentType.trim()) {
    countQuery += ` AND d.file_type = $${countParamIndex}`;
    countParams.push(documentType.trim());
    countParamIndex++;
  }

  if (status.trim()) {
    countQuery += ` AND d.metadata->>'status' = $${countParamIndex}`;
    countParams.push(status.trim());
    countParamIndex++;
  }

  if (hasManualSummary !== null) {
    if (hasManualSummary) {
      countQuery += ` AND d.metadata->>'manualSummary' IS NOT NULL`;
    } else {
      countQuery += ` AND d.metadata->>'manualSummary' IS NULL`;
    }
  }

  const [countResult] = await sql.unsafe(countQuery, countParams);
  const total = parseInt(countResult.total) || 0;

  return {
    documents: rows.map(row => ({
      id: row.id,
      filename: row.filename,
      originalFilename: row.original_filename,
      fileType: row.file_type,
      fileSize: row.file_size,
      title: row.title,
      summary: row.summary,
      displaySummary: row.display_summary,
      manualSummary: row.metadata?.manualSummary || row.metadata?.manual_summary,
      version: row.version,
      metadata: row.metadata,
      chunkCount: row.chunk_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      hasManualSummary: !!(row.metadata?.manualSummary || row.metadata?.manual_summary)
    })),
    total,
    limit,
    offset,
    hasMore: offset + limit < total
  };
}

// Get document types for filter dropdown
async function getDocumentTypes(sql, userId) {
  const rows = await sql`
    SELECT DISTINCT file_type, COUNT(*) as count
    FROM rag_documents
    WHERE user_id = ${userId} AND file_type IS NOT NULL
    GROUP BY file_type
    ORDER BY count DESC, file_type ASC
  `;

  return rows.map(row => ({
    type: row.file_type,
    count: parseInt(row.count)
  }));
}

// Get document statistics
async function getDocumentStats(sql, userId) {
  const [stats] = await sql`
    SELECT 
      COUNT(*) as total_documents,
      COUNT(*) FILTER (WHERE metadata->>'manualSummary' IS NOT NULL) as documents_with_manual_summary,
      COUNT(*) FILTER (WHERE metadata->>'manualSummary' IS NULL AND summary IS NOT NULL) as documents_with_ai_summary,
      COUNT(*) FILTER (WHERE metadata->>'manualSummary' IS NULL AND summary IS NULL) as documents_without_summary,
      SUM(file_size) as total_size,
      AVG(file_size) as avg_size
    FROM rag_documents
    WHERE user_id = ${userId}
  `;

  const [chunkStats] = await sql`
    SELECT COUNT(*) as total_chunks
    FROM rag_document_chunks c
    JOIN rag_documents d ON d.id = c.document_id
    WHERE d.user_id = ${userId}
  `;

  return {
    totalDocuments: parseInt(stats.total_documents) || 0,
    documentsWithManualSummary: parseInt(stats.documents_with_manual_summary) || 0,
    documentsWithAISummary: parseInt(stats.documents_with_ai_summary) || 0,
    documentsWithoutSummary: parseInt(stats.documents_without_summary) || 0,
    totalChunks: parseInt(chunkStats.total_chunks) || 0,
    totalSize: parseInt(stats.total_size) || 0,
    avgSize: parseFloat(stats.avg_size) || 0
  };
}

export const handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'CORS preflight' }),
    };
  }

  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    // Extract user ID
    const userId = extractUserId(event, context);
    if (!userId) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          error: 'User authentication required',
          message: 'No user ID could be extracted from the request'
        }),
      };
    }

    // Initialize database connection
    const sql = getDatabaseConnection();

    // Parse query parameters or request body
    let options = {};
    
    if (event.httpMethod === 'GET') {
      // Parse query parameters
      const queryParams = new URLSearchParams(event.queryStringParameters || {});
      options = {
        search: queryParams.get('search') || '',
        documentType: queryParams.get('documentType') || '',
        status: queryParams.get('status') || '',
        hasManualSummary: queryParams.get('hasManualSummary') === 'true' ? true : 
                          queryParams.get('hasManualSummary') === 'false' ? false : null,
        limit: parseInt(queryParams.get('limit')) || 50,
        offset: parseInt(queryParams.get('offset')) || 0,
        sortBy: queryParams.get('sortBy') || 'created_at',
        sortOrder: queryParams.get('sortOrder') || 'desc'
      };
    } else {
      // Parse request body
      try {
        const requestData = JSON.parse(event.body || '{}');
        options = requestData.options || {};
      } catch (parseError) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid JSON in request body' }),
        };
      }
    }

    // Get the requested data
    const action = event.queryStringParameters?.action || 'list';
    
    switch (action) {
      case 'list':
        const result = await getIndexedDocuments(sql, userId, options);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(result),
        };

      case 'types':
        const documentTypes = await getDocumentTypes(sql, userId);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ documentTypes }),
        };

      case 'stats':
        const stats = await getDocumentStats(sql, userId);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ stats }),
        };

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Invalid action: ${action}` }),
        };
    }

  } catch (error) {
    console.error('Get indexed documents error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message
      }),
    };
  }
};
