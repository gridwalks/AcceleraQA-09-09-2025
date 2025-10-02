// src/services/ragService.js - RAG service using OpenAI file search APIs
import openaiService from './openaiService';
import authService, { getToken, getUserId } from './authService';
import { getCurrentModel } from '../config/modelConfig';
import { RAG_BACKEND, RAG_BACKENDS, NEON_RAG_FUNCTION, RAG_DOCS_FUNCTION } from '../config/ragConfig';
import { convertDocxToPdfIfNeeded } from '../utils/fileConversion';

let pdfJsLoaderOverride = null;
let cachedPdfJsLoaderPromise = null;

const loadPdfJs = async () => {
  if (pdfJsLoaderOverride) {
    return typeof pdfJsLoaderOverride === 'function'
      ? await pdfJsLoaderOverride()
      : pdfJsLoaderOverride;
  }

  if (!cachedPdfJsLoaderPromise) {
    cachedPdfJsLoaderPromise = (async () => {
      const [pdfCore, workerModule] = await Promise.all([
        import('pdfjs-dist/build/pdf'),
        import('pdfjs-dist/build/pdf.worker.entry'),
      ]);

      const { GlobalWorkerOptions } = pdfCore;
      const workerSrc = workerModule?.default || workerModule;
      if (GlobalWorkerOptions && workerSrc && !GlobalWorkerOptions.workerSrc) {
        GlobalWorkerOptions.workerSrc = workerSrc;
      }

      if (typeof pdfCore.getDocument !== 'function') {
        throw new Error('PDF.js failed to expose getDocument');
      }

      return pdfCore;
    })();
  }

  return cachedPdfJsLoaderPromise;
};

export const __setPdfJsLoaderOverride = (loader) => {
  pdfJsLoaderOverride = loader;
  cachedPdfJsLoaderPromise = null;
};

const MAX_PERSISTED_CONTENT_BYTES = 6 * 1024 * 1024; // 6 MB raw capture limit

const DEFAULT_NEON_ENDPOINTS = Array.from(new Set([
  NEON_RAG_FUNCTION,
  '/.netlify/functions/neon-rag-fixed',
]));

const getFirstNonEmptyString = (...values) => {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return '';
};

const formatConversationHistoryForPrompt = (history, { maxTurns = 6 } = {}) => {
  if (!Array.isArray(history) || history.length === 0) {
    return '';
  }

  const normalizedTurns = history
    .map(turn => {
      if (!turn || typeof turn !== 'object') {
        return null;
      }

      const role = typeof turn.role === 'string' ? turn.role.trim().toLowerCase() : '';
      const content = typeof turn.content === 'string' ? turn.content.trim() : '';

      if (!content || (role !== 'user' && role !== 'assistant')) {
        return null;
      }

      const roleLabel = role === 'assistant' ? 'Assistant' : 'User';
      return { roleLabel, content };
    })
    .filter(Boolean);

  if (normalizedTurns.length === 0) {
    return '';
  }

  const recentTurns = normalizedTurns.slice(-Math.max(1, maxTurns));
  return recentTurns.map(turn => `${turn.roleLabel}: ${turn.content}`).join('\n');
};

const toFiniteNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const metadataIndicatesGlobalSharing = (metadata) => {
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }

  const sharedKeys = ['sharedWithAllUsers', 'shared_with_all_users'];
  if (
    sharedKeys.some(key => {
      const value = metadata[key];
      if (value === true) return true;
      if (typeof value === 'string' && value.trim().toLowerCase() === 'true') return true;
      return false;
    })
  ) {
    return true;
  }

  const visibility = typeof metadata.visibility === 'string' ? metadata.visibility.trim().toLowerCase() : '';
  if (visibility && ['global', 'public', 'everyone', 'all'].includes(visibility)) {
    return true;
  }

  const audience = typeof metadata.audience === 'string' ? metadata.audience.trim().toLowerCase() : '';
  if (audience && ['all', 'everyone', 'global'].includes(audience)) {
    return true;
  }

  return false;
};

const documentHasPersistentStorage = (document) => {
  if (!document || typeof document !== 'object') {
    return false;
  }

  const storageCandidates = [];

  if (document.storageLocation && typeof document.storageLocation === 'object') {
    storageCandidates.push(document.storageLocation);
  }

  if (document.metadata && typeof document.metadata === 'object') {
    const metadataStorage = document.metadata.storage;
    if (metadataStorage && typeof metadataStorage === 'object') {
      storageCandidates.push(metadataStorage);
    }
  }

  return storageCandidates.some(storage => Object.keys(storage).length > 0);
};

const extractAnnotationIndex = (annotation, key) => {
  if (!annotation || typeof annotation !== 'object') {
    return null;
  }

  const keyVariants = new Set([key]);

  if (key.includes('_')) {
    keyVariants.add(key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()));
  } else {
    keyVariants.add(key.replace(/([A-Z])/g, '_$1').toLowerCase());
  }

  if (key.startsWith('start')) {
    keyVariants.add('start');
    keyVariants.add('offset');
  }

  if (key.startsWith('end')) {
    keyVariants.add('end');
    keyVariants.add('stop');
  }

  const candidateObjects = [
    annotation,
    typeof annotation.text === 'object' ? annotation.text : null,
    typeof annotation.file_citation === 'object' ? annotation.file_citation : null,
    typeof annotation.metadata === 'object' ? annotation.metadata : null,
  ].filter(Boolean);

  for (const candidate of candidateObjects) {
    for (const variant of keyVariants) {
      const candidateValue = candidate[variant];
      const numberValue = toFiniteNumber(candidateValue);
      if (numberValue != null) {
        return numberValue;
      }
    }
  }

  return null;
};

