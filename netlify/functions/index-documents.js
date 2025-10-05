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

// Extract document number from filename
const extractDocumentNumber = (filename) => {
  // Look for patterns like DOC-001, SOP-123, PROTOCOL-456, etc.
  const match = filename.match(/([A-Z]{2,}-\d{3,})/i);
  return match ? match[1].toUpperCase() : null;
};

// Extract major version from version string
const extractMajorVersion = (version) => {
  if (!version) return 1;
  const match = version.match(/^(\d+)/);
  return match ? parseInt(match[1]) : 1;
};

// Extract minor version from version string
const extractMinorVersion = (version) => {
  if (!version) return 0;
  const match = version.match(/^\d+\.(\d+)/);
  return match ? parseInt(match[1]) : 0;
};

// Generate AI summary for document
async function generateDocumentSummary(text, filename, documentType = null) {
  try {
    const isPharmaDoc = documentType === 'sop' || documentType === 'protocol' || 
                       documentType === 'regulatory' || documentType === 'compliance' ||
                       filename.toLowerCase().includes('sop') || 
                       filename.toLowerCase().includes('protocol') ||
                       filename.toLowerCase().includes('regulatory') ||
                       filename.toLowerCase().includes('compliance');

    const systemPrompt = isPharmaDoc 
      ? 'You are a specialized assistant for pharmaceutical quality, compliance, and clinical trial documents. Create concise, inspection-ready summaries that highlight regulatory requirements, procedures, and key compliance elements.'
      : 'You are a helpful assistant that creates concise, informative summaries of documents for search and discovery purposes.';

    const prompt = `Please provide a concise summary of the following document. Focus on the main topics, key points, and important information that would be useful for someone searching for relevant content.

Document: ${filename}
${documentType ? `Type: ${documentType}` : ''}
Content: ${text.substring(0, 4000)}${text.length > 4000 ? '...' : ''}

Please provide a summary that is:
- 2-4 sentences long
- Focuses on the main topics and key information
- Written in a professional tone
- Suitable for document search and discovery
${isPharmaDoc ? '- Highlights regulatory requirements, procedures, or compliance elements when present' : ''}

Summary:`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: 250,
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

  // Generate AI summary with document type context
  const aiSummary = await generateDocumentSummary(text, filename, documentType);

  // Extract document number and version info from filename if not provided
  const docNumber = metadata.documentNumber || extractDocumentNumber(filename);
  const majorVersion = metadata.majorVersion || extractMajorVersion(version);
  const minorVersion = metadata.minorVersion || extractMinorVersion(version);

  // Generate unique document ID
  const documentId = metadata.documentId || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

  // Prepare document metadata
  const documentMetadata = {
    ...metadata,
    documentType: documentType || 'unknown',
    status: status || 'active',
    indexedAt: new Date().toISOString(),
    hasAISummary: !!aiSummary,
    documentNumber: docNumber,
    majorVersion,
    minorVersion,
    originalFilename: filename
  };

  // Insert document into both document_index and rag_documents tables
  const [insertedDoc] = await sql`
    INSERT INTO document_index (
      document_id,
      document_number,
      document_name,
      major_version,
      minor_version,
      document_type,
      status,
      summary,
      user_id,
      filename,
      original_filename,
      file_type,
      file_size,
      text_content,
      metadata,
      title,
      version,
      uploaded_by
    ) VALUES (
      ${documentId},
      ${docNumber || 'UNKNOWN'},
      ${title || filename},
      ${majorVersion},
      ${minorVersion},
      ${documentType || 'unknown'},
      ${status || 'active'},
      ${aiSummary},
      ${userId},
      ${filename},
      ${filename},
      ${documentType || 'text'},
      ${metadata.fileSize || null},
      ${text},
      ${JSON.stringify(documentMetadata)},
      ${title || filename},
      ${version || '1.0'},
      ${metadata.uploadedBy || userId}
    )
    ON CONFLICT (document_id) DO UPDATE SET
      document_name = EXCLUDED.document_name,
      major_version = EXCLUDED.major_version,
      minor_version = EXCLUDED.minor_version,
      document_type = EXCLUDED.document_type,
      status = EXCLUDED.status,
      summary = EXCLUDED.summary,
      text_content = EXCLUDED.text_content,
      metadata = EXCLUDED.metadata,
      title = EXCLUDED.title,
      version = EXCLUDED.version,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, document_id, document_name, summary, version, document_number, major_version, minor_version, document_type, status, created_at
  `;

  // Also insert into rag_documents for backward compatibility
  const [ragDoc] = await sql`
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
      version,
      document_number,
      major_version,
      minor_version,
      document_type,
      status,
      uploaded_by
    ) VALUES (
      ${userId},
      ${filename},
      ${filename},
      ${documentType || 'text'},
      ${metadata.fileSize || null},
      ${text},
      ${JSON.stringify(documentMetadata)},
      ${title || filename},
      ${aiSummary},
      ${version || '1.0'},
      ${docNumber},
      ${majorVersion},
      ${minorVersion},
      ${documentType || 'unknown'},
      ${status || 'active'},
      ${metadata.uploadedBy || userId}
    )
    ON CONFLICT (filename, user_id) DO UPDATE SET
      text_content = EXCLUDED.text_content,
      metadata = EXCLUDED.metadata,
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      version = EXCLUDED.version,
      document_number = EXCLUDED.document_number,
      major_version = EXCLUDED.major_version,
      minor_version = EXCLUDED.minor_version,
      document_type = EXCLUDED.document_type,
      status = EXCLUDED.status,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, filename, title, summary, version, document_number, major_version, minor_version, document_type, status, created_at
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

  // Insert chunks using the rag_documents ID for backward compatibility
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
          ${ragDoc.id},
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
    documentId: insertedDoc.document_id,
    filename: insertedDoc.document_name,
    title: insertedDoc.document_name,
    summary: insertedDoc.summary,
    version: insertedDoc.version,
    documentNumber: insertedDoc.document_number,
    majorVersion: insertedDoc.major_version,
    minorVersion: insertedDoc.minor_version,
    documentType: insertedDoc.document_type,
    status: insertedDoc.status,
    createdAt: insertedDoc.created_at,
    chunkCount: chunks.length,
    hasAISummary: !!insertedDoc.summary
  };
}

// Update manual summary for a document
async function updateManualSummary(sql, userId, documentId, manualSummary) {
  // Update both document_index and rag_documents tables
  const [updatedDoc] = await sql`
    UPDATE document_index
    SET manual_summary = ${manualSummary},
        updated_at = CURRENT_TIMESTAMP
    WHERE document_id = ${documentId} AND user_id = ${userId}
    RETURNING id, document_id, document_name, summary, manual_summary, updated_at
  `;

  if (!updatedDoc) {
    throw new Error('Document not found or access denied');
  }

  // Also update rag_documents for backward compatibility
  await sql`
    UPDATE rag_documents
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{manualSummary}',
      ${JSON.stringify(manualSummary)}
    ),
    updated_at = CURRENT_TIMESTAMP
    WHERE filename = (SELECT filename FROM document_index WHERE document_id = ${documentId} AND user_id = ${userId})
      AND user_id = ${userId}
  `;

  return {
    id: updatedDoc.id,
    documentId: updatedDoc.document_id,
    filename: updatedDoc.document_name,
    title: updatedDoc.document_name,
    summary: updatedDoc.summary,
    manualSummary: updatedDoc.manual_summary,
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
