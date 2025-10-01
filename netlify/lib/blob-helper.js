import { getStore } from '@netlify/blobs';

let cachedPrefix = null;
let cachedStore = null;

const DEFAULT_PREFIX = 'rag-documents';
const DEFAULT_STORE = 'rag-documents';

const sanitizePathSegment = (value, fallback) => {
  if (typeof value !== 'string') return fallback;

  const trimmed = value.trim();
  if (!trimmed) return fallback;

  return trimmed.replace(/[^a-zA-Z0-9._\-\/]+/g, '-');
};

const sanitizePathPrefix = (prefix) => {
  if (typeof prefix !== 'string') return '';
  return prefix
    .split('/')
    .map((segment) => sanitizePathSegment(segment, ''))
    .filter(Boolean)
    .join('/');
};

const getConfiguredPrefix = () => {
  if (cachedPrefix !== null) return cachedPrefix;

  const candidates = [
    process.env.RAG_BLOB_PREFIX,
    process.env.BLOB_PREFIX,
    process.env.RAG_S3_PREFIX,
    process.env.S3_PREFIX,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const trimmed = candidate.trim().replace(/^\/+|\/+$/g, '');
    if (!trimmed) {
      continue;
    }

    const sanitized = sanitizePathPrefix(trimmed);
    if (sanitized) {
      cachedPrefix = sanitized;
      return sanitized;
    }
  }

  cachedPrefix = DEFAULT_PREFIX;
  return cachedPrefix;
};

const getConfiguredStore = () => {
  if (cachedStore !== null) return cachedStore;

  const candidates = [
    process.env.RAG_BLOB_STORE,
    process.env.NETLIFY_BLOB_STORE,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }

    cachedStore = trimmed;
    return cachedStore;
  }

  cachedStore = DEFAULT_STORE;
  return cachedStore;
};

const buildObjectKey = ({ userId, documentId, filename }) => {
  const segments = [];

  const prefix = getConfiguredPrefix();
  if (prefix) {
    segments.push(prefix);
  }

  const normalizedUserId = sanitizePathSegment(userId, 'anonymous');
  segments.push(normalizedUserId);

  const normalizedDocumentId = sanitizePathSegment(
    documentId,
    Date.now().toString(36)
  );
  segments.push(normalizedDocumentId);

  const safeFilename = sanitizePathSegment(filename, 'document');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  segments.push(`${timestamp}-${safeFilename}`);

  return segments.filter(Boolean).join('/');
};

const ensureBufferBody = (body) => {
  if (Buffer.isBuffer(body)) return body;
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  throw new Error('Unsupported body type for Netlify Blob upload');
};

const normalizeMetadata = (metadata = {}) => {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }

  const normalized = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined) {
      continue;
    }

    const stringKey = typeof key === 'string' ? key : String(key);
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        normalized[stringKey] = trimmed;
      }
      continue;
    }

    try {
      normalized[stringKey] = JSON.stringify(value);
    } catch {
      normalized[stringKey] = String(value);
    }
  }

  return normalized;
};

export const uploadDocumentToBlobStore = async ({
  body,
  contentType,
  userId,
  documentId,
  filename,
  metadata = {},
}) => {
  if (!body) {
    throw new Error('Netlify Blob upload body is required');
  }

  const storeName = getConfiguredStore();

  if (typeof globalThis?.__UPLOAD_DOCUMENT_TO_BLOB_MOCK__ === 'function') {
    return await globalThis.__UPLOAD_DOCUMENT_TO_BLOB_MOCK__({
      body,
      contentType: contentType || 'application/octet-stream',
      userId,
      documentId,
      filename,
      metadata,
      store: storeName,
      prefix: getConfiguredPrefix(),
    });
  }

  const store = getStore(storeName);
  const normalizedBody = ensureBufferBody(body);
  const key = buildObjectKey({ userId, documentId, filename });
  const size = normalizedBody.length;
  const resolvedContentType = contentType || 'application/octet-stream';
  const normalizedMetadata = normalizeMetadata(metadata);

  await store.set(key, normalizedBody, {
    contentType: resolvedContentType,
    metadata: normalizedMetadata,
  });

  return {
    provider: 'netlify-blobs',
    store: storeName,
    key,
    path: `${storeName}/${key}`,
    url: null,
    size,
    contentType: resolvedContentType,
  };
};

export const __internal = {
  getConfiguredPrefix,
  getConfiguredStore,
  buildObjectKey,
  sanitizePathSegment,
};
