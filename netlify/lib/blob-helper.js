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
  const timestamp = new Date().toISOString();
  const metadataWithDefaults = {
    ...metadata,
    'size-bytes': size,
    size_bytes: size,
    size,
    sizeBytes: size,
    'content-type': resolvedContentType,
    contentType: resolvedContentType,
    uploadedAt: timestamp,
    'uploaded-at': timestamp,
    uploaded_at: timestamp,
  };
  const normalizedMetadata = normalizeMetadata(metadataWithDefaults);

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

const decodeMetadataValue = (value) => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed === 'true') {
    return true;
  }

  if (trimmed === 'false') {
    return false;
  }

  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) {
    return numeric;
  }

  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      console.warn('Failed to parse blob metadata JSON value:', error);
    }
  }

  return trimmed;
};

const decodeMetadataObject = (metadata) => {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }

  const decoded = {};
  for (const [key, value] of Object.entries(metadata)) {
    decoded[key] = decodeMetadataValue(value);
  }
  return decoded;
};

const firstNonEmptyString = (...values) => {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return null;
};

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
};

const firstValidTimestamp = (...values) => {
  for (const value of values) {
    if (!value) {
      continue;
    }

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return null;
};

const deriveKeySegments = (key, prefix) => {
  const normalizedKey = typeof key === 'string' ? key : '';
  const normalizedPrefix = typeof prefix === 'string' ? prefix.replace(/^\/+|\/+$/g, '') : '';

  let relativeKey = normalizedKey;
  if (normalizedPrefix && normalizedKey.startsWith(`${normalizedPrefix}/`)) {
    relativeKey = normalizedKey.slice(normalizedPrefix.length + 1);
  }

  const segments = relativeKey.split('/').filter(Boolean);
  const [userId = null, documentId = null, ...rest] = segments;
  const filename = rest.length > 0 ? rest.join('/') : segments[segments.length - 1] || null;

  return {
    relativeKey,
    segments,
    userId,
    documentId,
    filename,
  };
};

export const getBlobFile = async ({ key } = {}) => {
  if (typeof key !== 'string') {
    throw new Error('A blob key is required to download a file from Netlify Blobs.');
  }

  const trimmedKey = key.trim();
  if (!trimmedKey) {
    throw new Error('A blob key is required to download a file from Netlify Blobs.');
  }

  const normalizedKey = trimmedKey.replace(/^\/+/, '');
  const store = getBlobStoreInstance();
  const storeName = getConfiguredStore();
  const configuredPrefix = getConfiguredPrefix();

  const result = await store.getWithMetadata(normalizedKey, { type: 'arrayBuffer' });
  if (!result) {
    return null;
  }

  const buffer = Buffer.from(result.data);
  const decodedMetadata = decodeMetadataObject(result.metadata || {});
  const storageMetadata =
    decodedMetadata.storage && typeof decodedMetadata.storage === 'object'
      ? decodedMetadata.storage
      : null;

  const derived = deriveKeySegments(normalizedKey, configuredPrefix);

  const size = firstFiniteNumber(
    decodedMetadata['size-bytes'],
    decodedMetadata.size_bytes,
    decodedMetadata.sizeBytes,
    decodedMetadata.size,
    decodedMetadata['content-length'],
    decodedMetadata['x-size-bytes'],
    storageMetadata?.size,
    buffer.length
  );

  const contentType =
    firstNonEmptyString(
      decodedMetadata['content-type'],
      decodedMetadata.contentType,
      storageMetadata?.contentType
    ) || 'application/octet-stream';

  const uploadedAt = firstValidTimestamp(
    decodedMetadata.uploadedAt,
    decodedMetadata['uploaded-at'],
    decodedMetadata.uploaded_at,
    storageMetadata?.uploadedAt,
    storageMetadata?.uploaded_at
  );

  const userId = firstNonEmptyString(
    decodedMetadata['x-user-id'],
    decodedMetadata.userId,
    decodedMetadata.user_id,
    derived.userId
  );

  const documentId = firstNonEmptyString(
    decodedMetadata['x-document-id'],
    decodedMetadata.documentId,
    decodedMetadata.document_id,
    derived.documentId
  );

  const etag = firstNonEmptyString(
    result.etag,
    decodedMetadata.etag,
    decodedMetadata.ETag,
    decodedMetadata['etag'],
    decodedMetadata['ETag']
  );

  return {
    key: normalizedKey,
    store: storeName,
    relativeKey: derived.relativeKey,
    userId: userId || null,
    documentId: documentId || null,
    filename: derived.filename || null,
    size: Number.isFinite(size) ? size : buffer.length,
    contentType,
    uploadedAt,
    metadata: decodedMetadata,
    etag: etag || null,
    data: buffer.toString('base64'),
    encoding: 'base64',
  };
};

export const listBlobFiles = async ({ prefix, limit } = {}) => {
  const store = getBlobStoreInstance();
  const storeName = getConfiguredStore();

  const sanitizedPrefix = typeof prefix === 'string'
    ? sanitizePathPrefix(prefix.replace(/^\/+|\/+$/g, ''))
    : '';

  const resolvedPrefix = sanitizedPrefix || getConfiguredPrefix();
  const listOptions = {};
  if (resolvedPrefix) {
    listOptions.prefix = `${resolvedPrefix}/`;
  }

  const listResult = await store.list(listOptions);
  const blobs = Array.isArray(listResult?.blobs) ? listResult.blobs : [];

  const numericLimit = Number(limit);
  const maxEntries = Number.isFinite(numericLimit) && numericLimit > 0
    ? Math.floor(numericLimit)
    : blobs.length;
  const limitedBlobs = maxEntries < blobs.length ? blobs.slice(0, maxEntries) : blobs;
  const metadataResults = await Promise.allSettled(
    limitedBlobs.map(({ key }) => store.getMetadata(key))
  );

  const items = limitedBlobs.map((blob, index) => {
    const metadataEntry = metadataResults[index];
    const metadata =
      metadataEntry.status === 'fulfilled' && metadataEntry.value?.metadata
        ? metadataEntry.value.metadata
        : {};
    const decodedMetadata = decodeMetadataObject(metadata);
    const derived = deriveKeySegments(blob.key, resolvedPrefix);
    const storageMetadata =
      decodedMetadata.storage && typeof decodedMetadata.storage === 'object'
        ? decodedMetadata.storage
        : null;

    const size = firstFiniteNumber(
      decodedMetadata['size-bytes'],
      decodedMetadata.size_bytes,
      decodedMetadata.sizeBytes,
      decodedMetadata.size,
      decodedMetadata['content-length'],
      decodedMetadata['x-size-bytes'],
      storageMetadata?.size
    );

    const contentType = firstNonEmptyString(
      decodedMetadata['content-type'],
      decodedMetadata.contentType,
      storageMetadata?.contentType
    );

    const uploadedAt = firstValidTimestamp(
      decodedMetadata.uploadedAt,
      decodedMetadata['uploaded-at'],
      decodedMetadata.uploaded_at,
      storageMetadata?.uploadedAt,
      storageMetadata?.uploaded_at
    );

    const userId = firstNonEmptyString(
      decodedMetadata['x-user-id'],
      decodedMetadata.userId,
      decodedMetadata.user_id,
      derived.userId
    );

    const documentId = firstNonEmptyString(
      decodedMetadata['x-document-id'],
      decodedMetadata.documentId,
      decodedMetadata.document_id,
      derived.documentId
    );

    return {
      key: blob.key,
      etag: blob.etag || null,
      userId: userId || null,
      documentId: documentId || null,
      size: Number.isFinite(size) ? size : null,
      contentType: contentType || null,
      uploadedAt,
      metadata: decodedMetadata,
      relativeKey: derived.relativeKey,
      segments: derived.segments,
      filename: derived.filename,
    };
  });

  return {
    store: storeName,
    prefix: resolvedPrefix,
    blobs: items,
    count: items.length,
    total: blobs.length,
    truncated: items.length < blobs.length,
    timestamp: new Date().toISOString(),
  };
};

export const __internal = {
  getConfiguredPrefix,
  getConfiguredStore,
  buildObjectKey,
  sanitizePathSegment,
};
