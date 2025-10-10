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

// Initialize Groq (using OpenAI-compatible API)
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
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
  // Method 1: Direct x-user-id header (most reliable)
  if (event.headers['x-user-id']) {
    return event.headers['x-user-id'];
  }
  
  // Method 2: Case variations
  if (event.headers['X-User-ID']) {
    return event.headers['X-User-ID'];
  }
  
  // Method 3: Extract from Authorization Bearer token
  if (event.headers.authorization) {
    try {
      const authHeader = event.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '');
        const parts = token.split('.');
        
        if (parts.length === 3) {
          // Standard JWT
          let payload = parts[1];
          while (payload.length % 4) {
            payload += '=';
          }
          const decoded = Buffer.from(payload, 'base64').toString('utf8');
          const parsed = JSON.parse(decoded);
          if (parsed.sub) {
            return parsed.sub;
          }
        }
      }
    } catch (error) {
      console.warn('Failed to extract user ID from JWT:', error.message);
    }
  }
  
  // Method 4: Netlify context
  if (context.clientContext?.user?.sub) {
    return context.clientContext.user.sub;
  }
  
  // Method 5: Development fallback
  if (process.env.NODE_ENV === 'development' || process.env.NETLIFY_DEV === 'true') {
    return 'dev-user-' + Date.now();
  }
  
  return null;
};

// System prompt for AI chat
const SYSTEM_PROMPT = `You are AcceleraQA, an AI assistant specialized in pharmaceutical quality, compliance, and clinical trial integrity. You help users understand and work with documents from a document management system, with access to both AI-generated summaries and user-added manual summaries.

CORE CAPABILITIES:
- Analyze regulatory texts, laws, and SOPs with accuracy and inspection readiness
- Provide actionable insights based on document content
- Reference specific documents by name, number, and version when relevant
- Maintain professional tone appropriate for pharmaceutical/clinical environments

DOCUMENT CONTEXT RULES:
1. ALWAYS prioritize manual summaries over AI summaries when both exist
2. When manual summaries provide corrections or additional context to AI summaries, note the differences
3. Reference documents by their full identifiers (name, number, version)
4. If information isn't in the provided documents, state this clearly
5. Focus on what the documents actually say, not assumptions

RESPONSE GUIDELINES:
- Be precise and citation-focused
- Include document references in your responses
- If discussing compliance topics, focus on regulatory requirements as stated in documents
- Provide practical, actionable insights
- Maintain inspection-ready documentation standards

When answering questions:
1. Use the provided document context to give accurate, helpful answers
2. Reference specific documents by name, number, and version when relevant
3. If the answer isn't in the provided documents, say so clearly
4. Provide actionable insights based on the document content
5. Maintain a professional, helpful tone appropriate for the industry
6. If asked about processes, procedures, or compliance topics, focus on what the documents actually say
7. When both AI and manual summaries are available, consider both perspectives and note any differences
8. Prioritize manual summaries when they provide additional context or corrections to AI summaries

Always cite your sources and be specific about which documents you're referencing.`;

