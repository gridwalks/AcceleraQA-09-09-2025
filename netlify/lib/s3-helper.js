let cachedClient = null;
let cachedRegion = null;
let s3ModulePromise = null;

const DEFAULT_KEY_PREFIX = 'rag-documents';

const sanitizeKeySegment = (value, fallback) => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/[^a-zA-Z0-9._\-\/]+/g, '-');
};

const resolveS3Config = () => {
  const bucket =
    process.env.RAG_S3_BUCKET ||
    process.env.S3_BUCKET ||
    process.env.AWS_S3_BUCKET ||
    process.env.AWS_BUCKET_NAME;
  const region =
    process.env.RAG_S3_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION;

  if (!bucket) {
    throw new Error('RAG_S3_BUCKET (or S3 bucket environment variable) is required for document storage');
  }

  if (!region) {
    throw new Error('RAG_S3_REGION (or AWS region environment variable) is required for document storage');
  }

  return { bucket, region };
};

const loadS3Module = async () => {
  if (!s3ModulePromise) {
    s3ModulePromise = import('@aws-sdk/client-s3');
  }
  return s3ModulePromise;
};

const getS3Client = async (region) => {
  const { S3Client } = await loadS3Module();
  if (!cachedClient || cachedRegion !== region) {
    cachedClient = new S3Client({ region });
    cachedRegion = region;
  }
  return cachedClient;
};

const sanitizeKeyPrefix = (prefix) => {
  if (typeof prefix !== 'string') {
    return '';
  }

  return prefix
    .split('/')
    .map(segment => sanitizeKeySegment(segment, ''))
    .filter(Boolean)
    .join('/');
};

const getConfiguredKeyPrefix = () => {
  const candidates = [
    process.env.RAG_S3_PREFIX,
    process.env.S3_KEY_PREFIX,
    process.env.AWS_S3_PREFIX,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const trimmed = candidate.trim().replace(/^\/+|\/+$/g, '');
    if (!trimmed) {
      continue;
    }

    const sanitized = sanitizeKeyPrefix(trimmed);
    if (sanitized) {
      return sanitized;
    }
  }

  return DEFAULT_KEY_PREFIX;
};

const buildObjectKey = ({ userId, documentId, filename }) => {
  const segments = [];

  const configuredPrefix = getConfiguredKeyPrefix();
  if (configuredPrefix) {
    segments.push(configuredPrefix);
  }

  const normalizedUserId = sanitizeKeySegment(userId, 'anonymous');
  segments.push(normalizedUserId);

  const normalizedDocumentId = sanitizeKeySegment(documentId, Date.now().toString(36));
  segments.push(normalizedDocumentId);

  const safeFilename = sanitizeKeySegment(filename, 'document');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  segments.push(`${timestamp}-${safeFilename}`);

  return segments.filter(Boolean).join('/');
};

const buildS3Url = ({ bucket, region, key }) => {
  const encodedKey = key
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
  const baseUrl = region === 'us-east-1'
    ? `https://${bucket}.s3.amazonaws.com`
    : `https://${bucket}.s3.${region}.amazonaws.com`;
  return `${baseUrl}/${encodedKey}`;
};

export const uploadDocumentToS3 = async ({
  body,
  contentType,
  userId,
  documentId,
  filename,
  metadata = {},
}) => {
  if (!body) {
    throw new Error('S3 upload body is required');
  }

  const { bucket, region } = resolveS3Config();
  if (typeof globalThis?.__UPLOAD_DOCUMENT_TO_S3_MOCK__ === 'function') {
    return await globalThis.__UPLOAD_DOCUMENT_TO_S3_MOCK__({
      body,
      contentType: contentType || 'application/octet-stream',
      userId,
      documentId,
      filename,
      metadata,
      bucket,
      region,
    });
  }
  const client = await getS3Client(region);

  const key = buildObjectKey({ userId, documentId, filename });

  const { PutObjectCommand } = await loadS3Module();
  const size = Buffer.isBuffer(body)
    ? body.length
    : ArrayBuffer.isView(body)
      ? body.byteLength
      : typeof body === 'string'
        ? Buffer.byteLength(body)
        : null;
  
  const putObjectCommand = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType || 'application/octet-stream',
    ...(typeof size === 'number' ? { ContentLength: size } : {}),
    Metadata: Object.fromEntries(
      Object.entries(metadata || {})
        .filter(([metaKey, metaValue]) =>
          typeof metaKey === 'string' && metaKey.trim() && typeof metaValue === 'string'
        )
        .map(([metaKey, metaValue]) => [metaKey.toLowerCase(), metaValue])
    ),
  });

  const response = await client.send(putObjectCommand);
  const etag = typeof response.ETag === 'string' ? response.ETag.replace(/"/g, '') : null;
  const url = buildS3Url({ bucket, region, key });

  return {
    bucket,
    region,
    key,
    url,
    etag,
    size,
  };
};

export const __internal = {
  resolveS3Config,
  getConfiguredKeyPrefix,
  buildObjectKey,
  buildS3Url,
  sanitizeKeySegment,
};
