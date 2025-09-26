import { getToken, getUserId } from './authService';

const DEFAULT_ENDPOINT = process.env.REACT_APP_SUMMARY_PIPELINE_ENDPOINT || '/.netlify/functions/summary-pipeline';

const DETAIL_LEVELS = {
  BRIEF: 'Brief',
  STANDARD: 'Standard',
  DEEP_DIVE: 'Deep Dive',
};

const DEFAULT_MODE = {
  role: 'QA Lead',
  lens: 'Regulatory',
  detail: DETAIL_LEVELS.STANDARD,
};

export const buildSummaryRequest = ({ document, mode = {}, query = '', filters = {}, metadata = {} }) => {
  if (!document || typeof document !== 'object') {
    throw new Error('document metadata is required');
  }

  const rawContent = typeof document.content === 'string' ? document.content : document.text;
  if (!rawContent || typeof rawContent !== 'string' || !rawContent.trim()) {
    throw new Error('document content must be a non-empty string');
  }

  const content = rawContent.replace(/\r\n/g, '\n').trim();

  const normalizedMode = {
    role: typeof mode.role === 'string' ? mode.role : DEFAULT_MODE.role,
    lens: typeof mode.lens === 'string' ? mode.lens : DEFAULT_MODE.lens,
    detail: normalizeDetail(mode.detail),
  };

  const docId = document.doc_id || document.id || createDeterministicId(content);
  const timestamp = new Date().toISOString();

  return {
    document: {
      doc_id: docId,
      title: document.title || 'Untitled Document',
      version: document.version || '1.0',
      doc_type: document.doc_type || document.type || 'Document',
      owner: document.owner || 'unknown',
      effective_date: document.effective_date || document.effectiveDate || timestamp.slice(0, 10),
      system_of_record: document.system_of_record || document.systemOfRecord || 'unspecified',
      content,
    },
    mode: normalizedMode,
    query,
    filters,
    metadata: {
      requestTimestamp: timestamp,
      ...metadata,
    },
    chunkConfig: {
      chunkSize: 1200,
      chunkOverlap: 180,
    },
    requestId: createRequestId(),
  };
};

class SummaryPipelineService {
  constructor(endpoint = DEFAULT_ENDPOINT) {
    this.endpoint = endpoint;
  }

  async createSummary(params) {
    const payload = buildSummaryRequest(params);

    const headers = await this.buildAuthHeaders();
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw await this.normalizeError(response);
    }

    return response.json();
  }

  async getSummary(summaryId) {
    if (!summaryId || typeof summaryId !== 'string') {
      throw new Error('summaryId must be provided');
    }

    const headers = await this.buildAuthHeaders();
    const response = await fetch(`${this.endpoint}?summary_id=${encodeURIComponent(summaryId)}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw await this.normalizeError(response);
    }

    return response.json();
  }

  async buildAuthHeaders() {
    const token = await getToken();
    const userId = await getUserId();

    if (!token) {
      throw new Error('Authentication token is required to call the summary pipeline');
    }
    if (!userId) {
      throw new Error('User identity is required to call the summary pipeline');
    }

    return {
      Authorization: `Bearer ${token}`,
      'x-user-id': userId,
      'X-Client-Version': '2.1.0',
    };
  }

  async normalizeError(response) {
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      payload = { error: response.statusText || 'Unknown error' };
    }

    const message = payload?.error || payload?.message || `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.details = payload;
    return error;
  }
}

function normalizeDetail(detail) {
  if (!detail) {
    return DETAIL_LEVELS.STANDARD;
  }

  const normalized = String(detail).trim().toLowerCase();
  if (normalized.startsWith('brief')) {
    return DETAIL_LEVELS.BRIEF;
  }
  if (normalized.startsWith('deep')) {
    return DETAIL_LEVELS.DEEP_DIVE;
  }
  if (normalized.startsWith('standard')) {
    return DETAIL_LEVELS.STANDARD;
  }
  return DETAIL_LEVELS.STANDARD;
}

function createDeterministicId(content) {
  if (typeof globalThis !== 'undefined') {
    const nativeCrypto = globalThis.crypto;
    if (nativeCrypto && typeof nativeCrypto.randomUUID === 'function') {
      const seeded = hashCode(content);
      const uuidFragment = Math.abs(seeded).toString(16).padStart(12, '0').slice(0, 12);
      return `doc_${uuidFragment}`;
    }
  }

  return `doc_${Math.abs(hashCode(content)).toString(16).padStart(8, '0').slice(0, 12)}`;
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function hashCode(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

const summaryPipelineService = new SummaryPipelineService();

export default summaryPipelineService;
export { SummaryPipelineService, DETAIL_LEVELS };
