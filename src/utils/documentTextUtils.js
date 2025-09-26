const TEXTUAL_MIME_INDICATORS = [
  'text/',
  'application/json',
  'application/xml',
  'application/xhtml+xml',
  'application/x-yaml',
  'application/yaml',
  'application/csv',
  'text/csv',
  'application/rtf',
  'text/markdown',
];

const BINARY_HINTS = [
  'pdf',
  'msword',
  'officedocument',
  'octet-stream',
];

const LOSSY_WARNING = 'Binary document converted using a lossy UTF-8 fallback. Consider uploading a text-friendly version for better summaries.';

const UNKNOWN_WARNING = 'Unknown content type decoded as UTF-8 text. Validate the extracted content before summarizing.';

const decodeBytesToString = (bytes) => {
  if (typeof globalThis !== 'undefined' && typeof globalThis.TextDecoder === 'function') {
    return new globalThis.TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('utf8');
  }

  let result = '';
  for (let i = 0; i < bytes.length; i += 1) {
    result += String.fromCharCode(bytes[i]);
  }
  return result;
};

const base64ToUint8Array = (base64) => {
  if (typeof base64 !== 'string' || base64.length === 0) {
    return new Uint8Array();
  }

  if (typeof atob === 'function') {
    const binary = atob(base64);
    const length = binary.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  return Uint8Array.from(Buffer.from(base64, 'base64'));
};

const stripBinaryArtifacts = (text) => {
  if (typeof text !== 'string') {
    return '';
  }

  return text
    .replace(/[\x00-\x1f]+/g, ' ')
    .replace(/[\x7f-\x9f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const decodeDocumentContent = (downloadPayload = {}) => {
  const { content, contentType } = downloadPayload;

  if (!content) {
    throw new Error('Document download payload is missing base64 content');
  }

  const normalizedType = typeof contentType === 'string' ? contentType.toLowerCase() : '';
  const bytes = base64ToUint8Array(content);
  const decoded = decodeBytesToString(bytes);

  if (TEXTUAL_MIME_INDICATORS.some((indicator) => normalizedType.startsWith(indicator) || normalizedType.includes(indicator))) {
    return { text: decoded, warnings: [] };
  }

  if (BINARY_HINTS.some((hint) => normalizedType.includes(hint))) {
    const sanitized = stripBinaryArtifacts(decoded);
    if (!sanitized) {
      throw new Error('Unable to extract readable text from binary document. Download the file and provide a text version.');
    }
    return { text: sanitized, warnings: [LOSSY_WARNING] };
  }

  const sanitized = stripBinaryArtifacts(decoded);
  return { text: sanitized || decoded, warnings: sanitized ? [UNKNOWN_WARNING] : [UNKNOWN_WARNING] };
};

export default decodeDocumentContent;
