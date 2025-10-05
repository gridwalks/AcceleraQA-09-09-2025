import { neon } from '@neondatabase/serverless';
import OpenAI from 'openai';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

// Generate AI summary for document
async function generateDocumentSummary(text, filename) {
  try {
    const prompt = `Please provide a concise summary of the following document. Focus on the main topics, key points, and important information that would be useful for someone searching for relevant content.

Document: ${filename}
Content: ${text.substring(0, 4000)}${text.length > 4000 ? '...' : ''}

Please provide a summary that is:
- 2-3 sentences long
- Focuses on the main topics and key information
- Written in a professional tone
- Suitable for document search and discovery

Summary:`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that creates concise, informative summaries of documents for search and discovery purposes.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 200,
      temperature: 0.3
    });

    return completion.choices[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error('Error generating document summary:', error);
    return null;
  }
}

// Process and index a single document
async function processDocument(sql, userId, document) {
  const {
    filename,
    text,
    metadata = {},
    title,
    version,
    documentType,
    status
  } = document;

  if (!filename || !text) {
    throw new Error('Document filename and text are required');
  }

  // Generate AI summary
  const aiSummary = await generateDocumentSummary(text, filename);

  // Prepare document metadata
  const documentMetadata = {
    ...metadata,
    documentType: documentType || 'unknown',
    status: status || 'active',
    indexedAt: new Date().toISOString(),
    hasAISummary: !!aiSummary
  };

  // Insert document into database
  const [insertedDoc] = await sql`
    INSERT INTO rag_documents (
      user_id,
      filename,
      original_filename,
      file_type,
      text_content,
      metadata,
      title,
      summary,
      version
    ) VALUES (
      ${userId},
      ${filename},
      ${filename},
      ${documentType || 'text'},
      ${text},
      ${JSON.stringify(documentMetadata)},
      ${title || filename},
      ${aiSummary},
      ${version || '1.0'}
    )
    RETURNING id, filename, title, summary, version, created_at
  `;

  // Chunk the text for search
  const chunkSize = 800;
  const chunks = [];
  let index = 0;

  for (let offset = 0; offset < text.length; offset += chunkSize) {
    const chunkText = text.slice(offset, offset + chunkSize);
    chunks.push({
      index: index++,
      text: chunkText,
      wordCount: chunkText.split(/\s+/).filter(Boolean).length,
      characterCount: chunkText.length,
    });
  }

  // Insert chunks
  if (chunks.length > 0) {
    for (const chunk of chunks) {
      await sql`
        INSERT INTO rag_document_chunks (
          document_id,
          chunk_index,
          chunk_text,
          word_count,
          character_count
        ) VALUES (
          ${insertedDoc.id},
          ${chunk.index},
          ${chunk.text},
          ${chunk.wordCount},
          ${chunk.characterCount}
        )
      `;
    }
  }

  return {
    id: insertedDoc.id,
    filename: insertedDoc.filename,
    title: insertedDoc.title,
    summary: insertedDoc.summary,
    version: insertedDoc.version,
    createdAt: insertedDoc.created_at,
    chunkCount: chunks.length
  };
}

// Update manual summary for a document
async function updateManualSummary(sql, userId, documentId, manualSummary) {
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

  if (!updatedDoc) {
    throw new Error('Document not found or access denied');
  }

  return {
    id: updatedDoc.id,
    filename: updatedDoc.filename,
    title: updatedDoc.title,
    summary: updatedDoc.summary,
    manualSummary: updatedDoc.metadata?.manualSummary,
    updatedAt: updatedDoc.updated_at
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

    const { action, document, documentId, manualSummary } = requestData;

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
      case 'index_document':
        if (!document) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Document data is required for indexing' }),
          };
        }

        const indexedDocument = await processDocument(sql, userId, document);
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            document: indexedDocument,
            message: 'Document indexed successfully'
          }),
        };

      case 'update_manual_summary':
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

      case 'bulk_index':
        if (!Array.isArray(document.documents)) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Documents array is required for bulk indexing' }),
          };
        }

        const results = [];
        const errors = [];

        for (const doc of document.documents) {
          try {
            const result = await processDocument(sql, userId, doc);
            results.push(result);
          } catch (error) {
            errors.push({
              filename: doc.filename || 'unknown',
              error: error.message
            });
          }
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            results,
            errors,
            message: `Processed ${results.length} documents successfully${errors.length > 0 ? `, ${errors.length} failed` : ''}`
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
    console.error('Document indexing error:', error);
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
