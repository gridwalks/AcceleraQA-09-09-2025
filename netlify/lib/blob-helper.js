import { getStore } from '@netlify/blobs';

let cachedPrefix = null;
let cachedStore = null;
let cachedStoreInstance = null;
let cachedStoreInstanceKey = null;

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

const resolveManualBlobCredentials = () => {
  const siteCandidates = [
    process.env.NETLIFY_BLOBS_SITE_ID,
    process.env.NETLIFY_SITE_ID,
  ];
  const tokenCandidates = [
    process.env.NETLIFY_BLOBS_TOKEN,
    process.env.NETLIFY_AUTH_TOKEN,
  ];

  const siteID = siteCandidates.find((value) =>
    typeof value === 'string' && value.trim()
  );
  const token = tokenCandidates.find((value) =>
    typeof value === 'string' && value.trim()
  );

  return {
    siteID: siteID ? siteID.trim() : null,
    token: token ? token.trim() : null,
  };
};

const isMissingBlobEnvironmentError = (error) => {
  if (!error) return false;
  if (error.name === 'MissingBlobsEnvironmentError') return true;

  const message = typeof error.message === 'string' ? error.message : '';
  return message
    .toLowerCase()
    .includes('environment has not been configured to use netlify blobs');
};

const getBlobStoreInstance = () => {
  const storeName = getConfiguredStore();
  const manualCredentials = resolveManualBlobCredentials();
  const cacheKey = manualCredentials.siteID && manualCredentials.token
    ? `${storeName}|manual`
    : storeName;

  if (cachedStoreInstance && cachedStoreInstanceKey === cacheKey) {
    return cachedStoreInstance;
  }

  const instantiateStore = (input) => getStore(input);

  try {
    cachedStoreInstance = instantiateStore(storeName);
    cachedStoreInstanceKey = storeName;
    return cachedStoreInstance;
  } catch (error) {
    if (
      isMissingBlobEnvironmentError(error) &&
      manualCredentials.siteID &&
      manualCredentials.token
    ) {
      cachedStoreInstance = instantiateStore({
        name: storeName,
        siteID: manualCredentials.siteID,
        token: manualCredentials.token,
      });
      cachedStoreInstanceKey = cacheKey;
      return cachedStoreInstance;
    }

    throw error;
  }
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

  const store = getBlobStoreInstance();
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
