// src/services/ragService.js - RAG service using OpenAI file search APIs
import openaiService from './openaiService';
import { getToken, getUserId } from './authService';
import { getCurrentModel } from '../config/modelConfig';
import { RAG_BACKEND, RAG_BACKENDS, NEON_RAG_FUNCTION, RAG_DOCS_FUNCTION } from '../config/ragConfig';
import { convertDocxToPdfIfNeeded } from '../utils/fileConversion';

const DEFAULT_NEON_ENDPOINTS = Array.from(new Set([
  NEON_RAG_FUNCTION,
  '/.netlify/functions/neon-rag-fixed',
  '/.netlify/functions/neon-rag',
]));

class RAGService {
  constructor() {
    this.apiUrl = openaiService.baseUrl;
    this.vectorStoreId = null;
    this.vectorStoreUserId = null;
    this.backend = RAG_BACKEND;
    this.neonEndpoints = DEFAULT_NEON_ENDPOINTS;
    this.activeNeonEndpointIndex = 0;
    this.docsEndpoint = RAG_DOCS_FUNCTION;
    this.convertDocxToPdfIfNeeded = convertDocxToPdfIfNeeded;
  }

  sanitizeMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') {
      return {};
    }

    const sanitized = { ...metadata };

    if (Array.isArray(sanitized.tags)) {
      sanitized.tags = sanitized.tags
        .map(tag => (typeof tag === 'string' ? tag.trim() : ''))
        .filter(Boolean);
      if (!sanitized.tags.length) {
        delete sanitized.tags;
      }
    } else if (typeof sanitized.tags === 'string') {
      const normalizedTags = sanitized.tags
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag);
      if (normalizedTags.length) {
        sanitized.tags = normalizedTags;
      } else {
        delete sanitized.tags;
      }
    }

    ['title', 'description', 'category', 'version'].forEach(field => {
      if (typeof sanitized[field] === 'string') {
        sanitized[field] = sanitized[field].trim();
        if (!sanitized[field]) {
          delete sanitized[field];
        }
      }
    });

    return sanitized;
  }

  isNeonBackend() {
    return this.backend === RAG_BACKENDS.NEON;
  }

  async makeNeonRequest(action, userId, payload = {}) {
    if (!this.isNeonBackend()) {
      throw new Error('Neon RAG backend is not enabled');
    }

    const resolvedUserId = userId || (await getUserId());
    if (!resolvedUserId) {
      throw new Error('User ID is required for Neon RAG operations');
    }

    let token;
    try {
      token = await getToken();
    } catch (error) {
      console.error('Failed to fetch token for Neon request:', error);
      throw new Error(`Authentication failed: ${error.message}`);
    }

    const requestBody = JSON.stringify({ action, ...payload });
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-user-id': resolvedUserId,
    };

    let lastError;

    for (let i = this.activeNeonEndpointIndex; i < this.neonEndpoints.length; i++) {
      const endpoint = this.neonEndpoints[i];
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: requestBody,
        });

        if (response.status === 404 && i < this.neonEndpoints.length - 1) {
          lastError = new Error('Neon RAG endpoint not found');
          this.activeNeonEndpointIndex = i + 1;
          continue;
        }

        if (!response.ok) {
          let errorMessage = `Request failed with status ${response.status}`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorData.message || errorMessage;
          } catch (parseError) {
            console.warn('Failed to parse Neon error response:', parseError);
          }
          throw new Error(errorMessage);
        }

        this.activeNeonEndpointIndex = i;
        return await response.json();
      } catch (error) {
        lastError = error;
        console.error('Neon request failed:', error);
        if (i === this.neonEndpoints.length - 1) {
          throw lastError;
        }
      }
    }

    throw lastError || new Error('Neon RAG request failed');

  }

  async makeDocumentMetadataRequest(action, userId, payload = {}) {
    if (!this.docsEndpoint) {
      throw new Error('Document metadata endpoint is not configured');
    }

    if (!action) {
      throw new Error('Action is required for document metadata requests');
    }

    const resolvedUserId = userId || (await getUserId());
    if (!resolvedUserId) {
      throw new Error('User ID is required for document metadata operations');
    }

    let token;
    try {
      token = await getToken();
    } catch (error) {
      console.error('Failed to fetch token for document metadata request:', error);
      throw new Error(`Authentication failed: ${error.message}`);
    }

    const requestBody = JSON.stringify({ action, ...payload });
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-user-id': resolvedUserId,
    };

    let response;
    try {
      response = await fetch(this.docsEndpoint, {
        method: 'POST',
        headers,
        body: requestBody,
      });
    } catch (error) {
      console.error('Document metadata request failed:', error);
      throw new Error('Unable to reach document metadata service');
    }

    if (!response.ok) {
      let errorMessage = `Request failed with status ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch (parseError) {
        console.warn('Failed to parse document metadata error response:', parseError);
      }
      throw new Error(errorMessage);
    }

    return await response.json();
  }

  async getVectorStoreId(userId) {
    if (!userId) throw new Error('User ID is required');
    if (this.isNeonBackend()) {
      return null;
    }
    if (this.vectorStoreId && this.vectorStoreUserId === userId) {
      return this.vectorStoreId;
    }

    const response = await this.makeDocumentMetadataRequest('get_vector_store', userId);
    let vectorStoreId = response?.vectorStoreId || response?.vector_store_id || null;

    if (!vectorStoreId) {
      vectorStoreId = await openaiService.createVectorStore();
      await this.makeDocumentMetadataRequest('set_vector_store', userId, { vectorStoreId });
    }

    this.vectorStoreId = vectorStoreId;
    this.vectorStoreUserId = userId;
    return vectorStoreId;
  }

  async testConnection(userId) {
    if (this.isNeonBackend()) {
      try {
        const result = await this.makeNeonRequest('test', userId);
        return {
          success: true,
          recommendation: 'Neon RAG service reachable.',
          message: result?.message || 'Connection established',
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          recommendation: 'Verify Neon database connectivity and authentication headers',
        };
      }
    }

    try {
      await this.makeDocumentMetadataRequest('health', userId);
    } catch (error) {
      console.error('Document metadata health check failed:', error);
      return {
        success: false,
        error: error.message,
        recommendation: 'Verify Neon database connectivity for document metadata storage',
      };
    }

    try {
      await openaiService.makeRequest('/files', {
        method: 'GET',
        headers: { 'OpenAI-Beta': 'assistants=v2' },
      });
      return {
        success: true,
        recommendation: 'OpenAI file search API reachable. Document metadata service reachable.',
      };
    } catch (error) {
      console.error('RAG connection test failed:', error);
      return {
        success: false,
        error: error.message,
        recommendation: 'Check OpenAI API key and network connectivity',
      };
    }
  }

  async uploadDocument(file, metadata = {}, userId) {
    if (!file) throw new Error('File is required');

    const sanitizedMetadata = this.sanitizeMetadata(metadata);

    if (this.isNeonBackend()) {
      if (!userId) {
        throw new Error('User ID is required to upload documents');
      }

      const textContent = await this.extractTextFromFile(file);
      const documentPayload = {
        filename: file.name,
        size: file.size,
        type: file.type,
        text: textContent,
        metadata: {
          processingMode: 'neon-postgresql',
          ...sanitizedMetadata,
        },
      };

      const response = await this.makeNeonRequest('upload', userId, {
        document: documentPayload,
      });

      return {
        ...response,
        metadata: documentPayload.metadata,
        storage: 'neon-postgresql',
      };
    }

    const {
      file: uploadableFile,
      converted,
      originalFileName,
      originalMimeType,
    } = await this.convertDocxToPdfIfNeeded(file);
    const fileId = await openaiService.uploadFile(uploadableFile);
    const vectorStoreId = await this.getVectorStoreId(userId);
    await openaiService.attachFileToVectorStore(vectorStoreId, fileId);

    const docInfo = {
      id: fileId,
      fileId,
      filename: uploadableFile.name,
      type: uploadableFile.type,
      size: uploadableFile.size,
      chunks: 0,
      createdAt: new Date().toISOString(),
      metadata: {
        processingMode: 'openai-file-search',
        ...(converted
          ? {
              originalFilename: originalFileName,
              originalMimeType,
              conversion: 'docx-to-pdf',
            }
          : {}),
        ...sanitizedMetadata,
      },
      vectorStoreId,
    };

    let savedDocument = docInfo;
    try {
      const response = await this.makeDocumentMetadataRequest('save_document', userId, {
        document: docInfo,
        vectorStoreId,
      });
      savedDocument = response?.document || docInfo;
    } catch (error) {
      console.error('Failed to persist document metadata. Rolling back OpenAI upload.', error);
      try {
        await openaiService.makeRequest(`/files/${fileId}`, {
          method: 'DELETE',
          headers: { 'OpenAI-Beta': 'assistants=v2' },
        });
      } catch (cleanupError) {
        console.error('Failed to remove uploaded file after metadata error:', cleanupError);
      }
      throw error;
    }

    return {
      fileId,
      vectorStoreId,
      metadata: savedDocument?.metadata || docInfo.metadata,
      document: savedDocument,
    };
  }

  async getDocuments(userId) {
    if (this.isNeonBackend()) {
      if (!userId) {
        throw new Error('User ID is required to list documents');
      }
      const response = await this.makeNeonRequest('list', userId);
      return response?.documents || [];
    }

    const resolvedUserId = userId || (await getUserId());
    if (!resolvedUserId) {
      throw new Error('User ID is required to list documents');
    }

    let documents = [];
    try {
      const response = await this.makeDocumentMetadataRequest('list_documents', resolvedUserId);
      documents = response?.documents || [];
    } catch (error) {
      console.error('Failed to retrieve persisted documents:', error);
      throw new Error(`Failed to load documents: ${error.message}`);
    }

    try {
      const data = await openaiService.makeRequest('/files', {
        method: 'GET',
        headers: { 'OpenAI-Beta': 'assistants=v2' },
      });
      const ids = new Set((data.data || []).map(f => f.id));
      const syncedDocuments = documents.filter(doc => ids.has(doc.id));

      if (syncedDocuments.length !== documents.length) {
        const missingDocuments = documents.filter(doc => !ids.has(doc.id));
        await Promise.all(
          missingDocuments.map(doc =>
            this.makeDocumentMetadataRequest('delete_document', resolvedUserId, { documentId: doc.id }).catch(syncError => {
              console.warn('Failed to prune missing document metadata:', syncError);
            })
          )
        );
      }

      return syncedDocuments;
    } catch (error) {
      console.warn('Failed to synchronize document metadata with OpenAI:', error);
      return documents;
    }
  }

  async deleteDocument(documentId, userId) {
    if (this.isNeonBackend()) {
      if (!userId) {
        throw new Error('User ID is required to delete documents');
      }
      await this.makeNeonRequest('delete', userId, { documentId });
      return { success: true };
    }

    const resolvedUserId = userId || (await getUserId());
    await openaiService.makeRequest(`/files/${documentId}`, {
      method: 'DELETE',
      headers: { 'OpenAI-Beta': 'assistants=v2' },
    });

    try {
      await this.makeDocumentMetadataRequest('delete_document', resolvedUserId, { documentId });
    } catch (error) {
      console.warn('Failed to remove document metadata after deletion:', error);
    }
    return { success: true };
  }

  async extractTextFromFile(file) {
    if (file.type === 'text/plain') {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Failed to read text file'));
        reader.readAsText(file);
      });
    }

    if (file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf')) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const raw = new TextDecoder().decode(arrayBuffer);
        const matches = [...raw.matchAll(/\(([^)]+)\)/g)].map(m => m[1]).join(' ');
        return matches.trim();
      } catch (err) {
        console.error('Failed to extract PDF text:', err);
        throw new Error(`Failed to extract PDF text: ${err.message}`);
      }
    }

    if (
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.name?.toLowerCase().endsWith('.docx')
    ) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const mammoth = await import('mammoth');
        const { value } = await mammoth.extractRawText({ arrayBuffer });
        return value;
      } catch (err) {
        console.error('Failed to extract DOCX text:', err);
        return '';
      }
    }

    console.warn('Unsupported file type for text extraction:', file.type || file.name);
    return '';
  }

  async searchDocuments(query, options = {}, userId) {
    if (!query || !query.trim()) throw new Error('Search query is required');

    if (this.isNeonBackend()) {
      if (!userId) {
        throw new Error('User ID is required to search documents');
      }
      const payload = {
        query: query.trim(),
        options: {
          limit: options.limit || 10,
          ...options,
        },
      };
      return await this.makeNeonRequest('search', userId, payload);
    }

    const vectorStoreId = await this.getVectorStoreId(userId);

    const result = await openaiService.makeRequest(`/vector_stores/${vectorStoreId}/search`, {
      headers: {
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2',
      },
      body: JSON.stringify({ query: query.trim(), limit: options.limit || 10 }),
    });

    return result;
  }

  async generateRAGResponse(query, userId, options = {}) {
    if (this.isNeonBackend()) {
      return this.generateNeonRagResponse(query, userId, options);
    }


    const vectorStoreId = await this.getVectorStoreId(userId);

    const trimmedQuery = typeof query === 'string' ? query.trim() : '';
    if (!trimmedQuery) {
      throw new Error('Query is required to generate a response');
    }

    const body = {
      model: getCurrentModel(),
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: trimmedQuery,
            },
          ],
        },
      ],
      tools: [{ type: 'file_search' }],
      attachments: [
        {
          vector_store_id: vectorStoreId,
          tools: [{ type: 'file_search' }],
        },
      ],
      tool_resources: {
        file_search: {
          vector_store_ids: [vectorStoreId],
        },
      },
    };

    const data = await openaiService.makeRequest('/responses', {
      headers: { 'OpenAI-Beta': 'assistants=v2' },
      body: JSON.stringify(body),
    });

    const outputMessages = Array.isArray(data.output) ? data.output : [];
    const contentItems = outputMessages.flatMap(message => message.content || []);

    const answerFromContent = contentItems
      .map(item => {
        if (typeof item?.text?.value === 'string') {
          return item.text.value;
        }
        if (typeof item?.text === 'string') {
          return item.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();

    const rawAnswer =
      (typeof data.output_text === 'string' && data.output_text.trim()) ||
      answerFromContent ||
      '';

    const answer = rawAnswer.trim() || 'The document search returned no results.';

    const annotations = [];
    contentItems.forEach(item => {
      if (Array.isArray(item?.text?.annotations)) annotations.push(...item.text.annotations);
      if (Array.isArray(item?.annotations)) annotations.push(...item.annotations);
    });

    const sources = annotations
      .filter(Boolean)
      .map((annotation, index) => {
        const textSnippet = typeof annotation.text === 'string'
          ? annotation.text
          : typeof annotation?.file_citation?.quote === 'string'
            ? annotation.file_citation.quote
            : typeof annotation?.quote === 'string'
              ? annotation.quote
              : '';

        const filename =
          annotation.filename ||
          annotation.file_name ||
          annotation?.document?.filename ||
          annotation?.document?.title ||
          annotation?.file_citation?.filename ||
          annotation?.file_citation?.file_name ||
          annotation?.file_citation?.file_id ||
          `Document ${index + 1}`;

        const sourceId =
          annotation.id ||
          annotation?.file_citation?.file_id ||
          annotation?.file_path ||
          `source-${index}`;

        return {
          ...annotation,
          id: sourceId,
          filename,
          text: textSnippet,
        };
      });

    return {
      answer,
      sources,
      ragMetadata: {
        totalSources: sources.length,
        processingMode: 'openai-file-search',
      },
    };
  }

  async generateNeonRagResponse(query, userId, options = {}) {
    if (!userId) {
      throw new Error('User ID is required for Neon RAG responses');
    }

    const trimmedQuery = (query || '').trim();
    if (!trimmedQuery) {
      throw new Error('Search query is required');
    }

    const searchOptions = {
      limit: options.limit || options?.searchOptions?.limit || 5,
      ...options.searchOptions,
    };

    const searchResult = options.searchResults ||
      (await this.makeNeonRequest('search', userId, {
        query: trimmedQuery,
        options: searchOptions,
      }));

    const results = searchResult?.results || [];

    if (results.length === 0) {
      return {
        answer: 'No relevant documents were found for your question.',
        sources: [],
        resources: [],
        ragMetadata: {
          totalSources: 0,
          processingMode: 'neon-postgresql',
        },
      };
    }

    const contextSections = results
      .map((result, index) => {
        const snippet = (result.text || '').trim();
        return `Source ${index + 1}: ${result.filename} (chunk ${result.chunkIndex + 1})\n${snippet}`;
      })
      .join('\n\n');

    const prompt = [
      'You are AcceleraQA, an expert assistant for pharmaceutical quality and compliance.',
      'Use only the provided document excerpts to answer the user question. Cite the document name when referencing a source.',
      'If the excerpts do not contain enough information, say so clearly.',
      '',
      'Document excerpts:',
      contextSections,
      '',
      `Question: ${trimmedQuery}`,
      '',
      'Answer:',
    ].join('\n');

    const aiResult = await openaiService.getChatResponse(prompt);
    const answer = aiResult?.answer || '';
    const resources = aiResult?.resources || [];

    const sources = results.map((result, index) => ({
      ...result,
      sourceId: `${result.documentId}:${result.chunkIndex}`,
      index,
    }));

    return {
      answer,
      sources,
      resources,
      ragMetadata: {
        totalSources: sources.length,
        processingMode: 'neon-postgresql',
      },
    };
  }

  async search(query, userId, options = {}) {
    try {
      const response = await this.generateRAGResponse(query, userId, options);
      return {
        answer: response.answer,
        sources: response.sources || [],
        resources: response.resources || [],
      };
    } catch (error) {
      console.error('Error performing RAG search:', error);
      throw error;
    }
  }

  async getStats(userId) {
    if (this.isNeonBackend()) {
      if (!userId) {
        throw new Error('User ID is required to retrieve Neon stats');
      }
      const stats = await this.makeNeonRequest('stats', userId);
      return stats || { totalDocuments: 0, totalChunks: 0, totalSize: 0 };
    }

    const documents = await this.getDocuments(userId);
    return { totalDocuments: documents.length };
  }

  async runDiagnostics(userId) {
    if (this.isNeonBackend()) {
      const diagnostics = {
        timestamp: new Date().toISOString(),
        mode: 'neon-postgresql',
        tests: {},
      };

      try {
        diagnostics.tests.connectivity = await this.testConnection(userId);
      } catch (error) {
        diagnostics.tests.connectivity = { success: false, error: error.message };
      }

      try {
        const documents = await this.getDocuments(userId);
        diagnostics.tests.documentListing = {
          success: true,
          documentCount: documents.length,
        };
      } catch (error) {
        diagnostics.tests.documentListing = { success: false, error: error.message };
      }

      try {
        const searchResult = await this.searchDocuments('pharmaceutical quality gmp', { limit: 3 }, userId);
        const resultCount = Array.isArray(searchResult?.results) ? searchResult.results.length : 0;
        diagnostics.tests.search = {
          success: resultCount > 0,
          resultsFound: resultCount,
          searchType: 'full-text',
        };
      } catch (error) {
        diagnostics.tests.search = { success: false, error: error.message };
      }

      try {
        diagnostics.tests.stats = { success: true, ...(await this.getStats(userId)) };
      } catch (error) {
        diagnostics.tests.stats = { success: false, error: error.message };
      }

      const successful = Object.values(diagnostics.tests).filter(test => test.success).length;
      const total = Object.keys(diagnostics.tests).length;

      diagnostics.health = {
        score: total === 0 ? 0 : (successful / total) * 100,
        status:
          successful === total
            ? 'healthy'
            : successful >= Math.ceil(total / 2)
            ? 'partial'
            : 'unhealthy',
        mode: 'neon-postgresql',
        features: {
          databaseStorage: true,
          fullTextSearch: true,
          openAIIntegration: true,
        },
        recommendations: [],
      };

      if (!diagnostics.tests.connectivity?.success) {
        diagnostics.health.recommendations.push('Check Neon database URL and credentials');
      }

      if (!diagnostics.tests.search?.success) {
        diagnostics.health.recommendations.push('Upload documents to enable Neon search results');
      }

      if (diagnostics.health.status === 'healthy') {
        diagnostics.health.recommendations.push('Neon-backed RAG system operational');
      }

      return diagnostics;
    }

    try {
      const diagnostics = {
        timestamp: new Date().toISOString(),
        mode: 'openai-file-search',
        tests: {},
      };

      // Connectivity test
      try {
        const connectionTest = await this.testConnection(userId);
        diagnostics.tests.connectivity = connectionTest;
      } catch (error) {
        diagnostics.tests.connectivity = { success: false, error: error.message };
      }

      // Document listing test
      try {
        const documents = await this.getDocuments(userId);
        diagnostics.tests.documentListing = { success: true, documentCount: documents.length };
      } catch (error) {
        diagnostics.tests.documentListing = { success: false, error: error.message };
      }

      // Vector search test
      try {
        const searchResult = await this.searchDocuments('pharmaceutical quality gmp', { limit: 3 }, userId);
        diagnostics.tests.search = {
          success: !!searchResult,
          resultsFound: searchResult?.data?.length || searchResult?.results?.length || 0,
          searchType: 'vector',
        };
      } catch (error) {
        diagnostics.tests.search = { success: false, error: error.message };
      }

      // Stats test
      try {
        const stats = await this.getStats(userId);
        diagnostics.tests.stats = { success: true, ...stats };
      } catch (error) {
        diagnostics.tests.stats = { success: false, error: error.message };
      }

      const successfulTests = Object.values(diagnostics.tests).filter(t => t.success).length;
      const totalTests = Object.keys(diagnostics.tests).length;

      diagnostics.health = {
        score: (successfulTests / totalTests) * 100,
        status:
          successfulTests === totalTests
            ? 'healthy'
            : successfulTests > totalTests / 2
            ? 'partial'
            : 'unhealthy',
        mode: 'openai-file-search',
        features: {
          fileStorage: true,
          vectorSearch: true,
          openAIIntegration: true,
        },
        recommendations: [],
      };

      if (!diagnostics.tests.connectivity?.success) {
        diagnostics.health.recommendations.push('Check OpenAI API key and network connection');
      }
      if (!diagnostics.tests.search?.success) {
        diagnostics.health.recommendations.push('Upload documents to enable search');
      }
      if (diagnostics.health.status === 'healthy') {
        diagnostics.health.recommendations.push('System working well with OpenAI file search');
      }

      return diagnostics;
    } catch (error) {
      console.error('Error running diagnostics:', error);
      return {
        timestamp: new Date().toISOString(),
        mode: 'openai-file-search',
        health: {
          score: 0,
          status: 'error',
          error: error.message,
        },
      };
    }
  }

  async testUpload(userId) {
    try {
      const backendName = this.isNeonBackend() ? 'Neon RAG System' : 'OpenAI File Search RAG System';
      const uploadDescription = this.isNeonBackend()
        ? 'Neon PostgreSQL upload functionality'
        : 'OpenAI file-search upload functionality';
      const testContent = `Test Document for ${backendName}

This is a test document to verify the ${uploadDescription}.`;
      const testFile = new File([testContent], `${this.isNeonBackend() ? 'neon' : 'openai'}-rag-test.txt`, { type: 'text/plain' });

      const result = await this.uploadDocument(testFile, {
        category: 'test',
        tags: ['test', this.isNeonBackend() ? 'neon-postgresql' : 'openai-file-search'],
        testDocument: true,
        description: `Test document for ${backendName.toLowerCase()}`,

      }, userId);

      return {
        success: true,
        uploadResult: result,
        message: 'Test upload completed successfully',
      };
    } catch (error) {
      console.error('Test upload failed:', error);
      return {
        success: false,
        error: error.message,
        message: 'Test upload failed',
      };
    }
  }

  async testSearch(userId) {
    try {
      const result = await this.generateRAGResponse('GMP quality manufacturing validation compliance', userId);
      return {
        success: true,
        searchResult: result,
        message: `Search test completed - found ${result.sources?.length || 0} sources`,
      };
    } catch (error) {
      console.error('Test search failed:', error);
      return {
        success: false,
        error: error.message,
        message: 'Test search failed',
      };
    }
  }
}

const ragService = new RAGService();
export default ragService;

export const uploadDocument = (file, metadata, userId) => ragService.uploadDocument(file, metadata, userId);
export const search = (query, userId, options = {}) => ragService.search(query, userId, options);
export const searchDocuments = (query, options = {}, userId) => ragService.searchDocuments(query, options, userId);
export const getDocuments = (userId) => ragService.getDocuments(userId);
export const deleteDocument = (documentId, userId) => ragService.deleteDocument(documentId, userId);
export const generateRAGResponse = (query, userId, options = {}) => ragService.generateRAGResponse(query, userId, options);
export const testConnection = (userId) => ragService.testConnection(userId);
export const getStats = (userId) => ragService.getStats(userId);
export const runDiagnostics = (userId) => ragService.runDiagnostics(userId);

export const testUpload = (userId) => ragService.testUpload(userId);
export const testSearch = (userId) => ragService.testSearch(userId);
