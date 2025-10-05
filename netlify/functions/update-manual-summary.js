import { neon } from '@neondatabase/serverless';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

// Update manual summary for a document
async function updateManualSummary(sql, userId, documentId, manualSummary) {
  // First, verify the document exists and belongs to the user
  const [existingDoc] = await sql`
    SELECT id, filename, title, metadata
    FROM rag_documents
    WHERE id = ${documentId} AND user_id = ${userId}
  `;

  if (!existingDoc) {
    throw new Error('Document not found or access denied');
  }

  // Update the document with the new manual summary
  const [updatedDoc] = await sql`
    UPDATE rag_documents
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{manualSummary}',
      ${JSON.stringify(manualSummary)}
    ),
    updated_at = CURRENT_TIMESTAMP
    WHERE id = ${documentId} AND user_id = ${userId}
    RETURNING id, filename, title, summary, metadata, updated_at
  `;

  return {
    id: updatedDoc.id,
    filename: updatedDoc.filename,
    title: updatedDoc.title,
    summary: updatedDoc.summary,
    manualSummary: updatedDoc.metadata?.manualSummary,
    updatedAt: updatedDoc.updated_at
  };
}

// Get manual summary for a document
async function getManualSummary(sql, userId, documentId) {
  const [doc] = await sql`
    SELECT id, filename, title, summary, metadata
    FROM rag_documents
    WHERE id = ${documentId} AND user_id = ${userId}
  `;

  if (!doc) {
    throw new Error('Document not found or access denied');
  }

  return {
    id: doc.id,
    filename: doc.filename,
    title: doc.title,
    summary: doc.summary,
    manualSummary: doc.metadata?.manualSummary || doc.metadata?.manual_summary
  };
}

// Delete manual summary for a document
async function deleteManualSummary(sql, userId, documentId) {
  // First, verify the document exists and belongs to the user
  const [existingDoc] = await sql`
    SELECT id, filename, title, metadata
    FROM rag_documents
    WHERE id = ${documentId} AND user_id = ${userId}
  `;

  if (!existingDoc) {
    throw new Error('Document not found or access denied');
  }

  // Remove the manual summary from metadata
  const [updatedDoc] = await sql`
    UPDATE rag_documents
    SET metadata = metadata - 'manualSummary' - 'manual_summary',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${documentId} AND user_id = ${userId}
    RETURNING id, filename, title, summary, metadata, updated_at
  `;

  return {
    id: updatedDoc.id,
    filename: updatedDoc.filename,
    title: updatedDoc.title,
    summary: updatedDoc.summary,
    manualSummary: null,
    updatedAt: updatedDoc.updated_at
  };
}

// Bulk update manual summaries
async function bulkUpdateManualSummaries(sql, userId, updates) {
  const results = [];
  const errors = [];

  for (const update of updates) {
    try {
      const { documentId, manualSummary } = update;
      
      if (!documentId) {
        errors.push({
          documentId: 'unknown',
          error: 'Document ID is required'
        });
        continue;
      }

      const result = await updateManualSummary(sql, userId, documentId, manualSummary);
      results.push(result);
    } catch (error) {
      errors.push({
        documentId: update.documentId || 'unknown',
        error: error.message
      });
    }
  }

  return { results, errors };
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

  if (event.httpMethod !== 'POST') {
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

    // Parse request body
    let requestData;
    try {
      requestData = JSON.parse(event.body || '{}');
    } catch (parseError) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid JSON in request body' }),
      };
    }

    const { action, documentId, manualSummary, updates } = requestData;

    if (!action) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Action is required' }),
      };
    }

    // Initialize database connection
    const sql = getDatabaseConnection();

    switch (action) {
      case 'update':
        if (!documentId || manualSummary === undefined) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Document ID and manual summary are required' }),
          };
        }

        const updatedDocument = await updateManualSummary(sql, userId, documentId, manualSummary);
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            document: updatedDocument,
            message: 'Manual summary updated successfully'
          }),
        };

      case 'get':
        if (!documentId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Document ID is required' }),
          };
        }

        const document = await getManualSummary(sql, userId, documentId);
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            document,
            message: 'Manual summary retrieved successfully'
          }),
        };

      case 'delete':
        if (!documentId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Document ID is required' }),
          };
        }

        const deletedDocument = await deleteManualSummary(sql, userId, documentId);
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            document: deletedDocument,
            message: 'Manual summary deleted successfully'
          }),
        };

      case 'bulk_update':
        if (!Array.isArray(updates)) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Updates array is required for bulk update' }),
          };
        }

        const bulkResult = await bulkUpdateManualSummaries(sql, userId, updates);
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            results: bulkResult.results,
            errors: bulkResult.errors,
            message: `Updated ${bulkResult.results.length} documents successfully${bulkResult.errors.length > 0 ? `, ${bulkResult.errors.length} failed` : ''}`
          }),
        };

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Invalid action: ${action}` }),
        };
    }

  } catch (error) {
    console.error('Manual summary update error:', error);
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
