import crypto from 'crypto';

let cachedPrefix = null;
let loggedBucket = null;

const logEnvVariable = (name, value) => {
  const displayValue = value == null ? '(not set)' : value;
  console.log(`[S3 Config] ${name}=${displayValue}`);
};

const DEFAULT_PREFIX = 'rag-documents';

const logResolvedBucket = (bucket) => {
  if (!bucket || loggedBucket === bucket) {
    return;
  }
  console.log(`S3 bucket configured: ${bucket}`);
  loggedBucket = bucket;
};

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
    { name: 'RAG_S3_PREFIX', value: process.env.RAG_S3_PREFIX },
    { name: 'S3_PREFIX', value: process.env.S3_PREFIX },
  ];

  for (const { name, value } of candidates) {
    logEnvVariable(name, value);

    if (typeof value !== 'string') {
      continue;
    }

    const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
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

const getConfiguredBucket = () => {
  const sources = [
    { name: 'RAG_S3_BUCKET', value: process.env.RAG_S3_BUCKET },
    { name: 'S3_BUCKET', value: process.env.S3_BUCKET },
    { name: 'AWS_S3_BUCKET', value: process.env.AWS_S3_BUCKET },
  ];

  for (const { name, value } of sources) {
    logEnvVariable(name, value);
  }

  const bucket = sources.find(source => source.value)?.value;

  if (!bucket) {
    throw new Error(
      'RAG_S3_BUCKET (or S3_BUCKET/AWS_S3_BUCKET) is required for document storage'
    );
  }

  logResolvedBucket(bucket);
  return bucket;
};

const getConfiguredRegion = () => {
  const sources = [
    { name: 'RAG_S3_REGION', value: process.env.RAG_S3_REGION },
    { name: 'AWS_REGION', value: process.env.AWS_REGION },
    { name: 'AWS_DEFAULT_REGION', value: process.env.AWS_DEFAULT_REGION },
  ];

  for (const { name, value } of sources) {
    logEnvVariable(name, value);
  }

  const region = sources.find(source => source.value)?.value;

  if (!region) {
    throw new Error(
      'RAG_S3_REGION (or AWS_REGION/AWS_DEFAULT_REGION) is required for document storage'
    );
  }

  return region;
};

const resolveS3Config = () => {
  const bucket = getConfiguredBucket();
  const region = getConfiguredRegion();
  const prefix = getConfiguredPrefix();
  return { bucket, region, prefix };
};

const trimCredentialValue = (value) => {
  if (value == null) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
};

const buildCredentialCandidate = ({ accessKeyId, secretAccessKey, sessionToken }) => {
  const sanitizedAccessKeyId = trimCredentialValue(accessKeyId);
  const sanitizedSecretAccessKey = trimCredentialValue(secretAccessKey);

  if (!sanitizedAccessKeyId || !sanitizedSecretAccessKey) {
    return null;
  }

  return {
    accessKeyId: sanitizedAccessKeyId,
    secretAccessKey: sanitizedSecretAccessKey,
    sessionToken: trimCredentialValue(sessionToken),
  };

};

const readCredentialCandidate = ({
  label,
  accessKeyEnv,
  secretKeyEnv,
  sessionTokenEnv,
}) => {
  const accessKeyId = process.env[accessKeyEnv];
  const secretAccessKey = process.env[secretKeyEnv];
  const sessionToken = process.env[sessionTokenEnv];

  logEnvVariable(accessKeyEnv, accessKeyId);
  logEnvVariable(secretKeyEnv, secretAccessKey);
  logEnvVariable(sessionTokenEnv, sessionToken);

  const candidate = buildCredentialCandidate({
    accessKeyId,
    secretAccessKey,
    sessionToken,
  });

  if (!candidate) {
    return null;
  }

  return {
    ...candidate,
    source: label,
  };
};

const getS3Credentials = () => {
  const ragCredentials = readCredentialCandidate({
    label: 'RAG_S3',
    accessKeyEnv: 'RAG_S3_ACCESS_KEY_ID',
    secretKeyEnv: 'RAG_S3_SECRET_ACCESS_KEY',
    sessionTokenEnv: 'RAG_S3_SESSION_TOKEN',
  });

  const awsCredentials = readCredentialCandidate({
    label: 'AWS',
    accessKeyEnv: 'AWS_ACCESS_KEY_ID',
    secretKeyEnv: 'AWS_SECRET_ACCESS_KEY',
    sessionTokenEnv: 'AWS_SESSION_TOKEN',

  });

  const candidates = [ragCredentials, awsCredentials].filter(Boolean);

  if (!candidates.length) {
    throw new Error('S3 credentials are required: set RAG_S3_ACCESS_KEY_ID/AWS_ACCESS_KEY_ID and RAG_S3_SECRET_ACCESS_KEY/AWS_SECRET_ACCESS_KEY');
  }

  const candidateWithSessionToken = candidates.find(candidate => candidate.sessionToken);
  const selected = candidateWithSessionToken || candidates[0];

  console.log(`[S3 Config] Selected credential source: ${selected.source}`);

  return {
    accessKeyId: selected.accessKeyId,
    secretAccessKey: selected.secretAccessKey,
    sessionToken: selected.sessionToken || null,
  };
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

const encodeS3Key = (key) =>
  key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

const buildObjectUrl = ({ bucket, region, key }) => {
  const encodedKey = encodeS3Key(key);
  if (region === 'us-east-1') {
    return `https://${bucket}.s3.amazonaws.com/${encodedKey}`;
  }
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
};

const normalizeSize = (body) => {
  if (Buffer.isBuffer(body)) return body.length;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (typeof body === 'string') return Buffer.byteLength(body);
  return null;
};

const normalizeMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object') return {};

  const normalized = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof key !== 'string') continue;

    const sanitizedKey = key.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
    if (!sanitizedKey) continue;

    if (value == null) continue;

    let stringValue;
    if (typeof value === 'string') {
      stringValue = value;
    } else if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value instanceof Date
    ) {
      stringValue = value instanceof Date ? value.toISOString() : String(value);
    } else {
      try {
        stringValue = JSON.stringify(value);
      } catch (error) {
        stringValue = String(value);
      }
    }

    normalized[sanitizedKey] = stringValue.slice(0, 1024);
  }

  return normalized;
};