// Search for relevant documents
async function searchRelevantDocuments(sql, userId, query, documentIds = null) {
  const limit = 10;
  
  let searchQuery;
  let searchParams;
  
  if (documentIds && documentIds.length > 0) {
    // Search within specific documents using document_index table
    searchQuery = `
      SELECT c.id,
             c.document_id,
             c.chunk_index,
             c.chunk_text,
             di.document_id as doc_id,
             di.document_name,
             di.document_number,
             di.major_version,
             di.minor_version,
             di.document_type,
             di.status,
             di.summary,
             di.manual_summary,
             di.filename,
             di.metadata,
             di.title,
             di.version,
             ts_rank_cd(
               to_tsvector('english', c.chunk_text),
               plainto_tsquery('english', $1)
             ) AS rank,
             ts_headline(
               'english',
               c.chunk_text,
               plainto_tsquery('english', $1),
               'MaxWords=40, MinWords=20, ShortWord=3, HighlightAll=TRUE'
             ) AS snippet
        FROM rag_document_chunks c
        JOIN rag_documents d ON d.id = c.document_id
        JOIN document_index di ON di.filename = d.filename AND di.user_id = d.user_id
       WHERE di.user_id = $2
         AND di.document_id = ANY($3)
         AND to_tsvector('english', c.chunk_text) @@ plainto_tsquery('english', $1)
       ORDER BY rank DESC NULLS LAST, c.created_at DESC
       LIMIT $4
    `;
    searchParams = [query, userId, documentIds, limit];
  } else {
    // Search across all user documents
    searchQuery = `
      SELECT c.id,
             c.document_id,
             c.chunk_index,
             c.chunk_text,
             di.document_id as doc_id,
             di.document_name,
             di.document_number,
             di.major_version,
             di.minor_version,
             di.document_type,
             di.status,
             di.summary,
             di.manual_summary,
             di.filename,
             di.metadata,
             di.title,
             di.version,
             ts_rank_cd(
               to_tsvector('english', c.chunk_text),
               plainto_tsquery('english', $1)
             ) AS rank,
             ts_headline(
               'english',
               c.chunk_text,
               plainto_tsquery('english', $1),
               'MaxWords=40, MinWords=20, ShortWord=3, HighlightAll=TRUE'
             ) AS snippet
        FROM rag_document_chunks c
        JOIN rag_documents d ON d.id = c.document_id
        JOIN document_index di ON di.filename = d.filename AND di.user_id = d.user_id
       WHERE di.user_id = $2
         AND to_tsvector('english', c.chunk_text) @@ plainto_tsquery('english', $1)
       ORDER BY rank DESC NULLS LAST, c.created_at DESC
       LIMIT $3
    `;
    searchParams = [query, userId, limit];
  }
  
  const rows = await sql.unsafe(searchQuery, searchParams);
  
  // If no results from full-text search, try ILIKE search
  if (rows.length === 0) {
    const queryWords = query.toLowerCase().split(/\s+/).filter(word => word.length > 1);
    
    if (queryWords.length > 0) {
      for (const word of queryWords) {
        let fallbackQuery;
        let fallbackParams;
        
        if (documentIds && documentIds.length > 0) {
          fallbackQuery = `
            SELECT c.id,
                   c.document_id,
                   c.chunk_index,
                   c.chunk_text,
                   di.document_id as doc_id,
                   di.document_name,
                   di.document_number,
                   di.major_version,
                   di.minor_version,
                   di.document_type,
                   di.status,
                   di.summary,
                   di.manual_summary,
                   di.filename,
                   di.metadata,
                   di.title,
                   di.version,
                   1.0 AS rank,
                   c.chunk_text AS snippet
              FROM rag_document_chunks c
              JOIN rag_documents d ON d.id = c.document_id
              JOIN document_index di ON di.filename = d.filename AND di.user_id = d.user_id
             WHERE di.user_id = $1
               AND di.document_id = ANY($2)
               AND c.chunk_text ILIKE $3
             ORDER BY c.created_at DESC
             LIMIT $4
          `;
          fallbackParams = [userId, documentIds, `%${word}%`, limit];
        } else {
          fallbackQuery = `
            SELECT c.id,
                   c.document_id,
                   c.chunk_index,
                   c.chunk_text,
                   di.document_id as doc_id,
                   di.document_name,
                   di.document_number,
                   di.major_version,
                   di.minor_version,
                   di.document_type,
                   di.status,
                   di.summary,
                   di.manual_summary,
                   di.filename,
                   di.metadata,
                   di.title,
                   di.version,
                   1.0 AS rank,
                   c.chunk_text AS snippet
              FROM rag_document_chunks c
              JOIN rag_documents d ON d.id = c.document_id
              JOIN document_index di ON di.filename = d.filename AND di.user_id = d.user_id
             WHERE di.user_id = $1
               AND c.chunk_text ILIKE $2
             ORDER BY c.created_at DESC
             LIMIT $3
          `;
          fallbackParams = [userId, `%${word}%`, limit];
        }
        
        const fallbackRows = await sql.unsafe(fallbackQuery, fallbackParams);
        if (fallbackRows.length > 0) {
          return fallbackRows;
        }
      }
    }
  }
  
  return rows;
}

// Get document summaries for context
async function getDocumentSummaries(sql, userId, documentIds) {
  if (!documentIds || documentIds.length === 0) {
    return [];
  }
  
  const rows = await sql`
    SELECT id, document_id, document_name, document_number, major_version, minor_version,
           document_type, status, summary, manual_summary, filename, title, version, metadata
    FROM document_index
    WHERE user_id = ${userId}
      AND document_id = ANY(${documentIds})
  `;
  
  return rows.map(row => {
    const metadata = typeof row.metadata === 'object' ? row.metadata : {};
    return {
      id: row.id,
      documentId: row.document_id,
      filename: row.filename,
      title: row.title || row.document_name,
      documentName: row.document_name,
      documentNumber: row.document_number,
      majorVersion: row.major_version,
      minorVersion: row.minor_version,
      documentType: row.document_type,
      status: row.status,
      summary: row.summary,
      manualSummary: row.manual_summary,
      version: row.version,
      metadata
    };
  });
}

// Build context from search results and summaries
function buildDocumentContext(searchResults, documentSummaries) {
  const context = {
    searchResults: searchResults.map(result => ({
      documentId: result.doc_id || result.document_id,
      chunkIndex: result.chunk_index,
      text: result.snippet || result.chunk_text,
      filename: result.filename,
      title: result.document_name || result.title || result.filename,
      documentNumber: result.document_number,
      majorVersion: result.major_version,
      minorVersion: result.minor_version,
      documentType: result.document_type,
      status: result.status,
      rank: result.rank
    })),
    documentSummaries: documentSummaries.map(doc => ({
      id: doc.id,
      documentId: doc.documentId,
      title: doc.title,
      documentName: doc.documentName,
      documentNumber: doc.documentNumber,
      majorVersion: doc.majorVersion,
      minorVersion: doc.minorVersion,
      documentType: doc.documentType,
      status: doc.status,
      filename: doc.filename,
      summary: doc.summary,
      manualSummary: doc.manualSummary,
      version: doc.version
    }))
  };
  
  return context;
}