const getTextFromContentItem = (item) => {
  if (!item) {
    return '';
  }

  if (typeof item === 'string') {
    return item;
  }

  if (typeof item.text === 'string') {
    return item.text;
  }

  if (typeof item.text?.value === 'string') {
    return item.text.value;
  }

  if (Array.isArray(item.text)) {
    return item.text
      .map(part => getTextFromContentItem(part))
      .filter(Boolean)
      .join('\n');
  }

  return '';
};

const insertCitationsIntoText = (text, annotations, annotationMetadataMap) => {
  if (typeof text !== 'string' || !text.trim()) {
    return text;
  }

  const validAnnotations = Array.isArray(annotations) ? annotations : [];
  const insertionMap = new Map();

  validAnnotations.forEach(annotation => {
    const metadata = annotationMetadataMap.get(annotation);
    if (!metadata || typeof metadata.citationNumber !== 'number') {
      return;
    }

    const startIndex = toFiniteNumber(metadata.startIndex);
    const endIndex = toFiniteNumber(metadata.endIndex);
    let insertionPoint = endIndex != null ? endIndex : startIndex != null ? startIndex : text.length;

    if (!Number.isFinite(insertionPoint)) {
      insertionPoint = text.length;
    }

    const clampedPoint = Math.max(0, Math.min(text.length, insertionPoint));

    if (!insertionMap.has(clampedPoint)) {
      insertionMap.set(clampedPoint, new Set());
    }

    insertionMap.get(clampedPoint).add(metadata.citationNumber);
  });

  if (insertionMap.size === 0) {
    return text;
  }

  const sortedPositions = Array.from(insertionMap.keys()).sort((a, b) => a - b);
  let result = '';
  let cursor = 0;

  sortedPositions.forEach(position => {
    const normalizedPosition = Math.max(0, Math.min(text.length, position));
    const targetPosition = normalizedPosition < cursor ? cursor : normalizedPosition;

    if (targetPosition > cursor) {
      result += text.slice(cursor, targetPosition);
      cursor = targetPosition;
    }

    const citations = Array.from(insertionMap.get(position)).sort((a, b) => a - b);
    const citationMarkers = citations.map(number => `[${number}]`).join('');
    result += citationMarkers;
  });

  if (cursor < text.length) {
    result += text.slice(cursor);
  }

  return result;
};

const deduplicateText = (text) => {
  if (typeof text !== 'string') {
    return text;
  }

  // Split by common sentence boundaries and check for duplicates
  const sentences = text.split(/(?<=[.!?])\s+/);
  const seenSentences = new Set();
  const uniqueSentences = [];

  sentences.forEach(sentence => {
    const trimmed = sentence.trim();
    if (trimmed && !seenSentences.has(trimmed)) {
      seenSentences.add(trimmed);
      uniqueSentences.push(trimmed);
    }
  });

  return uniqueSentences.join(' ');
};

