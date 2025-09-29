let cachedAccessToken = null;
let cachedDriveId = null;
let cachedSiteId = undefined;
let cachedPrefix = null;
let loggedDriveId = null;

const logResolvedDriveId = (driveId) => {
  if (!driveId || loggedDriveId === driveId) {
    return;
  }

  console.log(`OneDrive drive configured: ${driveId}`);
  loggedDriveId = driveId;
};

const DEFAULT_FOLDER_PREFIX = 'rag-documents';

const sanitizePathSegment = (value, fallback) => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/[^a-zA-Z0-9._\-\/]+/g, '-');
};

const sanitizePathPrefix = (prefix) => {
  if (typeof prefix !== 'string') {
    return '';
  }

  return prefix
    .split('/')
    .map(segment => sanitizePathSegment(segment, ''))
    .filter(Boolean)
    .join('/');
};

const getConfiguredRootPath = () => {
  if (cachedPrefix !== null) {
    return cachedPrefix;
  }

  const candidates = [
    process.env.RAG_ONEDRIVE_ROOT_PATH,
    process.env.ONEDRIVE_ROOT_PATH,
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

  cachedPrefix = DEFAULT_FOLDER_PREFIX;
  return cachedPrefix;
};

const resolveOneDriveConfig = () => {
  if (cachedAccessToken && cachedDriveId) {
    logResolvedDriveId(cachedDriveId);
    return {
      accessToken: cachedAccessToken,
      driveId: cachedDriveId,
      siteId: cachedSiteId ?? null,
      rootPath: getConfiguredRootPath(),
    };
  }

  const accessToken =
    process.env.RAG_ONEDRIVE_ACCESS_TOKEN ||
    process.env.ONEDRIVE_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error('RAG_ONEDRIVE_ACCESS_TOKEN (or ONEDRIVE_ACCESS_TOKEN) is required for document storage');
  }

  const driveId =
    process.env.RAG_ONEDRIVE_DRIVE_ID ||
    process.env.ONEDRIVE_DRIVE_ID;

  if (!driveId) {
    throw new Error('RAG_ONEDRIVE_DRIVE_ID (or ONEDRIVE_DRIVE_ID) is required for document storage');
  }

  const siteId =
    process.env.RAG_ONEDRIVE_SITE_ID ||
    process.env.ONEDRIVE_SITE_ID ||
    null;

  cachedAccessToken = accessToken;
  cachedDriveId = driveId;
  cachedSiteId = siteId;
  logResolvedDriveId(driveId);

  return {
    accessToken,
    driveId,
    siteId,
    rootPath: getConfiguredRootPath(),
  };
};

const buildDrivePath = ({ userId, documentId, filename }) => {
  const segments = [];

  const rootPath = getConfiguredRootPath();
  if (rootPath) {
    segments.push(rootPath);
  }

  const normalizedUserId = sanitizePathSegment(userId, 'anonymous');
  segments.push(normalizedUserId);

  const normalizedDocumentId = sanitizePathSegment(documentId, Date.now().toString(36));
  segments.push(normalizedDocumentId);

  const safeFilename = sanitizePathSegment(filename, 'document');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  segments.push(`${timestamp}-${safeFilename}`);

  return segments.filter(Boolean).join('/');
};

const encodeGraphComponent = (value) => encodeURIComponent(value).replace(/%2F/gi, '/');

const buildGraphUploadUrl = ({ driveId, siteId, path }) => {
  const encodedPath = path
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
  const base = siteId
    ? `https://graph.microsoft.com/v1.0/sites/${encodeGraphComponent(siteId)}/drives/${encodeGraphComponent(driveId)}`
    : `https://graph.microsoft.com/v1.0/drives/${encodeGraphComponent(driveId)}`;
  return `${base}/root:/${encodedPath}:/content`;
};

const buildItemContentUrl = ({ driveId, siteId, itemId }) => {
  if (!itemId) {
    return null;
  }
  const base = siteId
    ? `https://graph.microsoft.com/v1.0/sites/${encodeGraphComponent(siteId)}/drives/${encodeGraphComponent(driveId)}`
    : `https://graph.microsoft.com/v1.0/drives/${encodeGraphComponent(driveId)}`;
  return `${base}/items/${encodeURIComponent(itemId)}/content`;
};

const normalizeSize = (body) => {
  if (Buffer.isBuffer(body)) {
    return body.length;
  }
  if (ArrayBuffer.isView(body)) {
    return body.byteLength;
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength;
  }
  if (typeof body === 'string') {
    return Buffer.byteLength(body);
  }
  return null;
};

export const uploadDocumentToOneDrive = async ({
  body,
  contentType,
  userId,
  documentId,
  filename,
  metadata = {},
}) => {
  if (!body) {
    throw new Error('OneDrive upload body is required');
  }

  const { accessToken, driveId, siteId, rootPath } = resolveOneDriveConfig();
  if (typeof globalThis?.__UPLOAD_DOCUMENT_TO_ONEDRIVE_MOCK__ === 'function') {
    return await globalThis.__UPLOAD_DOCUMENT_TO_ONEDRIVE_MOCK__({
      body,
      contentType: contentType || 'application/octet-stream',
      userId,
      documentId,
      filename,
      metadata,
      driveId,
      siteId,
      rootPath,
    });
  }

  const path = buildDrivePath({ userId, documentId, filename });
  const uploadUrl = buildGraphUploadUrl({ driveId, siteId, path });
  const size = normalizeSize(body);

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': contentType || 'application/octet-stream',
    },
    body,
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      errorDetail = await response.text();
    } catch (error) {
      errorDetail = '';
    }
    const error = new Error(
      `OneDrive upload failed with status ${response.status}${errorDetail ? `: ${errorDetail}` : ''}`
    );
    error.statusCode = response.status;
    throw error;
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {
    payload = {};
  }

  const itemId = typeof payload.id === 'string' ? payload.id : null;
  const url =
    (typeof payload.webUrl === 'string' && payload.webUrl) ||
    (typeof payload['@microsoft.graph.downloadUrl'] === 'string' && payload['@microsoft.graph.downloadUrl']) ||
    buildItemContentUrl({ driveId, siteId, itemId });
  const etag = typeof payload.eTag === 'string'
    ? payload.eTag
    : typeof payload.etag === 'string'
      ? payload.etag
      : null;
  const reportedSize = typeof payload.size === 'number' ? payload.size : size;

  return {
    driveId,
    siteId: siteId || null,
    path,
    itemId,
    url,
    etag,
    size: reportedSize ?? null,
  };
};

export const __internal = {
  resolveOneDriveConfig,
  getConfiguredRootPath,
  buildDrivePath,
  buildGraphUploadUrl,
  sanitizePathSegment,
  buildItemContentUrl,
};
