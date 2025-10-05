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
           d.document_id,
           d.document_number,
           d.document_name,
           d.major_version,
           d.minor_version,
           d.document_type,
           d.status,
           d.summary,
           d.manual_summary,
           d.filename,
           d.original_filename,
           d.file_type,
           d.file_size,
           d.metadata,
           d.title,
           d.version,
           d.created_at,
           d.updated_at,
           CASE 
             WHEN d.manual_summary IS NOT NULL 
             THEN d.manual_summary
             ELSE d.summary
           END AS display_summary,
           CASE 
             WHEN d.manual_summary IS NOT NULL 
             THEN true
             ELSE false
           END AS has_manual_summary
    FROM document_index d
    WHERE d.user_id = $1
  `;

  const params = [userId];
  let paramIndex = 2;

  // Add search filter
  if (search.trim()) {
    query += ` AND (
      d.document_name ILIKE $${paramIndex} OR 
      d.filename ILIKE $${paramIndex} OR 
      d.document_number ILIKE $${paramIndex} OR
      d.summary ILIKE $${paramIndex} OR
      d.manual_summary ILIKE $${paramIndex}
    )`;
    params.push(`%${search.trim()}%`);
    paramIndex++;
  }

  // Add document type filter
  if (documentType.trim()) {
    query += ` AND d.document_type = $${paramIndex}`;
    params.push(documentType.trim());
    paramIndex++;
  }

  // Add status filter
  if (status.trim()) {
    query += ` AND d.status = $${paramIndex}`;
    params.push(status.trim());
    paramIndex++;
  }

  // Add manual summary filter
  if (hasManualSummary !== null) {
    if (hasManualSummary) {
      query += ` AND d.manual_summary IS NOT NULL`;
    } else {
      query += ` AND d.manual_summary IS NULL`;
    }
  }

  // Add sorting
  const validSortFields = ['created_at', 'updated_at', 'document_name', 'filename', 'document_number', 'major_version'];
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
    FROM document_index d
    WHERE d.user_id = $1
  `;
  const countParams = [userId];
  let countParamIndex = 2;

  if (search.trim()) {
    countQuery += ` AND (
      d.document_name ILIKE $${countParamIndex} OR 
      d.filename ILIKE $${countParamIndex} OR 
      d.document_number ILIKE $${countParamIndex} OR
      d.summary ILIKE $${countParamIndex} OR
      d.manual_summary ILIKE $${countParamIndex}
    )`;
    countParams.push(`%${search.trim()}%`);
    countParamIndex++;
  }

  if (documentType.trim()) {
    countQuery += ` AND d.document_type = $${countParamIndex}`;
    countParams.push(documentType.trim());
    countParamIndex++;
  }

  if (status.trim()) {
    countQuery += ` AND d.status = $${countParamIndex}`;
    countParams.push(status.trim());
    countParamIndex++;
  }

  if (hasManualSummary !== null) {
    if (hasManualSummary) {
      countQuery += ` AND d.manual_summary IS NOT NULL`;
    } else {
      countQuery += ` AND d.manual_summary IS NULL`;
    }
  }

  const [countResult] = await sql.unsafe(countQuery, countParams);
  const total = parseInt(countResult.total) || 0;

  return {
    documents: rows.map(row => ({
      id: row.id,
      documentId: row.document_id,
      documentNumber: row.document_number,
      documentName: row.document_name,
      majorVersion: row.major_version,
      minorVersion: row.minor_version,
      documentType: row.document_type,
      status: row.status,
      filename: row.filename,
      originalFilename: row.original_filename,
      fileType: row.file_type,
      fileSize: row.file_size,
      title: row.title || row.document_name,
      summary: row.summary,
      displaySummary: row.display_summary,
      manualSummary: row.manual_summary,
      version: row.version,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      hasManualSummary: row.has_manual_summary
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
    SELECT DISTINCT document_type, COUNT(*) as count
    FROM document_index
    WHERE user_id = ${userId} AND document_type IS NOT NULL
    GROUP BY document_type
    ORDER BY count DESC, document_type ASC
  `;

  return rows.map(row => ({
    type: row.document_type,
    count: parseInt(row.count)
  }));
}

// Get document statistics
async function getDocumentStats(sql, userId) {
  const [stats] = await sql`
    SELECT 
      COUNT(*) as total_documents,
      COUNT(*) FILTER (WHERE manual_summary IS NOT NULL) as documents_with_manual_summary,
      COUNT(*) FILTER (WHERE manual_summary IS NULL AND summary IS NOT NULL) as documents_with_ai_summary,
      COUNT(*) FILTER (WHERE manual_summary IS NULL AND summary IS NULL) as documents_without_summary,
      SUM(file_size) as total_size,
      AVG(file_size) as avg_size
    FROM document_index
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
  console.log('get-indexed-documents handler called:', {
    method: event.httpMethod,
    queryParams: event.queryStringParameters,
    headers: event.headers,
    hasBody: !!event.body
  });

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
    console.log('Extracted user ID:', userId);
    
    if (!userId) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          error: 'User authentication required',
          message: 'No user ID could be extracted from the request',
          debug: {
            headers: event.headers,
            context: context.clientContext
          }
        }),
      };
    }

    // Initialize database connection
    console.log('Initializing database connection...');
    const sql = getDatabaseConnection();
    console.log('Database connection initialized successfully');

    // Ensure document_index table exists
    try {
      console.log('Checking if document_index table exists...');
      const tableExists = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'document_index'
        ) as exists
      `;
      
      if (!tableExists[0].exists) {
        console.log('document_index table does not exist, creating it...');
        await sql`
          CREATE TABLE IF NOT EXISTS document_index (
            id SERIAL PRIMARY KEY,
            document_id VARCHAR(255) UNIQUE NOT NULL,
            document_number VARCHAR(255) NOT NULL,
            document_name TEXT NOT NULL,
            major_version INTEGER NOT NULL,
            minor_version INTEGER NOT NULL,
            document_type VARCHAR(255),
            status VARCHAR(100),
            summary TEXT,
            manual_summary TEXT,
            indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            user_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            original_filename TEXT,
            file_type TEXT,
            file_size BIGINT,
            text_content TEXT,
            metadata JSONB DEFAULT '{}'::jsonb,
            title TEXT,
            version TEXT,
            uploaded_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `;
        
        // Create indexes
        await sql`CREATE INDEX IF NOT EXISTS idx_document_index_user_id ON document_index(user_id)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_document_index_document_id ON document_index(document_id)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_document_index_document_number ON document_index(document_number)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_document_index_document_type ON document_index(document_type)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_document_index_status ON document_index(status)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_document_index_created_at ON document_index(created_at)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_document_index_text_search ON document_index USING gin(to_tsvector('english', document_name || ' ' || COALESCE(summary, '') || ' ' || COALESCE(manual_summary, '')))`;
        
        console.log('document_index table and indexes created successfully');
      } else {
        console.log('document_index table exists');
      }
    } catch (schemaError) {
      console.error('Error checking/creating document_index table:', schemaError);
      // Continue anyway, the error might be in the actual query
    }

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
    console.log('Processing action:', action, 'with options:', options);
    
    switch (action) {
      case 'list':
        console.log('Getting indexed documents...');
        const result = await getIndexedDocuments(sql, userId, options);
        console.log('Retrieved documents:', result.documents.length, 'total:', result.total);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(result),
        };

      case 'types':
        console.log('Getting document types...');
        const documentTypes = await getDocumentTypes(sql, userId);
        console.log('Retrieved document types:', documentTypes.length);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ documentTypes }),
        };

      case 'stats':
        console.log('Getting document stats...');
        const stats = await getDocumentStats(sql, userId);
        console.log('Retrieved stats:', stats);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ stats }),
        };

      default:
        console.log('Invalid action:', action);
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
