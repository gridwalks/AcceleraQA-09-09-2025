import { neon } from '@neondatabase/serverless';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

// Get document file for download
async function getDocumentFile(sql, userId, documentId) {
  const [doc] = await sql`
    SELECT id, document_id, document_name, filename, original_filename, 
           file_type, file_size, text_content, metadata, title, version
    FROM document_index
    WHERE document_id = ${documentId} AND user_id = ${userId}
  `;

  if (!doc) {
    throw new Error('Document not found or access denied');
  }

  return {
    id: doc.id,
    documentId: doc.document_id,
    filename: doc.filename,
    originalFilename: doc.original_filename,
    fileType: doc.file_type,
    fileSize: doc.file_size,
    textContent: doc.text_content,
    metadata: doc.metadata,
    title: doc.title || doc.document_name,
    version: doc.version
  };
}

// Convert text content to PDF (basic implementation)
function convertTextToPDF(text, filename) {
  // This is a basic implementation - in production, you'd want to use a proper PDF library
  const pdfContent = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
/Resources <<
/Font <<
/F1 5 0 R
>>
>>
>>
endobj

4 0 obj
<<
/Length ${text.length + 100}
>>
stream
BT
/F1 12 Tf
72 720 Td
(${filename}) Tj
0 -20 Td
(${text.substring(0, 1000).replace(/[()\\]/g, '\\$&')}) Tj
ET
endstream
endobj

5 0 obj
<<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
endobj

xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000274 00000 n 
0000000500 00000 n 
trailer
<<
/Size 6
/Root 1 0 R
>>
startxref
${600 + text.length}
%%EOF`;

  return Buffer.from(pdfContent, 'utf8');
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

  if (event.httpMethod !== 'GET') {
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

    // Get document ID from query parameters
    const { documentId, format = 'original' } = event.queryStringParameters || {};

    if (!documentId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Document ID is required' }),
      };
    }

    // Initialize database connection
    const sql = getDatabaseConnection();

    // Get document file
    const document = await getDocumentFile(sql, userId, documentId);

    // Determine content type and file content
    let contentType = 'application/octet-stream';
    let fileContent;
    let filename = document.originalFilename || document.filename;

    if (format === 'pdf' || document.fileType === 'text') {
      // Convert to PDF
      contentType = 'application/pdf';
      filename = filename.replace(/\.[^/.]+$/, '') + '.pdf';
      fileContent = convertTextToPDF(document.textContent, document.title);
    } else if (document.fileType === 'pdf') {
      // Return original PDF content (if stored as text, convert to PDF)
      contentType = 'application/pdf';
      if (document.textContent) {
        fileContent = convertTextToPDF(document.textContent, document.title);
      } else {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'PDF content not available' }),
        };
      }
    } else {
      // Return as text
      contentType = 'text/plain';
      fileContent = Buffer.from(document.textContent || '', 'utf8');
    }

    // Return file with appropriate headers
    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': fileContent.length.toString(),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
      body: fileContent.toString('base64'),
      isBase64Encoded: true,
    };

  } catch (error) {
    console.error('Download file error:', error);
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