const toAmzDate = (date) => {
  const pad = (value) => value.toString().padStart(2, '0');
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return {
    amzDate: `${year}${month}${day}T${hours}${minutes}${seconds}Z`,
    dateStamp: `${year}${month}${day}`,
  };
};

const sha256Hex = (value) =>
  crypto.createHash('sha256').update(value).digest('hex');
const hmacSha256 = (key, value) =>
  crypto.createHmac('sha256', key).update(value).digest();

const signS3PutRequest = ({
  bucket,
  region,
  key,
  body,
  contentType,
  metadata,
  credentials,
}) => {
  const {
    accessKeyId: sanitizedAccessKeyId,
    secretAccessKey: sanitizedSecretAccessKey,
    sessionToken: sanitizedSessionToken,
  } = credentials;
  const { amzDate, dateStamp } = toAmzDate(new Date());
  const payloadHash = sha256Hex(body);

  const host =
    region === 'us-east-1'
      ? `${bucket}.s3.amazonaws.com`
      : `${bucket}.s3.${region}.amazonaws.com`;
  const canonicalUri = `/${encodeS3Key(key)}`;
  const canonicalQueryString = '';

  const baseHeaders = {
    'content-type': contentType,
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  if (sanitizedSessionToken) {
    baseHeaders['x-amz-security-token'] = sanitizedSessionToken;
  }

  const metadataHeaders = Object.entries(metadata).reduce(
    (acc, [metaKey, metaValue]) => {
      acc[`x-amz-meta-${metaKey}`] = metaValue;
      return acc;
    },
    {}
  );

  const allHeaders = { ...baseHeaders, ...metadataHeaders };
  const sortedHeaderKeys = Object.keys(allHeaders).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map((keyName) => `${keyName}:${allHeaders[keyName].toString()}`)
    .join('\n');

  const signedHeaders = sortedHeaderKeys.join(';');

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQueryString,
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmacSha256(`AWS4${sanitizedSecretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, 's3');
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto
    .createHmac('sha256', kSigning)
    .update(stringToSign)
    .digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${sanitizedAccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers = {
    ...baseHeaders,
    ...metadataHeaders,
    Authorization: authorization,
  };

  return {
    headers,
    host,
  };
};

const ensureBufferBody = (body) => {
  if (Buffer.isBuffer(body)) return body;
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  throw new Error('Unsupported body type for S3 upload');
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
      prefix: getConfiguredPrefix(),
    });
  }

  const normalizedMetadata = normalizeMetadata(metadata);
  const normalizedBody = ensureBufferBody(body);
  const key = buildObjectKey({ userId, documentId, filename });
  const size = normalizeSize(normalizedBody);
  const resolvedContentType = contentType || 'application/octet-stream';
  const credentials = getS3Credentials();
  const { headers, host } = signS3PutRequest({
    bucket,
    region,
    key,
    body: normalizedBody,
    contentType: resolvedContentType,
    metadata: normalizedMetadata,
    credentials,
  });

  const response = await fetch(`https://${host}/${encodeS3Key(key)}`, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Length': size ?? undefined,
    },
    body: normalizedBody,
  });

  if (!response.ok) {
    const rawText = await response.text().catch(() => '');
    const responseText = typeof rawText === 'string' ? rawText.trim() : '';
    const error = new Error(
      `S3 upload failed with status ${response.status}${responseText ? `: ${responseText}` : ''}`
    );
    error.statusCode = response.status;
    error.responseBody = responseText || null;
    throw error;
  }

  const etagHeader = response.headers.get('etag');
  const versionIdHeader = response.headers.get('x-amz-version-id');

  return {
    bucket,
    region,
    key,
    url: buildObjectUrl({ bucket, region, key }),
    etag: etagHeader ? etagHeader.replace(/"/g, '') : null,
    size: size ?? null,
    versionId: versionIdHeader || null,
  };
};

export const __internal = {
  resolveS3Config,
  getConfiguredPrefix,
  buildObjectKey,
  sanitizePathSegment,
  buildObjectUrl,
};
