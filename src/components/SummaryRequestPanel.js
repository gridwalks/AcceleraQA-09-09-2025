import React, { useMemo, useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import {
  Sparkles,
  Loader,
  AlertCircle,
  ClipboardCopy,
  RefreshCw,
  ShieldCheck,
  ListChecks,
  FileText,
} from 'lucide-react';
import useSummaryPipeline from '../hooks/useSummaryPipeline';
import ragService from '../services/ragService';
import decodeDocumentContent from '../utils/documentTextUtils';

const parseListInput = (value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const buildDocumentForSummary = (document = {}, content = '') => {
  const metadata = document.metadata || {};
  return {
    doc_id: metadata.doc_id || document.id,
    title: metadata.title || document.filename || 'Untitled Document',
    version: metadata.version || metadata.revision || '1.0',
    doc_type: metadata.doc_type || metadata.category || document.type || 'Document',
    owner: metadata.owner || metadata.author || 'unknown',
    system_of_record: metadata.system_of_record || metadata.sourceSystem || 'AcceleraQA',
    effective_date: metadata.effective_date || metadata.effectiveDate || metadata.updatedAt || metadata.createdAt,
    content,
  };
};

const SummaryRequestPanel = ({ documents, user }) => {
  const {
    summary,
    diagnostics,
    metrics,
    status,
    error,
    isLoading,
    hasSummary,
    requestSummary,
    reset,
    roleOptions,
    lensOptions,
    detailOptions,
  } = useSummaryPipeline();

  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [documentContent, setDocumentContent] = useState('');
  const [documentWarnings, setDocumentWarnings] = useState([]);
  const [documentError, setDocumentError] = useState(null);
  const [isFetchingDocument, setIsFetchingDocument] = useState(false);
  const [mode, setMode] = useState({ role: 'QA Lead', lens: 'Regulatory', detail: detailOptions[1] || detailOptions[0] });
  const [query, setQuery] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [sectionsInput, setSectionsInput] = useState('');
  const [lastRequest, setLastRequest] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState('');

  useEffect(() => {
    if (!copyFeedback) {
      return undefined;
    }

    const timeout = setTimeout(() => setCopyFeedback(''), 2000);
    return () => clearTimeout(timeout);
  }, [copyFeedback]);

  const selectedDocument = useMemo(
    () => documents.find((doc) => String(doc.id) === String(selectedDocumentId)),
    [documents, selectedDocumentId]
  );

  useEffect(() => {
    if (!selectedDocumentId) {
      setDocumentContent('');
      setDocumentWarnings([]);
      setDocumentError(null);
      return undefined;
    }

    let isCancelled = false;

    const loadContent = async () => {
      setIsFetchingDocument(true);
      setDocumentError(null);
      setDocumentWarnings([]);

      try {
        const payload = await ragService.downloadDocument({ documentId: selectedDocumentId }, user?.sub);
        const { text, warnings } = decodeDocumentContent(payload);
        if (!isCancelled) {
          setDocumentContent(text);
          setDocumentWarnings(warnings);
        }
      } catch (loadError) {
        if (!isCancelled) {
          setDocumentError(loadError.message || 'Failed to load document content');
          setDocumentContent('');
        }
      } finally {
        if (!isCancelled) {
          setIsFetchingDocument(false);
        }
      }
    };

    loadContent();

    return () => {
      isCancelled = true;
    };
  }, [selectedDocumentId, user?.sub]);

  const handleGenerateSummary = useCallback(
    async (event) => {
      event.preventDefault();

      const trimmedContent = documentContent.trim();
      if (!trimmedContent) {
        setDocumentError('Add or load document content before generating a summary.');
        return;
      }

      const filters = {};
      const parsedTags = parseListInput(tagsInput);
      const parsedSections = parseListInput(sectionsInput);
      if (parsedTags.length > 0) {
        filters.tags = parsedTags;
      }
      if (parsedSections.length > 0) {
        filters.sections = parsedSections;
      }

      const documentPayload = buildDocumentForSummary(selectedDocument || {}, trimmedContent);
      const request = {
        document: documentPayload,
        mode,
        query,
        filters,
        metadata: {
          sourceDocumentId: selectedDocument?.id || null,
          filename: selectedDocument?.filename || null,
        },
      };

      try {
        setLastRequest(request);
        await requestSummary(request);
      } catch (requestError) {
        console.error('Failed to generate summary:', requestError);
      }
    },
    [documentContent, mode, query, requestSummary, sectionsInput, selectedDocument, tagsInput]
  );

  const handleReset = useCallback(() => {
    reset();
    setLastRequest(null);
    setCopyFeedback('');
  }, [reset]);

  const handleCopy = useCallback(async () => {
    if (!summary?.summary || typeof navigator === 'undefined' || !navigator?.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(summary.summary);
      setCopyFeedback('Copied!');
    } catch (copyError) {
      console.warn('Failed to copy summary to clipboard:', copyError);
    }
  }, [summary]);

  const showLoadingState = isLoading || isFetchingDocument;

  return (
    <section className="bg-white border border-blue-100 rounded-lg p-6 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-blue-600" />
            Generate QA Summary
          </h3>
          <p className="text-sm text-gray-600">
            Select a document, tailor role and lens, and AcceleraQA will orchestrate the multi-pass summarization pipeline with
            citations.
          </p>
        </div>
        {status === 'succeeded' && summary?.summary_id && (
          <div className="text-xs font-mono text-blue-600 bg-blue-50 border border-blue-200 rounded px-3 py-1">
            Summary ID: {summary.summary_id}
          </div>
        )}
      </div>

      <form onSubmit={handleGenerateSummary} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-1">
          <label htmlFor="summary-document" className="block text-sm font-medium text-gray-700 mb-1">
            Source document
          </label>
          <select
            id="summary-document"
            value={selectedDocumentId}
            onChange={(event) => setSelectedDocumentId(event.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a document…</option>
            {documents.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {(doc.metadata?.title || doc.filename || doc.id).slice(0, 80)}
              </option>
            ))}
          </select>
          {documentError && (
            <p className="mt-2 text-xs text-red-600 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {documentError}
            </p>
          )}
          {documentWarnings.length > 0 && (
            <p className="mt-2 text-xs text-amber-600 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {documentWarnings.join(' ')}
            </p>
          )}
        </div>

        <div className="md:col-span-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="summary-role" className="block text-sm font-medium text-gray-700 mb-1">
              Role
            </label>
            <select
              id="summary-role"
              value={mode.role}
              onChange={(event) => setMode((prev) => ({ ...prev, role: event.target.value }))}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {roleOptions.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="summary-lens" className="block text-sm font-medium text-gray-700 mb-1">
              Focus lens
            </label>
            <select
              id="summary-lens"
              value={mode.lens}
              onChange={(event) => setMode((prev) => ({ ...prev, lens: event.target.value }))}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {lensOptions.map((lens) => (
                <option key={lens} value={lens}>
                  {lens}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="summary-detail" className="block text-sm font-medium text-gray-700 mb-1">
              Detail level
            </label>
            <select
              id="summary-detail"
              value={mode.detail}
              onChange={(event) => setMode((prev) => ({ ...prev, detail: event.target.value }))}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {detailOptions.map((detail) => (
                <option key={detail} value={detail}>
                  {detail}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="summary-query" className="block text-sm font-medium text-gray-700 mb-1">
              Optional query emphasis
            </label>
            <input
              id="summary-query"
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="e.g., highlight CAPA closure evidence"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="summary-tags" className="block text-sm font-medium text-gray-700 mb-1">
                Tag filters
              </label>
              <input
                id="summary-tags"
                type="text"
                value={tagsInput}
                onChange={(event) => setTagsInput(event.target.value)}
                placeholder="risk, 21 CFR 11"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Comma-separated list applied during retrieval.</p>
            </div>
            <div>
              <label htmlFor="summary-sections" className="block text-sm font-medium text-gray-700 mb-1">
                Section filters
              </label>
              <input
                id="summary-sections"
                type="text"
                value={sectionsInput}
                onChange={(event) => setSectionsInput(event.target.value)}
                placeholder="4.2 Risk Assessment"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Helps target specific headings or annexes.</p>
            </div>
          </div>
        </div>

        <div className="md:col-span-2">
          <label htmlFor="summary-content" className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
            <FileText className="h-4 w-4 text-gray-500" />
            Document content
          </label>
          <textarea
            id="summary-content"
            value={documentContent}
            onChange={(event) => setDocumentContent(event.target.value)}
            rows={6}
            placeholder="Paste or load document text to summarize"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {selectedDocument && (
            <p className="text-xs text-gray-500 mt-1">
              Editing the text here lets you regenerate summaries with quick adjustments before re-uploading.
            </p>
          )}
        </div>

        <div className="md:col-span-2 flex flex-wrap gap-3 justify-between items-center border-t border-gray-100 pt-4">
          <div className="text-sm text-gray-500 flex items-center gap-2">
            {showLoadingState ? (
              <Loader className="h-4 w-4 animate-spin text-blue-600" />
            ) : (
              <ListChecks className="h-4 w-4 text-blue-600" />
            )}
            {showLoadingState ? 'Running retrieval, orchestration, and guardrails…' : 'Pipeline ready.'}
          </div>
          <div className="flex items-center gap-2">
            {hasSummary && (
              <button
                type="button"
                onClick={handleReset}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-md hover:border-gray-400 transition"
              >
                <RefreshCw className="h-4 w-4 mr-2 inline" />
                Reset
              </button>
            )}
            <button
              type="submit"
              disabled={showLoadingState || !documentContent.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Sparkles className="h-4 w-4" />
              {showLoadingState ? 'Generating…' : 'Generate summary'}
            </button>
          </div>
        </div>
      </form>

      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5" />
          <div>
            <p className="font-medium">Summary request failed</p>
            <p>{error.message}</p>
          </div>
        </div>
      )}

      {summary && (
        <div className="mt-6 space-y-6">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <h4 className="text-md font-semibold text-gray-900 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              Guarded summary output
            </h4>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              {copyFeedback && <span className="text-emerald-600 font-medium">{copyFeedback}</span>}
              <button
                type="button"
                onClick={handleCopy}
                disabled={!summary.summary}
                className="inline-flex items-center gap-1 px-2 py-1 border border-gray-300 rounded-md hover:border-gray-400 text-gray-600 hover:text-gray-800"
              >
                <ClipboardCopy className="h-3 w-3" />
                Copy summary
              </button>
            </div>
          </div>

          <div className="bg-slate-900 text-slate-100 text-sm rounded-lg p-4 whitespace-pre-wrap overflow-auto max-h-96">
            {summary.summary}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="border border-gray-200 rounded-lg p-4">
              <h5 className="text-sm font-semibold text-gray-800 mb-2">Citations</h5>
              {Array.isArray(summary.citations) && summary.citations.length > 0 ? (
                <ul className="space-y-2 text-sm text-gray-700">
                  {summary.citations.map((citation) => (
                    <li key={citation.chunk_id} className="border border-gray-100 rounded-md p-2">
                      <p className="font-medium text-gray-900">[{citation.citationNumber}] Sec {citation.section} · p.{citation.page}</p>
                      <p className="text-xs text-gray-600 mt-1">{citation.preview}</p>
                      <p className="text-xs text-gray-500 mt-1">Confidence: {(citation.score * 100).toFixed(0)}%</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">No citations were attached to this summary.</p>
              )}
            </div>

            <div className="border border-gray-200 rounded-lg p-4">
              <h5 className="text-sm font-semibold text-gray-800 mb-2">Metrics</h5>
              <ul className="text-sm text-gray-700 space-y-1">
                <li>Latency: {metrics?.latencyMs ? `${metrics.latencyMs.toLocaleString()} ms` : '—'}</li>
                <li>Chunks retrieved: {metrics?.retrievedCount ?? '—'}</li>
                <li>Chunks analyzed: {metrics?.chunkCount ?? '—'}</li>
                <li>Citation density: {metrics?.citationDensity ? metrics.citationDensity.toFixed(2) : '—'}</li>
                <li>Confidence: {metrics?.confidence ? (metrics.confidence * 100).toFixed(0) + '%' : summary.confidence * 100 + '%'}</li>
              </ul>
              {lastRequest && (
                <div className="mt-3 text-xs text-gray-500">
                  Mode: {lastRequest.mode.role} · {lastRequest.mode.lens} · {lastRequest.mode.detail}
                </div>
              )}
            </div>

            <div className="border border-gray-200 rounded-lg p-4">
              <h5 className="text-sm font-semibold text-gray-800 mb-2">Guardrail status</h5>
              {summary.guardrails?.violations?.length ? (
                <ul className="text-sm text-red-600 space-y-1">
                  {summary.guardrails.violations.map((violation) => (
                    <li key={violation.code}>
                      <span className="font-medium">{violation.code}:</span> {violation.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-emerald-600">No guardrail violations detected.</p>
              )}
            </div>
          </div>

          {diagnostics.length > 0 && (
            <div className="border border-gray-200 rounded-lg p-4">
              <h5 className="text-sm font-semibold text-gray-800 mb-3">Diagnostics</h5>
              <ol className="space-y-2 text-sm text-gray-700">
                {diagnostics.map((entry, index) => (
                  <li key={`${entry.stage}-${index}`} className="border border-gray-100 rounded-md p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-900">{entry.stage}</span>
                      {entry.metadata && (
                        <span className="text-xs text-gray-500 font-mono">
                          {JSON.stringify(entry.metadata)}
                        </span>
                      )}
                    </div>
                    <p className="text-gray-600 mt-1">{entry.message}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

SummaryRequestPanel.propTypes = {
  documents: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    filename: PropTypes.string,
    metadata: PropTypes.object,
  })).isRequired,
  user: PropTypes.shape({
    sub: PropTypes.string,
  }),
};

SummaryRequestPanel.defaultProps = {
  user: null,
};

export default SummaryRequestPanel;