const appendReferencesSection = (answerText, sources) => {
  if (typeof answerText !== 'string') {
    return answerText;
  }

  const normalizedSources = Array.isArray(sources) ? sources : [];
  if (normalizedSources.length === 0) {
    return answerText;
  }

  const referenceEntries = [];
  const seenNumbers = new Set();

  normalizedSources.forEach((source, index) => {
    const citationNumber = typeof source?.citationNumber === 'number'
      ? source.citationNumber
      : typeof source?.metadata?.citationNumber === 'number'
        ? source.metadata.citationNumber
        : index + 1;

    if (seenNumbers.has(citationNumber)) {
      return;
    }

    seenNumbers.add(citationNumber);

    const title = getFirstNonEmptyString(
      source?.title,
      source?.documentTitle,
      source?.metadata?.documentTitle,
      source?.filename,
      `Document ${citationNumber}`
    );

    referenceEntries.push({ citationNumber, title });
  });

  if (referenceEntries.length === 0) {
    return answerText;
  }

  referenceEntries.sort((a, b) => a.citationNumber - b.citationNumber);

  const hasExistingSection = /(?:References|Sources)\s*:/i.test(answerText);
  if (hasExistingSection) {
    return answerText;
  }

  const referenceLines = referenceEntries.map(entry => `[${entry.citationNumber}] ${entry.title}`);

  return `${answerText.trim()}\n\nReferences:\n${referenceLines.join('\n')}`.trim();
};

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
    this.documentMetadataCache = new Map();
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

    const textFields = ['fileName', 'fileTitle', 'title', 'description', 'summary', 'category', 'version'];

    textFields.forEach(field => {
      if (typeof sanitized[field] === 'string') {
        sanitized[field] = sanitized[field].trim();
        if (!sanitized[field]) {
          delete sanitized[field];
        }
      }
    });

    if (sanitized.summary && !sanitized.description) {
      sanitized.description = sanitized.summary;
    }

    if (sanitized.description && !sanitized.summary) {
      sanitized.summary = sanitized.description;
    }

    const resolvedTitle = getFirstNonEmptyString(
      sanitized.title,
      sanitized.fileTitle,
      sanitized.documentTitle,
      sanitized.displayTitle,
    );

    if (resolvedTitle) {
      if (!sanitized.title) {
        sanitized.title = resolvedTitle;
      }
      if (!sanitized.fileTitle) {
        sanitized.fileTitle = resolvedTitle;
      }
      if (!sanitized.documentTitle) {
        sanitized.documentTitle = resolvedTitle;
      }
      if (!sanitized.displayTitle) {
        sanitized.displayTitle = resolvedTitle;
      }
    }

    if (!sanitized.fileName) {
      const fallbackFileName = getFirstNonEmptyString(
        sanitized.filename,
        sanitized.file_name,
        sanitized.name,
      );
      if (fallbackFileName) {
        sanitized.fileName = fallbackFileName;
      }
    }

    return sanitized;
  }

  prepareMetadataUpdate(metadata = {}) {
    const editableFields = ['title', 'description', 'category', 'version', 'tags'];
    const sanitizedMetadata = {};
    const clearFields = new Set();

    if (!metadata || typeof metadata !== 'object') {
      return { sanitizedMetadata, clearFields: [] };
    }

    editableFields.forEach(field => {
      if (!(field in metadata)) {
        return;
      }

      const value = metadata[field];

      if (field === 'tags') {
        if (Array.isArray(value)) {
          const normalizedTags = value
            .map(tag => (typeof tag === 'string' ? tag.trim() : ''))
            .filter(Boolean);
          if (normalizedTags.length) {
            sanitizedMetadata.tags = normalizedTags;
          } else {
            clearFields.add('tags');
          }
          return;
        }

        if (typeof value === 'string') {
          const normalizedTags = value
            .split(',')
            .map(tag => tag.trim())
            .filter(tag => tag);
          if (normalizedTags.length) {
            sanitizedMetadata.tags = normalizedTags;
          } else {
            clearFields.add('tags');
          }
          return;
        }

        if (value == null) {
          clearFields.add('tags');
        }
        return;
      }

      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          sanitizedMetadata[field] = trimmed;
        } else {
          clearFields.add(field);
        }
        return;
      }

      if (value == null) {
        clearFields.add(field);
        return;
      }

      sanitizedMetadata[field] = value;
    });

    return { sanitizedMetadata, clearFields: Array.from(clearFields) };
  }

  async captureBlobContent(blob) {
    if (!blob || typeof blob.arrayBuffer !== 'function') {
      return null;
    }

    try {
      const arrayBuffer = await blob.arrayBuffer();
      const byteLength = arrayBuffer?.byteLength ?? 0;

      if (byteLength === 0) {
        return { base64: '', byteLength: 0 };
      }

      if (byteLength > MAX_PERSISTED_CONTENT_BYTES) {
        console.warn('Skipping inline document content persistence because the file exceeds the capture size limit.');
        return null;
      }

      if (typeof Buffer !== 'undefined') {
        return { base64: Buffer.from(arrayBuffer).toString('base64'), byteLength };
      }

      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      const chunkSize = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, offset + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
      }

      if (typeof btoa === 'function') {
        return { base64: btoa(binary), byteLength };
      }

      console.warn('Unable to encode blob content because no Base64 encoder is available in this environment.');
      return null;
    } catch (error) {
      console.warn('Failed to capture uploaded document content for persistence:', error);
      return null;
    }
  }

  clearDocumentMetadataCache(userId) {
    if (!userId) {
      return;
    }
    this.documentMetadataCache.delete(userId);
  }

  buildDocumentMetadataLookup(documents = []) {
    const lookup = new Map();

    documents.forEach(doc => {
      if (!doc) {
        return;
      }

      const metadata = doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {};
      const rawTitle = typeof metadata.title === 'string' ? metadata.title.trim() : '';
      const filename = typeof doc.filename === 'string' ? doc.filename.trim() : '';
      const entry = {
        document: doc,
        title: rawTitle,
        filename,
        displayTitle: rawTitle || filename,
      };

      const keys = [doc.id, doc.documentId, doc.fileId, doc.file_id]
        .map(value => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean);

      if (keys.length === 0 && filename) {
        keys.push(filename);
      }

      keys.forEach(key => {
        if (!lookup.has(key)) {
          lookup.set(key, entry);
        }
      });
    });

    return lookup;
  }

  async getDocumentMetadataLookup(userId, { forceRefresh = false } = {}) {
    if (!userId || this.isNeonBackend()) {
      return new Map();
    }

    const cached = this.documentMetadataCache.get(userId);
    if (cached && !forceRefresh) {
      return cached.lookup;
    }

    try {
      const documents = await this.getDocuments(userId);
      const lookup = this.buildDocumentMetadataLookup(documents);
      this.documentMetadataCache.set(userId, {
        lookup,
        documents,
        timestamp: Date.now(),
      });
      return lookup;
    } catch (error) {
      console.warn('Failed to refresh document metadata cache:', error);
      if (cached?.lookup) {
        return cached.lookup;
      }
      return new Map();
    }
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
          let errorDetails;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorData.message || errorMessage;
            if (errorData && typeof errorData === 'object' && errorData.details) {
              errorDetails = errorData.details;
            }
          } catch (parseError) {
            console.warn('Failed to parse Neon error response:', parseError);
          }

          const requestError = new Error(errorMessage);
          requestError.statusCode = response.status;
          if (errorDetails) {
            requestError.details = errorDetails;
          }
          throw requestError;
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

    try {
      const user = await authService.getUser();
      const roles = Array.isArray(user?.roles)
        ? user.roles
            .map(role => (typeof role === 'string' ? role.trim() : ''))
            .filter(Boolean)
        : [];

      if (roles.length > 0) {
        headers['x-user-roles'] = roles.join(',');
      }

      if (typeof user?.organization === 'string' && user.organization.trim()) {
        headers['x-user-organization'] = user.organization.trim();
      }
    } catch (roleError) {
      console.warn('Unable to resolve user context for document metadata request:', roleError);
    }

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

      // Convert file to PDF if needed for Neon backend
      const {
        file: convertedFile,
        converted,
        originalFileName,
        originalMimeType,
        conversion: conversionType,
      } = await convertDocxToPdfIfNeeded(file);

      const textContent = await this.extractTextFromFile(convertedFile);
      const baseMetadata = {
        ...sanitizedMetadata,
      };

      const normalizedTitle = getFirstNonEmptyString(
        baseMetadata.title,
        baseMetadata.fileTitle,
        baseMetadata.documentTitle,
        baseMetadata.displayTitle,
        file.name,
      );

      const normalizedSummary = getFirstNonEmptyString(
        baseMetadata.summary,
        baseMetadata.description,
      );

      const normalizedVersion = getFirstNonEmptyString(
        baseMetadata.version,
        baseMetadata.documentVersion,
      );

      if (normalizedTitle) {
        baseMetadata.title = baseMetadata.title || normalizedTitle;
        baseMetadata.fileTitle = baseMetadata.fileTitle || normalizedTitle;
        baseMetadata.documentTitle = baseMetadata.documentTitle || normalizedTitle;
        baseMetadata.displayTitle = baseMetadata.displayTitle || normalizedTitle;
      }

      if (normalizedSummary) {
        baseMetadata.summary = baseMetadata.summary || normalizedSummary;
        baseMetadata.description = baseMetadata.description || normalizedSummary;
      }

      if (normalizedVersion) {
        baseMetadata.version = baseMetadata.version || normalizedVersion;
      }

      baseMetadata.fileName = baseMetadata.fileName || convertedFile.name;

      // Add conversion metadata if file was converted
      if (converted) {
        baseMetadata.originalFilename = originalFileName;
        baseMetadata.originalMimeType = originalMimeType;
        baseMetadata.conversion = conversionType;
        baseMetadata.converted = true;
      }

      const capturedContent = await this.captureBlobContent(convertedFile);

      const documentPayload = {
        filename: convertedFile.name,
        size: convertedFile.size,
        type: convertedFile.type,
        text: textContent,
        metadata: {
          processingMode: 'neon-postgresql',
          ...baseMetadata,
        },
      };

      if (capturedContent && typeof capturedContent.base64 === 'string') {
        documentPayload.content = capturedContent.base64;
        documentPayload.encoding = 'base64';
        if (!Number.isFinite(documentPayload.size) && typeof capturedContent.byteLength === 'number') {
          documentPayload.size = capturedContent.byteLength;
        }
      }

      if (normalizedTitle) {
        documentPayload.title = normalizedTitle;
      }

      if (normalizedSummary) {
        documentPayload.summary = normalizedSummary;
      }

      if (normalizedVersion) {
        documentPayload.version = normalizedVersion;
      }

      const response = await this.makeNeonRequest('upload', userId, {
        document: documentPayload,
      });

      if (userId) {
        this.clearDocumentMetadataCache(userId);
      }

      const persistedDocument =
        response?.document && typeof response.document === 'object'
          ? response.document
          : null;

      const persistedMetadata =
        persistedDocument?.metadata && typeof persistedDocument.metadata === 'object'
          ? persistedDocument.metadata
          : documentPayload.metadata;

      const storageLocation =
        response?.storageLocation ||
        persistedDocument?.storageLocation ||
        (persistedMetadata?.storage && typeof persistedMetadata.storage === 'object'
          ? persistedMetadata.storage
          : null);

      if (storageLocation && persistedMetadata && typeof persistedMetadata === 'object') {
        persistedMetadata.storage = storageLocation;
      }

      return {
        ...response,
        document: persistedDocument || {
          ...documentPayload,
          metadata: documentPayload.metadata,
        },
        metadata: persistedMetadata,
        storageLocation,
        storage: storageLocation?.provider || 'neon-postgresql',
      };
    }

    const {
      file: uploadableFile,
      converted,
      originalFileName,
      originalMimeType,
      conversion: conversionType,
    } = await this.convertDocxToPdfIfNeeded(file);
    const fileId = await openaiService.uploadFile(uploadableFile);
    const vectorStoreId = await this.getVectorStoreId(userId);
    await openaiService.attachFileToVectorStore(vectorStoreId, fileId);

    const capturedContent = await this.captureBlobContent(uploadableFile);

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
              conversion: conversionType || 'file-to-pdf',
            }
          : {}),
        ...sanitizedMetadata,
      },
      vectorStoreId,
    };

    if (capturedContent && typeof capturedContent.base64 === 'string') {
      docInfo.content = capturedContent.base64;
      docInfo.encoding = 'base64';

      if (!Number.isFinite(Number(docInfo.size)) && typeof capturedContent.byteLength === 'number') {
        docInfo.size = capturedContent.byteLength;
      }
    }

    let savedDocument = docInfo;
    let metadataResponse;
    try {
      metadataResponse = await this.makeDocumentMetadataRequest('save_document', userId, {
        document: docInfo,
        vectorStoreId,
      });
      savedDocument = metadataResponse?.document || docInfo;
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

    if (userId) {
      this.clearDocumentMetadataCache(userId);
    }

    const storageLocation =
      metadataResponse?.storageLocation ||
      savedDocument?.storageLocation ||
      (savedDocument?.metadata && typeof savedDocument.metadata === 'object' && savedDocument.metadata.storage
        ? savedDocument.metadata.storage
        : null);

    if (storageLocation && savedDocument?.metadata && typeof savedDocument.metadata === 'object') {
      savedDocument.metadata.storage = storageLocation;
    }

    return {
      fileId,
      vectorStoreId,
      metadata: savedDocument?.metadata || docInfo.metadata,
      document: savedDocument,
      storageLocation,
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

    let syncedDocuments = documents;
    try {
      const data = await openaiService.makeRequest('/files', {
        method: 'GET',
        headers: { 'OpenAI-Beta': 'assistants=v2' },
      });
      const ids = new Set((data.data || []).map(f => f.id));
      const shouldRetainWithoutOpenAI = (doc) => {
        if (!doc || typeof doc !== 'object') {
          return false;
        }

        if (metadataIndicatesGlobalSharing(doc.metadata)) {
          return true;
        }

        if (documentHasPersistentStorage(doc)) {
          return true;
        }

        return false;
      };

      syncedDocuments = documents.filter(doc => ids.has(doc.id) || shouldRetainWithoutOpenAI(doc));

      if (syncedDocuments.length !== documents.length) {
        const missingDocuments = documents.filter(doc => !ids.has(doc.id) && !shouldRetainWithoutOpenAI(doc));
        await Promise.all(
          missingDocuments.map(doc =>
            this.makeDocumentMetadataRequest('delete_document', resolvedUserId, { documentId: doc.id }).catch(syncError => {
              console.warn('Failed to prune missing document metadata:', syncError);
            })
          )
        );
      }
    } catch (error) {
      console.warn('Failed to synchronize document metadata with OpenAI:', error);
      syncedDocuments = documents;
    }

    const normalizedDocuments = Array.isArray(syncedDocuments) ? syncedDocuments : [];
    this.documentMetadataCache.set(resolvedUserId, {
      lookup: this.buildDocumentMetadataLookup(normalizedDocuments),
      documents: normalizedDocuments,
      timestamp: Date.now(),
    });

    return normalizedDocuments;
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
    this.clearDocumentMetadataCache(resolvedUserId);
    return { success: true };
  }

  async updateDocumentMetadata(documentId, metadataUpdates = {}, userId) {
    if (!documentId) {
      throw new Error('documentId is required to update metadata');
    }

    const resolvedUserId = userId || (await getUserId());
    if (!resolvedUserId) {
      throw new Error('User ID is required to update document metadata');
    }

    const { sanitizedMetadata, clearFields } = this.prepareMetadataUpdate(metadataUpdates || {});
    const payload = { documentId, metadata: sanitizedMetadata };

    if (clearFields.length > 0) {
      payload.clearFields = clearFields;
    }

    if (this.isNeonBackend()) {
      const response = await this.makeNeonRequest('update_metadata', resolvedUserId, payload);
      const updatedDocument = response?.document;

      if (!updatedDocument) {
        const errorMessage = response?.error || 'Failed to update document metadata';
        throw new Error(errorMessage);
      }

      this.clearDocumentMetadataCache(resolvedUserId);
      return updatedDocument;
    }

    const response = await this.makeDocumentMetadataRequest('update_document', resolvedUserId, payload);
    const updatedDocument = response?.document;

    if (!updatedDocument) {
      throw new Error('Failed to update document metadata');
    }

    this.clearDocumentMetadataCache(resolvedUserId);
    return updatedDocument;
  }

  async downloadDocument(documentReference, userId) {
    const reference =
      typeof documentReference === 'string'
        ? { documentId: documentReference }
        : { ...(documentReference || {}) };

    const documentId = typeof reference.documentId === 'string' ? reference.documentId.trim() : '';
    const fileId = typeof reference.fileId === 'string' ? reference.fileId.trim() : '';

    if (!documentId && !fileId) {
      throw new Error('documentId or fileId is required to download a document');
    }

    return await this.makeDocumentMetadataRequest('download_document', userId, {
      ...(documentId ? { documentId } : {}),
      ...(fileId ? { fileId } : {}),
    });
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
        const pdfBytes = new Uint8Array(arrayBuffer.slice(0));

        if (!pdfBytes.length) {
          return '';
        }

        const pdfCore = await loadPdfJs();
        const loadingTask = pdfCore.getDocument({ data: pdfBytes });
        if (!loadingTask || typeof loadingTask.promise?.then !== 'function') {
          throw new Error('PDF.js did not return a loading task');
        }

        const pdfDocument = await loadingTask.promise;
        try {
          const pageTexts = [];
          for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
            // eslint-disable-next-line no-await-in-loop
            const page = await pdfDocument.getPage(pageNumber);
            // eslint-disable-next-line no-await-in-loop
            const textContent = await page.getTextContent();
            const strings = (textContent?.items || [])
              .map(item => (typeof item.str === 'string' ? item.str : ''))
              .filter(Boolean);
            pageTexts.push(strings.join(' '));
            page.cleanup?.();
          }

          return pageTexts.join('\n').trim();
        } finally {
          try {
            pdfDocument.cleanup?.();
            pdfDocument.destroy?.();
          } catch (cleanupError) {
            console.warn('Failed to clean up PDF document after text extraction:', cleanupError);
          }
        }
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

  async generateRAGResponse(query, userId, options = {}, conversationHistory = []) {
    if (this.isNeonBackend()) {
      return this.generateNeonRagResponse(query, userId, options, conversationHistory);
    }


    const trimmedQuery = typeof query === 'string' ? query.trim() : '';
    if (!trimmedQuery) {
      throw new Error('Query is required to generate a response');
    }

    const normalizedHistory = Array.isArray(conversationHistory)
      ? conversationHistory
          .map(item => {
            if (!item || typeof item !== 'object') {
              return null;
            }

            const role = item.role === 'assistant' || item.role === 'user'
              ? item.role
              : item.type === 'ai'
                ? 'assistant'
                : item.type === 'user'
                  ? 'user'
                  : null;

            if (role !== 'assistant' && role !== 'user') {
              return null;
            }

            let textContent = '';

            if (typeof item.content === 'string') {
              textContent = item.content;
            } else if (Array.isArray(item.content)) {
              textContent = item.content
                .map(part => {
                  if (typeof part === 'string') {
                    return part;
                  }

                  if (part && typeof part === 'object') {
                    if (typeof part.text === 'string') {
                      return part.text;
                    }

                    if (typeof part.value === 'string') {
                      return part.value;
                    }
                  }

                  return '';
                })
                .filter(Boolean)
                .join(' ');
            } else if (item.content && typeof item.content === 'object') {
              if (typeof item.content.text === 'string') {
                textContent = item.content.text;
              } else if (typeof item.content.value === 'string') {
                textContent = item.content.value;
              }
            }

            const trimmedText = typeof textContent === 'string' ? textContent.trim() : '';

            if (!trimmedText) {
              return null;
            }

            return {
              role,
              content: [
                {
                  type: role === 'assistant' ? 'output_text' : 'input_text',
                  text: trimmedText,
                },
              ],
            };
          })
          .filter(Boolean)
      : [];

    const includeDefaultVectorStore = options?.includeDefaultVectorStore !== false;
    let defaultVectorStoreId = null;
    if (includeDefaultVectorStore) {
      defaultVectorStoreId = await this.getVectorStoreId(userId);
    }

    const providedVectorStoreIds = [];
    const optionVectorStores = options?.vectorStoreIds;
    if (Array.isArray(optionVectorStores)) {
      providedVectorStoreIds.push(...optionVectorStores);
    } else if (typeof optionVectorStores === 'string') {
      providedVectorStoreIds.push(optionVectorStores);
    }

    if (typeof options?.vectorStoreId === 'string') {
      providedVectorStoreIds.push(options.vectorStoreId);
    }

    const normalizedProvidedIds = providedVectorStoreIds
      .map(id => (typeof id === 'string' ? id.trim() : ''))
      .filter(Boolean);

    const combinedVectorStoreIds = Array.from(new Set([
      ...(includeDefaultVectorStore && defaultVectorStoreId ? [defaultVectorStoreId] : []),
      ...normalizedProvidedIds,
    ])).filter(Boolean);

    if (combinedVectorStoreIds.length === 0) {
      throw new Error('No vector store available for search');
    }

    const fileSearchTool = {
      type: 'file_search',
      vector_store_ids: combinedVectorStoreIds,
    };

    const body = {
      model: getCurrentModel(),
      input: [
        ...normalizedHistory,
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
      tools: [fileSearchTool],
    };

    const data = await openaiService.makeRequest('/responses', {
      body: JSON.stringify(body),
    });

    const outputMessages = Array.isArray(data.output) ? data.output : [];
    const contentItems = outputMessages.flatMap(message => message.content || []);

    const contentSegments = [];
    const annotations = [];

    const seenTexts = new Set();
    
    contentItems.forEach(item => {
      const textValue = getTextFromContentItem(item);
      const textAnnotations = Array.isArray(item?.text?.annotations) ? item.text.annotations : [];
      const additionalAnnotations = Array.isArray(item?.annotations) ? item.annotations : [];

      // Only add if we haven't seen this exact text before
      if (textValue && !seenTexts.has(textValue)) {
        seenTexts.add(textValue);
        contentSegments.push({ text: textValue, annotations: textAnnotations });
      }

      if (textAnnotations.length > 0) {
        annotations.push(...textAnnotations);
      }

      if (additionalAnnotations.length > 0) {
        annotations.push(...additionalAnnotations);
      }
    });

    const plainAnswerFromContent = contentSegments
      .map(segment => segment.text)
      .filter(Boolean)
      .join('\n')
      .trim();

    const outputTextFallback = typeof data.output_text === 'string' ? data.output_text.trim() : '';
    const normalizedAnnotations = annotations.filter(Boolean);

    const uniqueDocumentKeys = new Set();
    normalizedAnnotations.forEach(annotation => {
      const docKeys = [
        annotation?.metadata?.documentId,
        annotation?.file_citation?.file_id,
        annotation?.document?.id,
        annotation?.document?.file_id,
        annotation?.file_id,
        annotation?.document_id,
      ]
        .map(value => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean);

      docKeys.forEach(key => uniqueDocumentKeys.add(key));
    });

    let documentLookup = null;
    if (!this.isNeonBackend() && userId && uniqueDocumentKeys.size > 0) {
      try {
        documentLookup = await this.getDocumentMetadataLookup(userId);
      } catch (metadataError) {
        console.warn('Failed to load document metadata for resource enrichment:', metadataError);
      }
    }

    const annotationMetadataMap = new WeakMap();
    const uniqueSources = new Map();
    let nextCitationNumber = 1;

    normalizedAnnotations.forEach((annotation, index) => {
      const textSnippet = typeof annotation.text === 'string'
        ? annotation.text
        : typeof annotation?.file_citation?.quote === 'string'
          ? annotation.file_citation.quote
          : typeof annotation?.quote === 'string'
            ? annotation.quote
            : '';

      const docKeyCandidates = [
        annotation?.metadata?.documentId,
        annotation?.file_citation?.file_id,
        annotation?.document?.id,
        annotation?.document?.file_id,
        annotation?.file_id,
        annotation?.document_id,
      ]
        .map(value => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean);

      let metadataEntry = null;
      if (documentLookup) {
        for (const key of docKeyCandidates) {
          const entry = documentLookup.get(key);
          if (entry) {
            metadataEntry = entry;
            break;
          }
        }

        if (!metadataEntry) {
          const fallbackKeys = [
            annotation.filename,
            annotation.file_name,
            annotation?.document?.filename,
            annotation?.document?.file_name,
          ]
            .map(value => (typeof value === 'string' ? value.trim() : ''))
            .filter(Boolean);

          for (const key of fallbackKeys) {
            const entry = documentLookup.get(key);
            if (entry) {
              metadataEntry = entry;
              break;
            }
          }
        }
      }

      const metadataFilename = metadataEntry?.filename || '';
      const fallbackFilename =
        getFirstNonEmptyString(
          annotation.filename,
          annotation.file_name,
          annotation?.document?.filename,
          annotation?.document?.file_name,
          annotation?.file_citation?.filename,
          annotation?.file_citation?.file_name,
          metadataFilename,
          annotation?.file_citation?.file_id
        ) || `Document ${index + 1}`;

      const metadataTitleCandidate = getFirstNonEmptyString(
        metadataEntry?.title,
        metadataEntry?.displayTitle,
        metadataEntry?.document?.metadata?.title
      );

      const displayTitle =
        getFirstNonEmptyString(
          annotation.title,
          annotation?.document?.title,
          annotation?.file_citation?.title,
          annotation?.document?.metadata?.title,
          annotation.documentTitle,
          metadataTitleCandidate,
          fallbackFilename
        ) || fallbackFilename;

      const documentTitle =
        getFirstNonEmptyString(
          annotation.documentTitle,
          annotation?.document?.title,
          annotation?.document?.metadata?.title,
          metadataTitleCandidate,
          displayTitle
        ) || displayTitle;

      const sourceId =
        getFirstNonEmptyString(
          annotation.id,
          annotation?.file_citation?.file_id,
          annotation?.file_path,
          docKeyCandidates[0]
        ) || `source-${index}`;

      const chunkIndex =
        toFiniteNumber(annotation.chunkIndex) ??
        toFiniteNumber(annotation.chunk_index) ??
        toFiniteNumber(annotation?.file_citation?.chunkIndex) ??
        toFiniteNumber(annotation?.file_citation?.chunk_index);

      const baseMetadata =
        annotation.metadata && typeof annotation.metadata === 'object'
          ? { ...annotation.metadata }
          : {};

      const metadata = { ...baseMetadata };
      const metadataDocumentId =
        metadataEntry?.document?.id || docKeyCandidates[0] || metadata.documentId || null;

      if (metadataDocumentId) {
        metadata.documentId = metadataDocumentId;
      }

      if (typeof chunkIndex === 'number') {
        metadata.chunkIndex = chunkIndex;
      }

      const filenameForMetadata = metadataFilename || fallbackFilename;
      if (filenameForMetadata) {
        metadata.filename = filenameForMetadata;
      }

      if (!metadata.documentTitle && documentTitle) {
        metadata.documentTitle = documentTitle;
      }

      if (!metadata.fileId && metadataEntry?.document?.fileId) {
        metadata.fileId = metadataEntry.document.fileId;
      }

      if (!metadata.vectorStoreId && metadataEntry?.document?.vectorStoreId) {
        metadata.vectorStoreId = metadataEntry.document.vectorStoreId;
      }

      if (!metadata.documentMetadata && metadataEntry?.document?.metadata && typeof metadataEntry.document.metadata === 'object') {
        metadata.documentMetadata = { ...metadataEntry.document.metadata };
      }

      const normalizedSource = {
        ...annotation,
        id: sourceId,
        filename: fallbackFilename,
        title: displayTitle,
        documentTitle,
        text: textSnippet,
        metadata,
      };

      let sourceEntry = uniqueSources.get(sourceId);
      if (!sourceEntry) {
        const citationNumber = nextCitationNumber++;
        const metadataWithCitation = { ...metadata, citationNumber };
        sourceEntry = {
          ...normalizedSource,
          metadata: metadataWithCitation,
          citationNumber,
          snippets: textSnippet ? [textSnippet] : [],
        };
        uniqueSources.set(sourceId, sourceEntry);
      } else {
        if (textSnippet) {
          const snippetSet = new Set(sourceEntry.snippets || []);
          if (!snippetSet.has(textSnippet)) {
            snippetSet.add(textSnippet);
            sourceEntry.snippets = Array.from(snippetSet);
          }
          if (!sourceEntry.text) {
            sourceEntry.text = textSnippet;
          }
        }

        sourceEntry.metadata = {
          ...(sourceEntry.metadata || {}),
          ...(metadata || {}),
        };

        if (!sourceEntry.metadata.citationNumber) {
          sourceEntry.metadata.citationNumber = sourceEntry.citationNumber;
        }
      }

      const startIndex = extractAnnotationIndex(annotation, 'start_index');
      const endIndex = extractAnnotationIndex(annotation, 'end_index');

      annotationMetadataMap.set(annotation, {
        sourceId,
        citationNumber: sourceEntry.citationNumber,
        startIndex,
        endIndex,
      });
    });

    const sources = Array.from(uniqueSources.values()).map(sourceEntry => {
      const { snippets = [], metadata = {}, ...rest } = sourceEntry;
      const normalizedSnippets = Array.isArray(snippets)
        ? Array.from(new Set(snippets.filter(Boolean)))
        : [];
      const metadataWithSnippets = { ...(metadata || {}) };
      if (normalizedSnippets.length > 0 && !metadataWithSnippets.snippets) {
        metadataWithSnippets.snippets = normalizedSnippets;
      }
      return {
        ...rest,
        metadata: metadataWithSnippets,
      };
    });

    const answerWithCitations = contentSegments
      .map(segment => {
        if (!segment.text) {
          return null;
        }
        return insertCitationsIntoText(segment.text, segment.annotations, annotationMetadataMap);
      })
      .filter(Boolean)
      .join('\n')
      .trim();

    let answer = answerWithCitations || plainAnswerFromContent || outputTextFallback || 'The document search returned no results.';
    answer = deduplicateText(answer);
    answer = appendReferencesSection(answer, sources);

    return {
      answer,
      sources,
      ragMetadata: {
        totalSources: sources.length,
        processingMode: 'openai-file-search',
      },
    };
  }

  async generateNeonRagResponse(query, userId, options = {}, conversationHistory = []) {
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

    const formattedHistory = formatConversationHistoryForPrompt(conversationHistory);

    const promptSections = [
      'You are AcceleraQA, an expert assistant for pharmaceutical quality and compliance.',
      'Use only the provided document excerpts to answer the user question. Cite the document name when referencing a source.',
      'If the excerpts do not contain enough information, say so clearly.',
      '',
    ];

    if (formattedHistory) {
      promptSections.push('Relevant prior conversation:', formattedHistory, '');
    }

    promptSections.push(
      'Document excerpts:',
      contextSections,
      '',
      `Latest question: ${trimmedQuery}`,
      '',
      'Answer:'
    );

    const prompt = promptSections.join('\n');

    const aiResult = await openaiService.getChatResponse(prompt);
    const rawAnswer = typeof aiResult?.answer === 'string' ? aiResult.answer : '';
    const resources = aiResult?.resources || [];

    const sources = results.map((result, index) => {
      const citationNumber = index + 1;
      const baseMetadata = result.metadata && typeof result.metadata === 'object' ? { ...result.metadata } : {};

      if (!baseMetadata.documentTitle && result.documentTitle) {
        baseMetadata.documentTitle = result.documentTitle;
      }

      if (!baseMetadata.filename && result.filename) {
        baseMetadata.filename = result.filename;
      }

      if (typeof result.chunkIndex === 'number') {
        baseMetadata.chunkIndex = result.chunkIndex;
      }

      baseMetadata.citationNumber = citationNumber;

      return {
        ...result,
        sourceId: `${result.documentId}:${result.chunkIndex}`,
        index,
        citationNumber,
        metadata: baseMetadata,
      };
    });

    let answer = rawAnswer.trim() || 'No relevant guidance was generated from the provided excerpts.';
    answer = deduplicateText(answer);
    answer = appendReferencesSection(answer, sources);

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

  async search(query, userId, options = {}, conversationHistory = []) {
    try {
      const response = await this.generateRAGResponse(query, userId, options, conversationHistory);
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
export const search = (query, userId, options = {}, conversationHistory = []) =>
  ragService.search(query, userId, options, conversationHistory);
export const searchDocuments = (query, options = {}, userId) => ragService.searchDocuments(query, options, userId);
export const getDocuments = (userId) => ragService.getDocuments(userId);
export const deleteDocument = (documentId, userId) => ragService.deleteDocument(documentId, userId);
export const downloadDocument = (documentReference, userId) => ragService.downloadDocument(documentReference, userId);
export const generateRAGResponse = (query, userId, options = {}, conversationHistory = []) =>
  ragService.generateRAGResponse(query, userId, options, conversationHistory);
export const testConnection = (userId) => ragService.testConnection(userId);
export const getStats = (userId) => ragService.getStats(userId);
export const runDiagnostics = (userId) => ragService.runDiagnostics(userId);

export const testUpload = (userId) => ragService.testUpload(userId);
export const testSearch = (userId) => ragService.testSearch(userId);