// Generate AI response with document context
async function generateAIResponse(message, documentContext, conversationHistory = [], provider = 'openai') {
  // Build comprehensive document context with both search results and summaries
  const contextText = documentContext.searchResults
    .map(result => {
      let docInfo = `Document: ${result.title} (ID: ${result.documentId})`;
      if (result.documentNumber) docInfo += ` - Document Number: ${result.documentNumber}`;
      if (result.majorVersion && result.minorVersion) docInfo += ` - Version: ${result.majorVersion}.${result.minorVersion}`;
      if (result.documentType) docInfo += ` - Type: ${result.documentType}`;
      if (result.status) docInfo += ` - Status: ${result.status}`;
      docInfo += `\nContent: ${result.text}`;
      return docInfo;
    })
    .join('\n\n');
  
  const summariesText = documentContext.documentSummaries
    .map(doc => {
      let summaryText = `Document: ${doc.title} (ID: ${doc.documentId})`;
      if (doc.documentNumber) summaryText += ` - Document Number: ${doc.documentNumber}`;
      if (doc.majorVersion && doc.minorVersion) summaryText += ` - Version: ${doc.majorVersion}.${doc.minorVersion}`;
      if (doc.documentType) summaryText += ` - Type: ${doc.documentType}`;
      if (doc.status) summaryText += ` - Status: ${doc.status}`;
      
      // Prioritize manual summary over AI summary
      if (doc.manualSummary) {
        summaryText += `\nManual Summary: ${doc.manualSummary}`;
        if (doc.summary && doc.summary !== doc.manualSummary) {
          summaryText += `\nAI Summary (for reference): ${doc.summary}`;
        }
      } else if (doc.summary) {
        summaryText += `\nAI Summary: ${doc.summary}`;
      } else {
        summaryText += `\nNo summary available`;
      }
      return summaryText;
    })
    .join('\n\n');
  
  const contextPrompt = contextText || summariesText;
  
  if (!contextPrompt) {
    return {
      response: "I don't have access to any relevant documents to answer your question. Please upload some documents first or try a different question.",
      documentsUsed: [],
      sources: []
    };
  }
  
  // Build conversation history for context
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversationHistory.slice(-10), // Keep last 10 messages for context
    {
      role: 'user',
      content: `Context from documents:\n\n${contextPrompt}\n\nUser question: ${message}`
    }
  ];
  
  try {
    // Select the appropriate AI provider
    const aiClient = provider === 'groq' ? groq : openai;
    const model = provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4';
    
    const completion = await aiClient.chat.completions.create({
      model,
      messages,
      max_tokens: 1000,
      temperature: 0.7
    });
    
    const response = completion.choices[0]?.message?.content || 'I apologize, but I was unable to generate a response.';
    
    // Extract document references from the response
    const documentsUsed = [...new Set(documentContext.searchResults.map(r => r.documentId))];
    
    // Create sources for the response
    const sources = documentContext.searchResults.slice(0, 5).map((result, index) => ({
      documentId: result.documentId,
      filename: result.filename,
      title: result.title,
      documentNumber: result.documentNumber,
      majorVersion: result.majorVersion,
      minorVersion: result.minorVersion,
      documentType: result.documentType,
      status: result.status,
      text: result.text,
      chunkIndex: result.chunkIndex,
      rank: result.rank
    }));
    
    return {
      response,
      documentsUsed,
      sources
    };
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw new Error('Failed to generate AI response');
  }
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

    const { message, documentIds, conversationHistory = [], provider = 'openai' } = requestData;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Message is required' }),
      };
    }

    // Initialize database connection
    const sql = getDatabaseConnection();

    // Search for relevant documents
    const searchResults = await searchRelevantDocuments(sql, userId, message.trim(), documentIds);
    
    // Get document summaries for additional context
    const documentIdsFromSearch = [...new Set(searchResults.map(r => r.document_id))];
    const documentSummaries = await getDocumentSummaries(sql, userId, documentIdsFromSearch);
    
    // Build document context
    const documentContext = buildDocumentContext(searchResults, documentSummaries);
    
    // Generate AI response
    const aiResponse = await generateAIResponse(message.trim(), documentContext, conversationHistory, provider);

    // Return response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        response: aiResponse.response,
        documentsUsed: aiResponse.documentsUsed,
        sources: aiResponse.sources,
        conversationHistory: [
          ...conversationHistory,
          { role: 'user', content: message.trim() },
          { role: 'assistant', content: aiResponse.response }
        ]
      }),
    };

  } catch (error) {
    console.error('Chat with documents error:', error);
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
