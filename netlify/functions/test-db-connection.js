import { neon } from '@neondatabase/serverless';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

export const handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'CORS preflight' }),
    };
  }

  try {
    // Check environment variables
    const connectionString = process.env.NEON_DATABASE_URL;
    const hasConnectionString = !!connectionString;
    
    if (!connectionString) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Database connection not configured',
          details: {
            hasConnectionString,
            availableEnvVars: Object.keys(process.env).filter(key => 
              key.includes('DATABASE') || key.includes('NEON') || key.includes('POSTGRES')
            )
          }
        }),
      };
    }

    // Test database connection
    const sql = neon(connectionString);
    
    // Test basic connection
    const connectionTest = await sql`SELECT 1 as test`;
    
    // Check if document_index table exists
    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'document_index'
      ) as exists
    `;
    
    // Check if rag_documents table exists
    const ragTableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'rag_documents'
      ) as exists
    `;
    
    // Get table row counts
    let documentIndexCount = 0;
    let ragDocumentsCount = 0;
    
    if (tableExists[0].exists) {
      const countResult = await sql`SELECT COUNT(*) as count FROM document_index`;
      documentIndexCount = parseInt(countResult[0].count) || 0;
    }
    
    if (ragTableExists[0].exists) {
      const countResult = await sql`SELECT COUNT(*) as count FROM rag_documents`;
      ragDocumentsCount = parseInt(countResult[0].count) || 0;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        connectionTest: connectionTest[0],
        tables: {
          document_index: {
            exists: tableExists[0].exists,
            count: documentIndexCount
          },
          rag_documents: {
            exists: ragTableExists[0].exists,
            count: ragDocumentsCount
          }
        },
        environment: {
          hasConnectionString,
          nodeEnv: process.env.NODE_ENV,
          netlifyDev: process.env.NETLIFY_DEV
        }
      }),
    };

  } catch (error) {
    console.error('Database connection test error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Database connection failed',
        message: error.message,
        stack: error.stack
      }),
    };
  }
};
