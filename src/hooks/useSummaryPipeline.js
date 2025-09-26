import { useState, useCallback, useMemo } from 'react';
import summaryPipelineService, { DETAIL_LEVELS } from '../services/summaryPipelineService';

export const ROLE_OPTIONS = [
  'Auditor',
  'QA Lead',
  'Engineer',
  'New Hire',
];

export const LENS_OPTIONS = [
  'Regulatory',
  'Risk & CAPA',
  'Training',
  'Timeline/Change log',
  'Testing & Evidence',
];

export const DETAIL_OPTIONS = [
  DETAIL_LEVELS.BRIEF,
  DETAIL_LEVELS.STANDARD,
  DETAIL_LEVELS.DEEP_DIVE,
];

const DEFAULT_MODE = {
  role: 'QA Lead',
  lens: 'Regulatory',
  detail: DETAIL_LEVELS.STANDARD,
};

const isString = (value) => typeof value === 'string' && value.trim().length > 0;

const normalizeMode = (mode = {}) => ({
  role: ROLE_OPTIONS.includes(mode.role) ? mode.role : DEFAULT_MODE.role,
  lens: LENS_OPTIONS.includes(mode.lens) ? mode.lens : DEFAULT_MODE.lens,
  detail: DETAIL_OPTIONS.includes(mode.detail) ? mode.detail : DEFAULT_MODE.detail,
});

const buildDocumentPayload = (document = {}) => {
  if (!document || typeof document !== 'object') {
    throw new Error('Document metadata is required to request a summary');
  }

  const text = document.content || document.text;
  if (!isString(text)) {
    throw new Error('Document content must be provided as a non-empty string');
  }

  return {
    doc_id: document.doc_id || document.id || `doc_${Date.now().toString(36)}`,
    title: document.title || document.filename || 'Untitled Document',
    version: document.version || '1.0',
    doc_type: document.doc_type || document.type || 'Document',
    owner: document.owner || 'unknown',
    effective_date: document.effective_date || document.effectiveDate || new Date().toISOString().slice(0, 10),
    system_of_record: document.system_of_record || document.systemOfRecord || 'unspecified',
    content: text,
  };
};

const buildFilters = (filters = {}) => {
  const normalized = {};

  if (Array.isArray(filters.tags) && filters.tags.length > 0) {
    normalized.tags = filters.tags.filter(isString);
  }

  if (Array.isArray(filters.sections) && filters.sections.length > 0) {
    normalized.sections = filters.sections.filter(isString);
  }

  return normalized;
};

const mergeMetadata = (metadata = {}) => ({
  requestedFrom: 'frontend',
  requestTimestamp: new Date().toISOString(),
  ...metadata,
});

const deriveStatus = (nextStatus, previousSummary) => {
  if (nextStatus === 'loading' && previousSummary) {
    return 'refreshing';
  }
  return nextStatus;
};

const useSummaryPipeline = ({ defaultMode = DEFAULT_MODE } = {}) => {
  const [summary, setSummary] = useState(null);
  const [diagnostics, setDiagnostics] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  const normalizedDefaultMode = useMemo(() => normalizeMode(defaultMode), [defaultMode]);

  const requestSummary = useCallback(
    async ({ document, mode, query = '', filters, metadata } = {}) => {
      const payload = {
        document: buildDocumentPayload(document),
        mode: normalizeMode(mode || normalizedDefaultMode),
        query: isString(query) ? query.trim() : '',
        filters: buildFilters(filters),
        metadata: mergeMetadata(metadata),
      };

      setStatus((prevStatus) => deriveStatus('loading', summary));
      setError(null);

      try {
        const response = await summaryPipelineService.createSummary(payload);
        setSummary(response.summary || null);
        setDiagnostics(Array.isArray(response.diagnostics) ? response.diagnostics : []);
        setMetrics(response.metrics || null);
        setStatus('succeeded');
        return response;
      } catch (requestError) {
        setStatus('failed');
        setSummary(null);
        setDiagnostics([]);
        setMetrics(null);
        setError(requestError);
        throw requestError;
      }
    },
    [normalizedDefaultMode, summary]
  );

  const fetchSummary = useCallback(
    async (summaryId) => {
      if (!isString(summaryId)) {
        throw new Error('A summaryId string is required to retrieve a stored summary');
      }

      setStatus((prevStatus) => deriveStatus('loading', summary));
      setError(null);

      try {
        const response = await summaryPipelineService.getSummary(summaryId.trim());
        const record = response?.summary || null;
        setSummary(record);
        setDiagnostics([]);
        setMetrics(null);
        setStatus('succeeded');
        return record;
      } catch (requestError) {
        setStatus('failed');
        setError(requestError);
        throw requestError;
      }
    },
    [summary]
  );

  const reset = useCallback(() => {
    setSummary(null);
    setDiagnostics([]);
    setMetrics(null);
    setStatus('idle');
    setError(null);
  }, []);

  const isLoading = status === 'loading' || status === 'refreshing';

  return {
    summary,
    diagnostics,
    metrics,
    status,
    error,
    isLoading,
    hasSummary: Boolean(summary),
    requestSummary,
    fetchSummary,
    reset,
    roleOptions: ROLE_OPTIONS,
    lensOptions: LENS_OPTIONS,
    detailOptions: DETAIL_OPTIONS,
  };
};

export default useSummaryPipeline;
