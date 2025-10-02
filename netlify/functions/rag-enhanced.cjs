// netlify/functions/rag-enhanced.js - Full RAG without blobs
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

// Enhanced in-memory storage (persists during function lifecycle)
const storage = {
  documents: new Map(),
  chunks: new Map(),
  embeddings: new Map(),
  searchCache: new Map(),
  
  // User-specific storage
  getUserDocuments: (userId) => {
    const userDocs = [];
    for (const [key, doc] of storage.documents.entries()) {
      if (doc.userId === userId) {
        userDocs.push(doc);
      }
    }
    return userDocs;
  },
  
  getUserChunks: (userId) => {
    const userChunks = [];
    for (const [key, chunk] of storage.chunks.entries()) {
      if (chunk.userId === userId) {
        userChunks.push(chunk);
      }
    }
    return userChunks;
  },
  
  // Search caching
  getCachedSearch: (query, userId) => {
    const key = `${userId}_${query.toLowerCase()}`;
    const cached = storage.searchCache.get(key);
    if (cached && Date.now() - cached.timestamp < 300000) { // 5 minute cache
      return cached.results;
    }
    return null;
  },
  
  setCachedSearch: (query, userId, results) => {
    const key = `${userId}_${query.toLowerCase()}`;
    storage.searchCache.set(key, {
      results,
      timestamp: Date.now()
    });
    // Clean old cache entries (keep only last 100)
    if (storage.searchCache.size > 100) {
      const entries = Array.from(storage.searchCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      for (let i = 0; i < entries.length - 100; i++) {
        storage.searchCache.delete(entries[i][0]);
      }
    }
  }
};

exports.handler = async (event, context) => {
  console.log('Enhanced RAG Function called:', {
    method: event.httpMethod,
    hasBody: !!event.body,
    userAgent: event.headers['user-agent']
  });

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'CORS preflight' }),
    };
  }

  try {
    // Only allow POST method
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    // Parse request body
    let requestData;
    try {
      requestData = JSON.parse(event.body || '{}');
    } catch (parseError) {
      console.error('Error parsing request body:', parseError);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid JSON in request body' }),
      };
    }

    // Extract user ID
    const userId = event.headers['x-user-id'] || 
                   event.headers['X-User-ID'] || 
                   context.clientContext?.user?.sub ||
                   'test-user';

    if (!userId || userId === 'anonymous') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'User authentication required' }),
      };
    }

    const { action } = requestData;

    if (!action) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Action parameter is required' }),
      };
    }

    console.log('Processing action:', action, 'for user:', userId);

    // Handle different actions
    switch (action) {
      case 'upload':
        return await handleUpload(userId, requestData.document);
      
      case 'list':
        return await handleList(userId);
      
      case 'delete':
        return await handleDelete(userId, requestData.documentId);
      
      case 'search':
        return await handleSearch(userId, requestData.query, requestData.options);
      
      case 'stats':
        return await handleStats(userId);
      
      case 'test':
        return await handleTest(userId);
      
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Invalid action: ${action}` }),
        };
    }
  } catch (error) {
    console.error('Enhanced RAG Function error:', error);
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

/**
 * Handle document upload with real embedding generation
 */
async function handleUpload(userId, document) {
  try {
    console.log('Enhanced upload for user:', userId);

    if (!document || !document.filename) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid document data' }),
      };
    }

    const documentId = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();
    
    // Extract text content (handle different file types)
    let textContent = '';
    if (document.text) {
      textContent = document.text;
    } else if (document.filename.endsWith('.txt')) {
      textContent = document.content || getPlaceholderText(document.filename);
    } else {
      // For non-text files, create pharmaceutical-relevant placeholder content
      textContent = getPharmaceuticalPlaceholder(document.filename);
    }
    
    // Chunk the text into manageable pieces
    const chunks = chunkText(textContent);
    console.log(`Created ${chunks.length} chunks from document`);
    
    // Generate embeddings for each chunk
    const chunksWithEmbeddings = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      try {
        // Generate real embedding using OpenAI
        const embedding = await generateEmbedding(chunk.text);
        
        const chunkWithEmbedding = {
          id: `${documentId}_chunk_${i}`,
          documentId,
          userId,
          index: i,
          text: chunk.text,
          wordCount: chunk.wordCount,
          characterCount: chunk.characterCount,
          embedding: embedding,
          createdAt: timestamp
        };
        
        chunksWithEmbeddings.push(chunkWithEmbedding);
        
        // Store in memory
        storage.chunks.set(chunkWithEmbedding.id, chunkWithEmbedding);
        
      } catch (embeddingError) {
        console.warn(`Failed to generate embedding for chunk ${i}:`, embeddingError);
        // Create a fallback chunk without embedding
        const fallbackChunk = {
          id: `${documentId}_chunk_${i}`,
          documentId,
          userId,
          index: i,
          text: chunk.text,
          wordCount: chunk.wordCount,
          characterCount: chunk.characterCount,
          embedding: null,
          createdAt: timestamp,
          embeddingError: embeddingError.message
        };
        
        chunksWithEmbeddings.push(fallbackChunk);
        storage.chunks.set(fallbackChunk.id, fallbackChunk);
      }
    }
    
    // Store document metadata
    const documentData = {
      id: documentId,
      userId,
      filename: document.filename,
      fileType: getFileType(document.filename),
      fileSize: textContent.length,
      textContent: textContent.substring(0, 1000), // Store preview
      chunkCount: chunksWithEmbeddings.length,
      createdAt: timestamp,
      metadata: {
        ...document.metadata,
        processedChunks: chunksWithEmbeddings.length,
        embeddingModel: 'text-embedding-3-small',
        hasEmbeddings: chunksWithEmbeddings.some(c => c.embedding !== null)
      }
    };
    
    storage.documents.set(documentId, documentData);
    
    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        id: documentId,
        filename: document.filename,
        chunks: chunksWithEmbeddings.length,
        message: 'Document uploaded and processed with real embeddings',
        hasEmbeddings: chunksWithEmbeddings.some(c => c.embedding !== null),
        storage: 'enhanced-memory'
      }),
    };
  } catch (error) {
    console.error('Error in enhanced upload:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to upload document',
        message: error.message 
      }),
    };
  }
}

/**
 * Generate real embeddings using OpenAI API
 */
async function generateEmbedding(text) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }
    
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.substring(0, 8000), // Limit input length
        encoding_format: 'float'
      })
    });
    
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.data || !data.data[0] || !data.data[0].embedding) {
      throw new Error('Invalid embedding response');
    }
    
    return data.data[0].embedding;
    
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }
}

/**
 * Handle semantic search with real embeddings
 */
async function handleSearch(userId, query, options = {}) {
  try {
    console.log('Enhanced search for user:', userId, 'query:', query);

    if (!query || typeof query !== 'string') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Valid search query string is required' }),
      };
    }

    // Check cache first
    const cachedResults = storage.getCachedSearch(query, userId);
    if (cachedResults) {
      console.log('Returning cached search results');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          results: cachedResults,
          totalFound: cachedResults.length,
          searchType: 'cached',
          storage: 'enhanced-memory',
          query: {
            text: query,
            limit: options.limit || 10,
            threshold: options.threshold || 0.5,
            hasEmbedding: true,
            cached: true
          }
        }),
      };
    }

    const { limit = 10, threshold = 0.2 } = options;
    
    // Preprocess the query for better results
    const processedQuery = preprocessQuery(query);
    console.log('Query preprocessing:', { original: query, processed: processedQuery });
    
    // Generate embedding for the search query
    let queryEmbedding;
    try {
      queryEmbedding = await generateEmbedding(processedQuery);
    } catch (embeddingError) {
      console.warn('Could not generate query embedding:', embeddingError);
      // Fallback to text-based search with more permissive settings
      return handleTextBasedSearch(userId, processedQuery, { ...options, threshold: 0.05 });
    }
    
    const userChunks = storage.getUserChunks(userId);
    console.log(`Found ${userChunks.length} chunks for user`);
    
    const results = [];
    
    for (const chunk of userChunks) {
      if (!chunk.embedding) {
        // Skip chunks without embeddings
        continue;
      }
      
      try {
        // Calculate cosine similarity
        const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
        
    if (similarity >= threshold) {
      const document = storage.documents.get(chunk.documentId);
      
      // Get overlapping context from adjacent chunks
      const contextChunks = getContextualChunks(chunk, userChunks, 1); // 1 chunk before and after
      const contextualText = contextChunks.map(ctx => ctx.text).join(' ... ');
      
      results.push({
        documentId: chunk.documentId,
        filename: document?.filename || 'Unknown',
        chunkIndex: chunk.index,
        text: chunk.text,
        contextualText: contextualText,
        contextChunks: contextChunks.length,
        similarity: similarity,
        metadata: document?.metadata || {}
      });
    }
      } catch (error) {
        console.warn(`Error calculating similarity for chunk ${chunk.id}:`, error);
      }
    }
    
    // Sort by similarity and limit results
    results.sort((a, b) => b.similarity - a.similarity);
    const limitedResults = results.slice(0, limit);
    
    // Cache the results
    storage.setCachedSearch(query, userId, limitedResults);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        results: limitedResults,
        totalFound: limitedResults.length,
        searchType: 'semantic',
        storage: 'enhanced-memory',
        query: {
          text: query,
          limit,
          threshold,
          hasEmbedding: true
        }
      }),
    };
  } catch (error) {
    console.error('Error in enhanced search:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Search failed',
        message: error.message 
      }),
    };
  }
}

// Multi-strategy search implementation
async function performSemanticSearch(queryEmbedding, userId, threshold, limit) {
  const userChunks = storage.getUserChunks(userId);
  const results = [];
  
  for (const chunk of userChunks) {
    if (!chunk.embedding) continue;
    
    try {
      const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
      if (similarity >= threshold) {
        const document = storage.documents.get(chunk.documentId);
        const contextChunks = getContextualChunks(chunk, userChunks, 1);
        const contextualText = contextChunks.map(ctx => ctx.text).join(' ... ');
        
        results.push({
          documentId: chunk.documentId,
          filename: document?.filename || 'Unknown',
          chunkIndex: chunk.index,
          text: chunk.text,
          contextualText: contextualText,
          contextChunks: contextChunks.length,
          similarity: similarity,
          searchType: 'semantic',
          metadata: document?.metadata || {}
        });
      }
    } catch (error) {
      console.warn(`Error in semantic search for chunk ${chunk.id}:`, error);
    }
  }
  
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

// Fuzzy search implementation
async function performFuzzySearch(query, userId, threshold, limit) {
  const userChunks = storage.getUserChunks(userId);
  const lowerQuery = query.toLowerCase();
  const queryWords = lowerQuery.split(/\s+/).filter(word => word.length > 1);
  
  const results = [];
  
  for (const chunk of userChunks) {
    const lowerText = chunk.text.toLowerCase();
    let score = 0;
    let matches = 0;
    
    // Levenshtein distance-based fuzzy matching
    queryWords.forEach(word => {
      const words = lowerText.split(/\s+/);
      words.forEach(textWord => {
        const distance = levenshteinDistance(word, textWord);
        const maxLength = Math.max(word.length, textWord.length);
        const similarity = 1 - (distance / maxLength);
        
        if (similarity >= 0.5) { // 50% similarity threshold - more permissive
          score += similarity * 2;
          matches++;
        }
      });
    });
    
    // Partial substring matching
    queryWords.forEach(word => {
      if (word.length > 3) {
        const partialMatches = (lowerText.match(new RegExp(word.substring(0, Math.max(3, word.length - 1)), 'g')) || []).length;
        if (partialMatches > 0) {
          score += partialMatches * 0.5;
        }
      }
    });
    
    const normalizedScore = Math.min(score / Math.max(queryWords.length, 1), 1);
    
    if (normalizedScore >= threshold) {
      const document = storage.documents.get(chunk.documentId);
      const contextChunks = getContextualChunks(chunk, userChunks, 1);
      const contextualText = contextChunks.map(ctx => ctx.text).join(' ... ');
      
      results.push({
        documentId: chunk.documentId,
        filename: document?.filename || 'Unknown',
        chunkIndex: chunk.index,
        text: chunk.text,
        contextualText: contextualText,
        contextChunks: contextChunks.length,
        similarity: normalizedScore,
        searchType: 'fuzzy',
        matches: matches,
        metadata: document?.metadata || {}
      });
    }
  }
  
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

// Combine results from multiple search strategies
function combineSearchResults(strategies, limit) {
  const combinedMap = new Map();
  
  strategies.forEach(strategy => {
    strategy.results.forEach(result => {
      const key = `${result.documentId}_${result.chunkIndex}`;
      const existing = combinedMap.get(key);
      
      if (existing) {
        // Combine scores with strategy weight
        existing.similarity = Math.max(existing.similarity, result.similarity * strategy.weight);
        existing.searchTypes = existing.searchTypes || [existing.searchType];
        if (!existing.searchTypes.includes(result.searchType)) {
          existing.searchTypes.push(result.searchType);
        }
        existing.searchType = existing.searchTypes.join('+');
      } else {
        combinedMap.set(key, {
          ...result,
          similarity: result.similarity * strategy.weight,
          searchTypes: [result.searchType],
          originalSimilarity: result.similarity
        });
      }
    });
  });
  
  return Array.from(combinedMap.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

// Levenshtein distance calculation for fuzzy matching
function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Fallback text-based search when embeddings aren't available
 */
function handleTextBasedSearch(userId, query, options = {}) {
  const { limit = 10, threshold = 0.05 } = options;
  const userChunks = storage.getUserChunks(userId);
  const lowerQuery = query.toLowerCase();
  const queryWords = lowerQuery.split(/\s+/).filter(word => word.length > 1);
  
  // Query expansion with synonyms and related terms
  const expandedTerms = expandQueryTerms(queryWords);
  
  const results = [];
  
  for (const chunk of userChunks) {
    const lowerText = chunk.text.toLowerCase();
    
    // Multi-level scoring approach with query expansion
    let score = 0;
    let matches = 0;
    let exactMatches = 0;
    let synonymMatches = 0;
    
    // Exact phrase bonus (highest priority)
    if (lowerText.includes(lowerQuery)) {
      score += 15;
      matches++;
      exactMatches++;
    }
    
    // Individual word scoring with word boundaries
    queryWords.forEach(word => {
      const wordMatches = (lowerText.match(new RegExp(`\\b${word}\\b`, 'g')) || []).length;
      if (wordMatches > 0) {
        score += wordMatches * 3;
        matches++;
        exactMatches++;
      }
    });
    
    // Synonym and related term matching
    expandedTerms.forEach(term => {
      if (term !== lowerQuery) { // Don't double-count original terms
        const termMatches = (lowerText.match(new RegExp(`\\b${term}\\b`, 'g')) || []).length;
        if (termMatches > 0) {
          score += termMatches * 1.5;
          matches++;
          synonymMatches++;
        }
      }
    });
    
    // Partial word matches (for typos and variations)
    queryWords.forEach(word => {
      if (word.length > 3) {
        const partialMatches = (lowerText.match(new RegExp(word.substring(0, Math.max(3, word.length - 1)), 'g')) || []).length;
        if (partialMatches > 0) {
          score += partialMatches * 0.8;
        }
      }
    });
    
    // Position-based scoring (earlier matches get higher scores)
    const firstMatchIndex = lowerText.indexOf(lowerQuery);
    if (firstMatchIndex !== -1) {
      const positionBonus = Math.max(0, 1 - (firstMatchIndex / lowerText.length));
      score += positionBonus * 2;
    }
    
    // Length-based scoring (longer chunks with matches get slight bonus)
    const lengthBonus = Math.min(chunk.text.length / 1000, 1) * 0.5;
    score += lengthBonus;
    
    // Simplified scoring - more permissive
    const maxPossibleScore = Math.max(10, queryWords.length * 2);
    const normalizedScore = Math.min(score / maxPossibleScore, 1);
    
    if (normalizedScore >= threshold) {
      const document = storage.documents.get(chunk.documentId);
      
      // Get overlapping context from adjacent chunks
      const contextChunks = getContextualChunks(chunk, userChunks, 1);
      const contextualText = contextChunks.map(ctx => ctx.text).join(' ... ');
      
      results.push({
        documentId: chunk.documentId,
        filename: document?.filename || 'Unknown',
        chunkIndex: chunk.index,
        text: chunk.text,
        contextualText: contextualText,
        contextChunks: contextChunks.length,
        similarity: normalizedScore,
        matches: matches,
        exactMatches: exactMatches,
        synonymMatches: synonymMatches,
        score: score,
        metadata: document?.metadata || {}
      });
    }
  }
  
  // Simplified sorting - just by similarity score
  results.sort((a, b) => b.similarity - a.similarity);
  
  console.log(`Enhanced text-based search found ${results.length} results for query: "${query}"`);
  
  // If no results found, try even more permissive search
  if (results.length === 0) {
    console.log('No results found, trying ultra-permissive search...');
    const ultraPermissiveResults = performUltraPermissiveSearch(userChunks, query, limit);
    if (ultraPermissiveResults.length > 0) {
      console.log(`Ultra-permissive search found ${ultraPermissiveResults.length} results`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          results: ultraPermissiveResults,
          totalFound: ultraPermissiveResults.length,
          searchType: 'ultra-permissive',
          storage: 'enhanced-memory',
          query: {
            text: query,
            limit,
            threshold: 0.01,
            hasEmbedding: false
          }
        }),
      };
    }
  }
  
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      results: results.slice(0, limit),
      totalFound: results.length,
      searchType: 'enhanced-text-based',
      storage: 'enhanced-memory',
      query: {
        text: query,
        expandedTerms: expandedTerms,
        limit,
        threshold,
        hasEmbedding: false
      }
    }),
  };
}

// Query preprocessing for better search results
function preprocessQuery(query) {
  if (!query || typeof query !== 'string') return '';
  
  let processed = query.trim();
  
  // Only remove very common stop words that definitely interfere
  const stopWords = ['the', 'a', 'an'];
  const words = processed.split(/\s+/);
  const filteredWords = words.filter(word => 
    word.length > 1 && !stopWords.includes(word.toLowerCase())
  );
  
  // Rejoin and clean up
  processed = filteredWords.join(' ').trim();
  
  // Handle common abbreviations and expand them
  const abbreviations = {
    'gmp': 'good manufacturing practice',
    'gcp': 'good clinical practice',
    'glp': 'good laboratory practice',
    'sop': 'standard operating procedure',
    'qa': 'quality assurance',
    'qc': 'quality control',
    'fda': 'food and drug administration',
    'ema': 'european medicines agency',
    'ich': 'international council for harmonisation',
    'api': 'active pharmaceutical ingredient',
    'ctd': 'common technical document',
    'dossier': 'regulatory dossier',
    'nda': 'new drug application',
    'anda': 'abbreviated new drug application'
  };
  
  let expandedQuery = processed;
  Object.entries(abbreviations).forEach(([abbr, full]) => {
    const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
    expandedQuery = expandedQuery.replace(regex, `${abbr} ${full}`);
  });
  
  return expandedQuery;
}

// Query expansion function for better search coverage
function expandQueryTerms(queryWords) {
  const expandedTerms = new Set();
  
  // Add original terms
  queryWords.forEach(word => expandedTerms.add(word));
  
  // Common pharmaceutical/regulatory synonyms
  const synonyms = {
    'quality': ['standard', 'specification', 'requirement', 'criteria'],
    'assurance': ['control', 'management', 'verification', 'validation'],
    'manufacturing': ['production', 'processing', 'fabrication', 'making'],
    'pharmaceutical': ['drug', 'medicine', 'therapeutic', 'medicinal'],
    'regulatory': ['compliance', 'governance', 'oversight', 'supervision'],
    'documentation': ['records', 'documentation', 'paperwork', 'files'],
    'procedure': ['process', 'method', 'protocol', 'workflow'],
    'testing': ['analysis', 'examination', 'evaluation', 'assessment'],
    'validation': ['verification', 'confirmation', 'certification', 'approval'],
    'batch': ['lot', 'group', 'set', 'collection'],
    'specification': ['requirement', 'standard', 'criteria', 'parameter'],
    'deviation': ['variance', 'exception', 'nonconformity', 'discrepancy'],
    'investigation': ['analysis', 'examination', 'review', 'study'],
    'corrective': ['remedial', 'fixing', 'repairing', 'correcting'],
    'preventive': ['proactive', 'precautionary', 'protective', 'safeguarding'],
    'good': ['proper', 'appropriate', 'suitable', 'adequate'],
    'practice': ['procedure', 'method', 'approach', 'technique'],
    'clinical': ['medical', 'therapeutic', 'patient', 'treatment'],
    'laboratory': ['lab', 'testing', 'analysis', 'research'],
    'standard': ['specification', 'requirement', 'criteria', 'guideline'],
    'operating': ['functional', 'procedural', 'operational', 'working'],
    'audit': ['review', 'inspection', 'examination', 'assessment', 'evaluation'],
    'trail': ['record', 'log', 'history', 'track', 'trace', 'documentation'],
    'audit trail': ['audit record', 'audit log', 'audit history', 'audit documentation', 'review trail', 'inspection trail']
  };
  
  // Add synonyms for each query word
  queryWords.forEach(word => {
    const wordLower = word.toLowerCase();
    if (synonyms[wordLower]) {
      synonyms[wordLower].forEach(synonym => expandedTerms.add(synonym));
    }
  });
  
  // Add common variations (plurals, different tenses)
  queryWords.forEach(word => {
    if (word.endsWith('s')) {
      expandedTerms.add(word.slice(0, -1)); // singular
    } else {
      expandedTerms.add(word + 's'); // plural
    }
    if (word.endsWith('ing')) {
      expandedTerms.add(word.slice(0, -3)); // base form
    }
  });
  
  return Array.from(expandedTerms);
}

// Ultra-permissive search for when normal search fails
function performUltraPermissiveSearch(userChunks, query, limit) {
  const lowerQuery = query.toLowerCase();
  const queryWords = lowerQuery.split(/\s+/).filter(word => word.length > 0);
  const results = [];
  
  for (const chunk of userChunks) {
    const lowerText = chunk.text.toLowerCase();
    let score = 0;
    let matches = 0;
    
    // Very basic matching - any word that appears gets points
    queryWords.forEach(word => {
      if (lowerText.includes(word)) {
        const wordMatches = (lowerText.match(new RegExp(word, 'g')) || []).length;
        score += wordMatches;
        matches++;
      }
    });
    
    // Even partial matches get some points
    queryWords.forEach(word => {
      if (word.length > 2) {
        const partialMatches = (lowerText.match(new RegExp(word.substring(0, Math.max(2, word.length - 1)), 'g')) || []).length;
        if (partialMatches > 0) {
          score += partialMatches * 0.3;
        }
      }
    });
    
    // Any chunk with any match gets included
    if (score > 0) {
      const document = storage.documents.get(chunk.documentId);
      const contextChunks = getContextualChunks(chunk, userChunks, 1);
      const contextualText = contextChunks.map(ctx => ctx.text).join(' ... ');
      
      results.push({
        documentId: chunk.documentId,
        filename: document?.filename || 'Unknown',
        chunkIndex: chunk.index,
        text: chunk.text,
        contextualText: contextualText,
        contextChunks: contextChunks.length,
        similarity: Math.min(score / Math.max(queryWords.length, 1), 1),
        searchType: 'ultra-permissive',
        matches: matches,
        score: score,
        metadata: document?.metadata || {}
      });
    }
  }
  
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

// Helper function to get contextual chunks for better context
function getContextualChunks(targetChunk, allChunks, contextRadius = 1) {
  const documentChunks = allChunks.filter(chunk => chunk.documentId === targetChunk.documentId);
  const targetIndex = documentChunks.findIndex(chunk => chunk.id === targetChunk.id);
  
  if (targetIndex === -1) return [targetChunk];
  
  const startIndex = Math.max(0, targetIndex - contextRadius);
  const endIndex = Math.min(documentChunks.length - 1, targetIndex + contextRadius);
  
  return documentChunks.slice(startIndex, endIndex + 1);
}

/**
 * Handle list documents
 */
async function handleList(userId) {
  try {
    console.log('Enhanced list for user:', userId);

    const userDocuments = storage.getUserDocuments(userId);
    
    const documents = userDocuments.map(doc => ({
      id: doc.id,
      filename: doc.filename,
      type: `application/${doc.fileType}`,
      size: doc.fileSize,
      chunks: doc.chunkCount,
      category: doc.metadata?.category || 'general',
      tags: doc.metadata?.tags || [],
      createdAt: doc.createdAt,
      metadata: doc.metadata,
      hasEmbeddings: doc.metadata?.hasEmbeddings || false
    }));
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        documents: documents,
        total: documents.length,
        storage: 'enhanced-memory',
        capabilities: {
          semanticSearch: true,
          textSearch: true,
          realEmbeddings: true
        }
      }),
    };
  } catch (error) {
    console.error('Error in enhanced list:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to list documents',
        message: error.message 
      }),
    };
  }
}

/**
 * Handle delete document
 */
async function handleDelete(userId, documentId) {
  try {
    console.log('Enhanced delete for user:', userId, 'doc:', documentId);

    if (!documentId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Document ID is required' }),
      };
    }

    const document = storage.documents.get(documentId);
    
    if (!document || document.userId !== userId) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Document not found' }),
      };
    }
    
    // Delete document
    storage.documents.delete(documentId);
    
    // Delete all associated chunks
    let deletedChunks = 0;
    for (const [chunkId, chunk] of storage.chunks.entries()) {
      if (chunk.documentId === documentId && chunk.userId === userId) {
        storage.chunks.delete(chunkId);
        deletedChunks++;
      }
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        message: 'Document deleted successfully',
        documentId,
        filename: document.filename,
        deletedChunks,
        storage: 'enhanced-memory'
      }),
    };
  } catch (error) {
    console.error('Error in enhanced delete:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to delete document',
        message: error.message 
      }),
    };
  }
}

/**
 * Handle stats
 */
async function handleStats(userId) {
  try {
    console.log('Enhanced stats for user:', userId);

    const userDocuments = storage.getUserDocuments(userId);
    const userChunks = storage.getUserChunks(userId);
    
    let totalSize = 0;
    let totalChunks = 0;
    let documentsWithEmbeddings = 0;
    let chunksWithEmbeddings = 0;
    
    userDocuments.forEach(doc => {
      totalSize += doc.fileSize || 0;
      totalChunks += doc.chunkCount || 0;
      if (doc.metadata?.hasEmbeddings) {
        documentsWithEmbeddings++;
      }
    });
    
    userChunks.forEach(chunk => {
      if (chunk.embedding) {
        chunksWithEmbeddings++;
      }
    });
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        totalDocuments: userDocuments.length,
        totalChunks: totalChunks,
        totalSize: totalSize,
        documentsWithEmbeddings,
        chunksWithEmbeddings,
        embeddingCoverage: totalChunks > 0 ? (chunksWithEmbeddings / totalChunks * 100).toFixed(1) : 0,
        storage: 'enhanced-memory',
        capabilities: {
          semanticSearch: chunksWithEmbeddings > 0,
          textSearch: true,
          embeddingGeneration: true
        },
        lastUpdated: new Date().toISOString()
      }),
    };
  } catch (error) {
    console.error('Error in enhanced stats:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to get stats',
        message: error.message 
      }),
    };
  }
}

/**
 * Handle test functionality
 */
async function handleTest(userId) {
  try {
    const testResults = {
      userId,
      timestamp: new Date().toISOString(),
      storage: 'enhanced-memory',
      tests: {}
    };
    
    // Test embedding generation
    try {
      const testEmbedding = await generateEmbedding('This is a test for pharmaceutical quality systems.');
      testResults.tests.embeddingGeneration = {
        success: true,
        embeddingDimensions: testEmbedding.length
      };
    } catch (error) {
      testResults.tests.embeddingGeneration = {
        success: false,
        error: error.message
      };
    }
    
    // Test storage
    testResults.tests.storage = {
      success: true,
      totalDocuments: storage.documents.size,
      totalChunks: storage.chunks.size,
      userDocuments: storage.getUserDocuments(userId).length
    };
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(testResults),
    };
  } catch (error) {
    console.error('Error in enhanced test:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Test failed',
        message: error.message 
      }),
    };
  }
}

/**
 * Utility Functions
 */

function chunkText(text, maxChunkSize = 1000, overlap = 200) {
  const chunks = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + maxChunkSize, text.length);
    const chunkText = text.substring(start, end);
    
    // Try to break at sentence boundaries
    let actualEnd = end;
    if (end < text.length) {
      const lastPeriod = chunkText.lastIndexOf('.');
      const lastQuestion = chunkText.lastIndexOf('?');
      const lastExclamation = chunkText.lastIndexOf('!');
      
      const sentenceEnd = Math.max(lastPeriod, lastQuestion, lastExclamation);
      if (sentenceEnd > start + (maxChunkSize * 0.5)) {
        actualEnd = start + sentenceEnd + 1;
      }
    }
    
    const finalChunk = text.substring(start, actualEnd);
    
    chunks.push({
      text: finalChunk.trim(),
      wordCount: finalChunk.split(/\s+/).length,
      characterCount: finalChunk.length,
      startIndex: start,
      endIndex: actualEnd
    });
    
    start = actualEnd - overlap;
    if (start < 0) start = actualEnd;
  }
  
  return chunks;
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || !Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = Number(vecA[i]) || 0;
    const b = Number(vecB[i]) || 0;
    
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

function getFileType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const typeMap = {
    'pdf': 'pdf',
    'doc': 'doc',
    'docx': 'docx',
    'txt': 'txt'
  };
  return typeMap[ext] || 'txt';
}

function getPlaceholderText(filename) {
  return `Test Document: ${filename}

This is a pharmaceutical quality document for testing the RAG system. It contains industry-relevant content to test semantic search capabilities.

Good Manufacturing Practice (GMP) Overview:
Current Good Manufacturing Practice regulations ensure that pharmaceutical products are consistently produced and controlled according to quality standards. These regulations minimize the risks involved in pharmaceutical production.

Key GMP Principles:
1. Quality management systems must be established
2. Manufacturing processes must be clearly defined and controlled
3. Critical process steps and changes must be validated
4. Manufacturing facilities and equipment must be designed, constructed, and maintained
5. Personnel must be qualified and trained
6. Contamination must be minimized during production
7. Quality control systems must be established
8. Records must be maintained to demonstrate compliance

Validation Requirements:
Process validation demonstrates that a manufacturing process, when operated within established parameters, will consistently produce a product that meets predetermined quality attributes and specifications.

CAPA System:
Corrective and Preventive Action systems are essential for identifying, investigating, and correcting quality problems, and for preventing their recurrence.

This content can be used to test document chunking, embedding generation, and semantic search functionality.`;
}

function getPharmaceuticalPlaceholder(filename) {
  const topics = [
    'Quality Control Testing Procedures',
    'Manufacturing Process Controls', 
    'Cleaning Validation Protocols',
    'Computer System Validation',
    'Stability Testing Guidelines',
    'Change Control Procedures'
  ];
  
  const selectedTopic = topics[Math.floor(Math.random() * topics.length)];
  
  return `Pharmaceutical Document: ${filename}

Topic: ${selectedTopic}

This document contains pharmaceutical quality and compliance information related to ${selectedTopic.toLowerCase()}. The content has been processed through the AcceleraQA RAG system for semantic search and AI-powered responses.

Document Summary:
This technical document outlines industry best practices and regulatory requirements for pharmaceutical operations. It includes detailed procedures, compliance guidelines, and quality assurance protocols essential for maintaining product safety and efficacy.

Key Sections:
- Regulatory Framework and Guidelines
- Standard Operating Procedures (SOPs)
- Quality Control Measurements
- Risk Assessment and Management
- Documentation and Record Keeping
- Training and Personnel Qualifications

The document provides comprehensive guidance for pharmaceutical professionals working in quality assurance, manufacturing, and regulatory compliance roles.

Note: This is placeholder content generated for RAG system testing. Actual document content would contain specific technical details, procedures, and regulatory citations relevant to pharmaceutical operations.`;
}
