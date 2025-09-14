// src/services/ragService.js - RAG service using OpenAI file search APIs
import openaiService from './openaiService';
import { getCurrentModel } from '../config/modelConfig';

class RAGService {
  constructor() {
    this.apiUrl = openaiService.baseUrl;
    this.vectorStoreId = null;
  }

  async getVectorStoreId() {
    if (this.vectorStoreId) return this.vectorStoreId;
    this.vectorStoreId = localStorage.getItem('openai_vector_store_id');
    if (!this.vectorStoreId) {
      this.vectorStoreId = await openaiService.createVectorStore();
      localStorage.setItem('openai_vector_store_id', this.vectorStoreId);
    }
    return this.vectorStoreId;
  }

  async testConnection() {
    try {
      await openaiService.makeRequest('/files', {
        method: 'GET',
        headers: { 'OpenAI-Beta': 'assistants=v2' },
      });
      return {
        success: true,
        recommendation: 'OpenAI file search API reachable.',
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

  async uploadDocument(file, metadata = {}) {
    if (!file) throw new Error('File is required');

    const fileId = await openaiService.uploadFile(file);
    const vectorStoreId = await this.getVectorStoreId();
    await openaiService.attachFileToVectorStore(vectorStoreId, fileId);

    return {
      fileId,
      vectorStoreId,
      metadata: {
        uploadedAt: new Date().toISOString(),
        processingMode: 'openai-file-search',
        ...metadata,
      },
    };
  }

  async getDocuments() {
    const data = await openaiService.makeRequest('/files', {
      method: 'GET',
      headers: { 'OpenAI-Beta': 'assistants=v2' },
    });
    return data.data || [];
  }

  async deleteDocument(documentId) {
    await openaiService.makeRequest(`/files/${documentId}`, {
      method: 'DELETE',
      headers: { 'OpenAI-Beta': 'assistants=v2' },
    });
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

  async searchDocuments(query, options = {}) {
    if (!query || !query.trim()) throw new Error('Search query is required');
    const vectorStoreId = await this.getVectorStoreId();

    const result = await openaiService.makeRequest(`/vector_stores/${vectorStoreId}/search`, {
      headers: {
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2',
      },
      body: JSON.stringify({ query: query.trim(), limit: options.limit || 10 }),
    });

    return result;
  }

  async generateRAGResponse(query) {
    const vectorStoreId = await this.getVectorStoreId();

    const body = {
      model: getCurrentModel(),
      input: query,
      tools: [{ type: 'file_search', vector_store_ids: [vectorStoreId] }],
    };

    const data = await openaiService.makeRequest('/responses', {
      headers: { 'OpenAI-Beta': 'assistants=v2' },
      body: JSON.stringify(body),
    });

    const answer =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      '';

    const annotations = [];
    const contentItems = data.output?.[0]?.content || [];
    contentItems.forEach(item => {
      if (Array.isArray(item.annotations)) annotations.push(...item.annotations);
    });

    return {
      answer,
      sources: annotations,
      ragMetadata: {
        totalSources: annotations.length,
        processingMode: 'openai-file-search',
      },
    };
  }

  async search(query, options = {}) {
    try {
      const response = await this.generateRAGResponse(query, options);
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

  async getStats() {
    const documents = await this.getDocuments();
    return { totalDocuments: documents.length };
  }

  async runDiagnostics() {
    try {
      const diagnostics = {
        timestamp: new Date().toISOString(),
        mode: 'openai-file-search',
        tests: {},
      };

      // Connectivity test
      try {
        const connectionTest = await this.testConnection();
        diagnostics.tests.connectivity = connectionTest;
      } catch (error) {
        diagnostics.tests.connectivity = { success: false, error: error.message };
      }

      // Document listing test
      try {
        const documents = await this.getDocuments();
        diagnostics.tests.documentListing = { success: true, documentCount: documents.length };
      } catch (error) {
        diagnostics.tests.documentListing = { success: false, error: error.message };
      }

      // Vector search test
      try {
        const searchResult = await this.searchDocuments('pharmaceutical quality gmp', { limit: 3 });
        diagnostics.tests.search = {
          success: true,
          resultsFound: searchResult?.data?.length || 0,
          searchType: 'vector',
        };
      } catch (error) {
        diagnostics.tests.search = { success: false, error: error.message };
      }

      // Stats test
      try {
        const stats = await this.getStats();
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

  async testUpload() {
    try {
      const testContent = `Test Document for OpenAI File Search RAG System

This is a test document to verify the OpenAI file-search upload functionality.`;
      const testFile = new File([testContent], 'openai-file-search-test.txt', { type: 'text/plain' });

      const result = await this.uploadDocument(testFile, {
        category: 'test',
        tags: ['test', 'openai-file-search'],
        testDocument: true,
        description: 'Test document for OpenAI file search RAG system',
      });

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

  async testSearch() {
    try {
      const result = await this.generateRAGResponse('GMP quality manufacturing validation compliance');
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

export const uploadDocument = (file, metadata) => ragService.uploadDocument(file, metadata);
export const search = (query, options = {}) => ragService.search(query, options);
export const searchDocuments = (query, options = {}) => ragService.searchDocuments(query, options);
export const getDocuments = () => ragService.getDocuments();
export const deleteDocument = (documentId) => ragService.deleteDocument(documentId);
export const generateRAGResponse = (query) => ragService.generateRAGResponse(query);
export const testConnection = () => ragService.testConnection();
export const getStats = () => ragService.getStats();
export const runDiagnostics = () => ragService.runDiagnostics();
export const testUpload = () => ragService.testUpload();
export const testSearch = () => ragService.testSearch();
