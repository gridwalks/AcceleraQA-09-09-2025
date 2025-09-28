// src/components/ChatArea.js - DEPLOYMENT READY (fixes DatabaseOff issue)

import React, { useCallback } from 'react';
import { Send, Loader2, Database, Paperclip, X, ExternalLink, BookOpen, FileDown, Trash2 } from 'lucide-react';
import { exportToWord } from '../utils/exportUtils';

const createUnicodeLetterRegex = () => {
  try {
    return new RegExp('\\p{L}', 'u');
  } catch (error) {
    return /[a-z]/i;
  }
};

const UNICODE_LETTER_REGEX = createUnicodeLetterRegex();

const isPdfAttachment = (file) => {
  if (!file) return false;
  const name = typeof file.name === 'string' ? file.name.toLowerCase() : '';
  const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  return name.endsWith('.pdf') || type === 'application/pdf';
};

const getSourceUrl = (source) => {
  if (!source || typeof source !== 'object') {
    return null;
  }

  const candidateValues = [
    source.url,
    source.link,
    source.href,
    source.downloadUrl,
    source.sourceUrl,
    source.webUrl,
    source.fileUrl,
    source.file_url,
    source.location,
  ];

  const nestedCandidates = [
    source.metadata,
    source.document,
    source.file_citation,
  ];

  nestedCandidates.forEach(candidate => {
    if (!candidate || typeof candidate !== 'object') {
      return;
    }

    candidateValues.push(
      candidate.url,
      candidate.link,
      candidate.href,
      candidate.downloadUrl,
      candidate.sourceUrl,
      candidate.webUrl,
      candidate.fileUrl,
      candidate.file_url,
    );
  });

  const isValidUrl = (value) => {
    if (typeof value !== 'string') {
      return false;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return false;
    }

    if (/^(https?:\/\/|\/)/i.test(trimmed)) {
      return true;
    }

    return false;
  };

  const resolved = candidateValues.find(isValidUrl);
  return resolved ? resolved.trim() : null;
};

const getFirstNonEmptyString = (...values) => {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return '';
};

const FILENAME_EXTENSION_PATTERN =
  /\.(pdf|docx|doc|txt|md|rtf|xlsx|xls|csv|pptx|ppt|zip|json|xml|yaml|yml|html|htm|log)$/i;

const isLikelyFilename = (value) => {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (/[\\/]/.test(trimmed)) {
    return true;
  }

  if (FILENAME_EXTENSION_PATTERN.test(trimmed)) {
    return true;
  }

  if (!/\s/.test(trimmed) && /\.[a-z0-9]{2,5}$/i.test(trimmed)) {
    return true;
  }

  return false;
};

const OPAQUE_ID_PATTERNS = [
  /^file[-_][a-z0-9]{6,}$/i,
  /^doc[-_][a-z0-9]{6,}$/i,
  /^tmp[-_][a-z0-9]{6,}$/i,
  /^ts[-_][a-z0-9]{6,}$/i,
  /^cs[-_][a-z0-9]{6,}$/i,
  /^as[-_][a-z0-9]{6,}$/i,
  /^vs[-_][a-z0-9]{6,}$/i,
  /^[a-f0-9]{8,}(?:-[a-f0-9]{4}){3,4}$/i,
];

const isLikelyOpaqueIdentifier = (value) => {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (!UNICODE_LETTER_REGEX.test(trimmed)) {
    return true;
  }

  return OPAQUE_ID_PATTERNS.some(pattern => pattern.test(trimmed));
};

const getSourceTitleCandidates = (source) => {
  if (!source || typeof source !== 'object') {
    return [];
  }

  const metadata =
    source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const document =
    source.document && typeof source.document === 'object' ? source.document : {};
  const documentMetadata =
    document.metadata && typeof document.metadata === 'object' ? document.metadata : {};
  const metadataDocumentMetadata =
    metadata.documentMetadata && typeof metadata.documentMetadata === 'object'
      ? metadata.documentMetadata
      : {};
  const fileCitation =
    source.file_citation && typeof source.file_citation === 'object'
      ? source.file_citation
      : {};
  const fileCitationMetadata =
    fileCitation.metadata && typeof fileCitation.metadata === 'object' ? fileCitation.metadata : {};

  const seen = new Set();
  const priorityCandidates = [];
  const nonFileCandidates = [];
  const fileCandidates = [];

  const pushCandidate = (rawValue, target) => {
    if (typeof rawValue !== 'string') {
      return;
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
      return;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    target.push(trimmed);
  };

  const pushPriority = (value) => pushCandidate(value, priorityCandidates);
  const pushNonFile = (value) => pushCandidate(value, nonFileCandidates);
  const pushFile = (value) => pushCandidate(value, fileCandidates);

  pushPriority(source.citation);
  pushPriority(source.citationText);
  pushPriority(source.citation_text);
  pushPriority(source.citationLabel);
  pushPriority(source.citation_label);
  pushPriority(source.documentCitation);
  pushPriority(source.document_citation);
  pushPriority(source.documentCitationText);
  pushPriority(source.document_citation_text);
  pushPriority(source.documentCitationLabel);
  pushPriority(source.document_citation_label);
  pushPriority(metadata.citation);
  pushPriority(metadata.citationText);
  pushPriority(metadata.citation_text);
  pushPriority(metadata.citationLabel);
  pushPriority(metadata.citation_label);
  pushPriority(metadata.documentCitation);
  pushPriority(metadata.document_citation);
  pushPriority(metadata.documentCitationText);
  pushPriority(metadata.document_citation_text);
  pushPriority(metadata.documentCitationLabel);
  pushPriority(metadata.document_citation_label);
  pushPriority(metadataDocumentMetadata.citation);
  pushPriority(metadataDocumentMetadata.citationText);
  pushPriority(metadataDocumentMetadata.citation_text);
  pushPriority(metadataDocumentMetadata.documentCitation);
  pushPriority(metadataDocumentMetadata.document_citation);
  pushPriority(metadataDocumentMetadata.documentCitationText);
  pushPriority(metadataDocumentMetadata.document_citation_text);
  pushPriority(metadataDocumentMetadata.documentCitationLabel);
  pushPriority(metadataDocumentMetadata.document_citation_label);
  pushPriority(document.citation);
  pushPriority(document.citationText);
  pushPriority(document.citation_text);
  pushPriority(document.citationLabel);
  pushPriority(document.citation_label);
  pushPriority(document.documentCitation);
  pushPriority(document.document_citation);
  pushPriority(document.documentCitationText);
  pushPriority(document.document_citation_text);
  pushPriority(document.documentCitationLabel);
  pushPriority(document.document_citation_label);
  pushPriority(documentMetadata.citation);
  pushPriority(documentMetadata.citationText);
  pushPriority(documentMetadata.citation_text);
  pushPriority(documentMetadata.citationLabel);
  pushPriority(documentMetadata.citation_label);
  pushPriority(documentMetadata.documentCitation);
  pushPriority(documentMetadata.document_citation);
  pushPriority(documentMetadata.documentCitationText);
  pushPriority(documentMetadata.document_citation_text);
  pushPriority(documentMetadata.documentCitationLabel);
  pushPriority(documentMetadata.document_citation_label);
  pushPriority(fileCitation.citation);
  pushPriority(fileCitation.citationText);
  pushPriority(fileCitation.citation_text);
  pushPriority(fileCitation.citationLabel);
  pushPriority(fileCitation.citation_label);
  pushPriority(fileCitation.documentCitation);
  pushPriority(fileCitation.document_citation);
  pushPriority(fileCitation.documentCitationText);
  pushPriority(fileCitation.document_citation_text);
  pushPriority(fileCitation.documentCitationLabel);
  pushPriority(fileCitation.document_citation_label);
  pushPriority(fileCitationMetadata.citation);
  pushPriority(fileCitationMetadata.citationText);
  pushPriority(fileCitationMetadata.citation_text);
  pushPriority(fileCitationMetadata.citationLabel);
  pushPriority(fileCitationMetadata.citation_label);
  pushPriority(fileCitationMetadata.documentCitation);
  pushPriority(fileCitationMetadata.document_citation);
  pushPriority(fileCitationMetadata.documentCitationText);
  pushPriority(fileCitationMetadata.document_citation_text);
  pushPriority(fileCitationMetadata.documentCitationLabel);
  pushPriority(fileCitationMetadata.document_citation_label);

  pushNonFile(source.documentTitle);
  pushNonFile(source.document_title);
  pushNonFile(source.title);
  pushNonFile(source.displayTitle);
  pushNonFile(source.display_title);
  pushNonFile(source.displayName);
  pushNonFile(source.display_name);
  pushNonFile(source.sourceTitle);
  pushNonFile(source.source_title);
  pushNonFile(source.label);
  pushNonFile(source.name);
  pushNonFile(source.fileTitle);
  pushNonFile(source.file_title);

  pushNonFile(metadata.documentTitle);
  pushNonFile(metadata.document_title);
  pushNonFile(metadata.title);
  pushNonFile(metadata.displayTitle);
  pushNonFile(metadata.display_title);
  pushNonFile(metadata.displayName);
  pushNonFile(metadata.display_name);
  pushNonFile(metadata.name);
  pushNonFile(metadata.preferredTitle);
  pushNonFile(metadata.documentName);
  pushNonFile(metadata.document_name);
  pushNonFile(metadata.fileTitle);
  pushNonFile(metadata.file_title);

  pushNonFile(document.title);
  pushNonFile(document.documentTitle);
  pushNonFile(document.document_title);
  pushNonFile(document.fileTitle);
  pushNonFile(document.file_title);

  pushNonFile(documentMetadata.title);
  pushNonFile(documentMetadata.documentTitle);
  pushNonFile(documentMetadata.document_title);
  pushNonFile(documentMetadata.displayTitle);
  pushNonFile(documentMetadata.display_title);
  pushNonFile(documentMetadata.displayName);
  pushNonFile(documentMetadata.display_name);
  pushNonFile(documentMetadata.name);
  pushNonFile(documentMetadata.fileTitle);
  pushNonFile(documentMetadata.file_title);

  pushNonFile(metadataDocumentMetadata.title);
  pushNonFile(metadataDocumentMetadata.documentTitle);
  pushNonFile(metadataDocumentMetadata.document_title);
  pushNonFile(metadataDocumentMetadata.displayTitle);
  pushNonFile(metadataDocumentMetadata.display_title);
  pushNonFile(metadataDocumentMetadata.displayName);
  pushNonFile(metadataDocumentMetadata.display_name);
  pushNonFile(metadataDocumentMetadata.name);
  pushNonFile(metadataDocumentMetadata.fileTitle);
  pushNonFile(metadataDocumentMetadata.file_title);

  pushNonFile(fileCitation.title);
  pushNonFile(fileCitation.documentTitle);
  pushNonFile(fileCitation.document_title);
  pushNonFile(fileCitation.fileTitle);
  pushNonFile(fileCitation.file_title);

  pushFile(metadata.filename);
  pushFile(metadata.fileName);
  pushFile(metadata.file_name);
  pushFile(metadata.originalFileName);
  pushFile(metadata.finalFileName);

  pushFile(source.filename);
  pushFile(source.file_name);
  pushFile(source.fileName);

  pushFile(document.filename);
  pushFile(document.file_name);

  pushFile(fileCitation.filename);
  pushFile(fileCitation.file_name);

  return [...priorityCandidates, ...nonFileCandidates, ...fileCandidates];
};

const selectPreferredSourceTitle = (candidates, fallbackLabel) => {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return fallbackLabel;
  }

  const preferred = candidates.find(
    candidate => !isLikelyFilename(candidate) && !isLikelyOpaqueIdentifier(candidate)
  );

  return preferred || fallbackLabel;
};


const SOURCE_SNIPPET_MAX_LENGTH = 180;

const SNIPPET_FIELD_KEYS = [
  'text',
  'snippet',
  'quote',
  'preview',
  'excerpt',
  'content',
  'value',
  'summary',
  'chunkText',
  'chunk_text',
  'context',
  'documentText',
  'document_text',
  'documentSnippet',
  'document_snippet',
  'textSnippet',
  'text_snippet',
  'highlight',
  'passage',
  'passage_text',
  'passageText',
  'segment',
  'span',
];

const SNIPPET_FIELD_KEY_SET = new Set(SNIPPET_FIELD_KEYS.map(key => key.toLowerCase()));

const SNIPPET_DISALLOWED_PATTERNS = [
  /^(https?:\/\/|mailto:|ftp:|file:)/i,
  /^[\w\s-]+\.(pdf|docx|doc|txt|md|rtf|xlsx|xls|csv|pptx|ppt|zip|json|xml|mp3|mp4|mov|avi|png|jpg|jpeg)$/i,
];

const BASE_EXCLUDED_KEYS = new Set([
  'title',
  'documenttitle',
  'filename',
  'file_name',
  'name',
  'label',
  'displayname',
  'documentname',
]);

const normalizeSnippetText = (value) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const getFallbackSnippet = (source) => {
  const fallback = normalizeSnippetText(
    getFirstNonEmptyString(
      source?.text,
      source?.snippet,
      source?.quote,
      source?.preview,
      source?.excerpt,
      source?.content,
      source?.value,
      source?.summary,
      source?.chunkText,
      source?.chunk_text,
      source?.context,
      source?.metadata?.text,
      source?.metadata?.snippet,
      source?.metadata?.excerpt,
      source?.file_citation?.quote
    )
  );

  if (!fallback || isLikelyFilename(fallback)) {
    return '';
  }

  return fallback;
};

const buildExclusionSet = (values = []) => {
  const set = new Set();
  values.forEach(value => {
    if (typeof value === 'string') {
      const normalized = normalizeSnippetText(value);
      if (normalized) {
        set.add(normalized.toLowerCase());
      }
    }
  });
  return set;
};

const getKeyWeight = (rawKey = '') => {
  const key = String(rawKey).toLowerCase();

  if (SNIPPET_FIELD_KEY_SET.has(key)) {
    return 9;
  }

  if (BASE_EXCLUDED_KEYS.has(key)) {
    return 0;
  }

  if (key.includes('snippet') || key.includes('excerpt') || key.includes('quote')) {
    return 8;
  }

  if (
    key.includes('highlight') ||
    key.includes('passage') ||
    key.includes('span') ||
    key.includes('segment')
  ) {
    return 7;
  }

  if (
    key.includes('text') ||
    key.includes('content') ||
    key.includes('context') ||
    key.includes('paragraph') ||
    key.includes('section') ||
    key.includes('body') ||
    key.includes('description') ||
    key.includes('summary')
  ) {
    return 6;
  }

  if (key.includes('metadata') || key.includes('document') || key.includes('chunk')) {
    return 4;
  }

  return 2;
};

const isDisallowedSnippet = (text) => {
  if (!text) {
    return true;
  }

  if (SNIPPET_DISALLOWED_PATTERNS.some(pattern => pattern.test(text))) {
    return true;
  }

  if (isLikelyOpaqueIdentifier(text)) {
    return true;
  }

  if (/^document\s+\d+$/i.test(text)) {
    return true;
  }

  if (/^[\d\-]+$/.test(text)) {
    return true;
  }

  if (text.length <= 8 && !text.includes(' ')) {
    return true;
  }

  return false;
};

function scoreSnippetCandidate(text, weight) {
  const length = text.length;
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  let score = weight;

  if (length >= 200) score += 4;
  else if (length >= 120) score += 3;
  else if (length >= 80) score += 2.5;
  else if (length >= 40) score += 2;
  else if (length >= 24) score += 1.2;
  else if (length >= 16) score += 0.6;

  if (wordCount >= 25) score += 3;
  else if (wordCount >= 12) score += 2;
  else if (wordCount >= 7) score += 1.4;
  else if (wordCount >= 4) score += 0.8;

  if (wordCount <= 2 && length < 20) {
    score -= 2;
  }

  if (/[.!?]/.test(text.slice(-1))) {
    score += 0.5;
  }

  if (/[,;:]/.test(text)) {
    score += 0.3;
  }

  if (text === text.toUpperCase() && wordCount >= 3) {
    score -= 1.5;
  }

  return score;
}

function getSourceSnippet(source, options = {}) {
  if (!source || typeof source !== 'object') {
    return null;
  }

  const excludedValues = buildExclusionSet(options.excludeValues);

  const visited = new WeakSet();
  let bestCandidate = null;

  function considerText(value, weight) {
    const normalized = normalizeSnippetText(value);
    if (!normalized) {
      return;
    }

    if (excludedValues.has(normalized.toLowerCase())) {
      return;
    }

    if (isLikelyFilename(normalized)) {
      return;
    }

    if (isLikelyOpaqueIdentifier(normalized) || isDisallowedSnippet(normalized)) {
      return;
    }

    const score = scoreSnippetCandidate(normalized, weight);
    if (score <= 0) {
      return;
    }

    if (!bestCandidate || score > bestCandidate.score || (score === bestCandidate.score && normalized.length > bestCandidate.text.length)) {
      bestCandidate = { text: normalized, score };
    }
  }

  function traverse(value, weight = 2) {
    if (value == null) {
      return;
    }

    if (typeof value === 'string') {
      considerText(value, weight);
      return;
    }

    if (typeof value !== 'object') {
      return;
    }

    if (visited.has(value)) {
      return;
    }

    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach(entry => traverse(entry, weight));
      return;
    }

    Object.entries(value).forEach(([key, nested]) => {
      if (nested == null) {
        return;
      }

      const keyWeight = getKeyWeight(key);
      const nextWeight = Math.max(weight, keyWeight);
      traverse(nested, nextWeight);
    });
  }

  traverse(source, 7);

  return bestCandidate ? bestCandidate.text : null;
}

const AttachmentPreview = ({ file, onRemove }) => {
  const needsConversion = file ? !isPdfAttachment(file) : false;

  return (
    <div className="mt-2 flex items-center justify-between gap-3 rounded border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
      <div className="min-w-0">
        <div className="truncate font-medium text-gray-700" title={file?.name}>
          {file?.name || 'Attached document'}
        </div>
        <div className="text-[11px] text-gray-500">
          {needsConversion ? 'Will convert to PDF before sending' : 'Ready to send to assistant'}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="flex items-center gap-1 rounded-full border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 transition hover:border-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
      >
        <X className="h-3 w-3" aria-hidden="true" />
        <span>Remove</span>
      </button>
    </div>
  );
};

const ChatArea = ({
  messages,
  inputMessage,
  setInputMessage,
  isLoading,
  handleSendMessage,
  handleKeyPress,
  messagesEndRef,
  ragEnabled,
  setRAGEnabled,
  isSaving,
  uploadedFile,
  setUploadedFile,
  cooldown, // rate-limit cooldown (seconds)
  onClearChat,
}) => {
  const inputLength = typeof inputMessage === 'string' ? inputMessage.length : 0;
  const trimmedInputMessage = typeof inputMessage === 'string' ? inputMessage.trim() : '';
  const hasMessages = Array.isArray(messages) && messages.length > 0;
  const hasAttachment = Boolean(uploadedFile);
  const canClearChat = Boolean(onClearChat) && (hasMessages || hasAttachment || trimmedInputMessage.length > 0);
  const clearButtonDisabled = isLoading || !canClearChat;

  const handleExportStudyNotes = useCallback((studyNotesMessage) => {
    if (!studyNotesMessage) {
      return;
    }

    try {
      exportToWord(studyNotesMessage);
    } catch (error) {
      console.error('Failed to export notes to Word:', error);
    }
  }, []);

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Chat Header with RAG Toggle */}
      <div className="flex-shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900">
              Document Assistant
            </h2>
            {isSaving && (
              <div className="flex items-center space-x-2 text-sm text-blue-600">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent"></div>
                <span className="hidden sm:inline">Saving...</span>
              </div>
            )}
          </div>

          {/* RAG Toggle Switch */}
          <label
            className="flex items-center space-x-2 cursor-pointer"
            title={ragEnabled ? 'RAG enabled - searching uploaded documents' : 'RAG disabled - AI knowledge only'}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={ragEnabled}
              onChange={() => setRAGEnabled(!ragEnabled)}
            />
            <span
              className={`relative inline-block h-5 w-10 rounded-full transition-colors ${
                ragEnabled ? 'bg-purple-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`absolute left-1 top-1 h-3 w-3 rounded-full bg-white transition-transform ${
                  ragEnabled ? 'translate-x-5' : ''
                }`}
              />
            </span>
            <span className="hidden sm:inline text-sm">
              {ragEnabled ? 'Document Search' : 'AI Knowledge'}
            </span>
          </label>
        </div>

        {/* RAG Status Description */}
        {ragEnabled && (
          <div className="mt-2 text-sm text-purple-600 bg-purple-50 px-3 py-1 rounded-md flex items-center space-x-2">
            <Database className="h-3 w-3" />
            <span>Searching uploaded documents for relevant context</span>
          </div>
        )}
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 min-h-0">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <div className="text-4xl sm:text-6xl mb-4">🚀</div>
              <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">
                What can I help you with today?
              </h3>
            </div>
          </div>
        ) : (
          <>
            {messages
              .filter(message => !message.isResource)
              .map((message, index) => {
                const isUserMessage = message.role === 'user';
                const messageText = typeof message.content === 'string' ? message.content : '';
                const hasMessageText = messageText.trim().length > 0;
                const attachments = Array.isArray(message.attachments) ? message.attachments : [];
                const canExportStudyNotes = Boolean(
                  message.isStudyNotes && (message.studyNotesData?.content || message.content)
                );

                return (
                  <div key={index} className={`flex ${isUserMessage ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] lg:max-w-[75%] p-3 sm:p-4 rounded-lg ${
                        isUserMessage
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-900 border border-gray-200'
                      }`}
                    >
                      {/* Message Content */}
                      {hasMessageText && (
                        <div className="whitespace-pre-wrap text-sm sm:text-base leading-relaxed">
                          {messageText}
                        </div>
                      )}

                      {/* Attachments Display */}
                      {attachments.length > 0 && (
                        <div className={`space-y-2 ${hasMessageText ? 'mt-3' : ''}`}>
                          {attachments.map((attachment, attachmentIndex) => {
                            const hasDifferentNames =
                              attachment.originalFileName &&
                              attachment.finalFileName &&
                              attachment.originalFileName !== attachment.finalFileName;

                            let detailText = null;

                            if (attachment.converted) {
                              detailText = hasDifferentNames
                                ? `Converted from ${attachment.originalFileName}`
                                : 'Converted to PDF';
                            } else if (hasDifferentNames) {
                              detailText = `Uploaded as ${attachment.originalFileName}`;
                            }

                            return (
                              <div
                                key={attachmentIndex}
                                className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
                                  isUserMessage
                                    ? 'border-blue-300/60 bg-blue-500/20 text-blue-50'
                                    : 'border-gray-300 bg-white text-gray-700'
                                }`}
                              >
                                <Paperclip
                                  className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${
                                    isUserMessage ? 'text-blue-100' : 'text-gray-500'
                                  }`}
                                />
                                <div className="min-w-0">
                                  <div
                                    className={`truncate font-medium ${
                                      isUserMessage ? 'text-white' : 'text-gray-900'
                                    }`}
                                    title={attachment.finalFileName || attachment.originalFileName || 'Attachment'}
                                  >
                                    {attachment.finalFileName || attachment.originalFileName || 'Attachment'}
                                  </div>
                                  {detailText && (
                                    <div className={isUserMessage ? 'text-blue-100' : 'text-gray-600'}>
                                      {detailText}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* RAG Sources Display */}
                      {message.sources && message.sources.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-300">
                          <div className="text-xs font-medium text-gray-600 mb-2 flex items-center space-x-1">
                            <Database className="h-3 w-3" />
                            <span>Sources from uploaded documents:</span>
                          </div>
                          <div className="space-y-1">
                            {message.sources.slice(0, 3).map((source, idx) => {
                              const sourceUrl = getSourceUrl(source);
                              const SourceWrapper = sourceUrl ? 'a' : 'div';
                              const isAbsoluteLink = sourceUrl ? /^https?:\/\//i.test(sourceUrl) : false;
                              const wrapperProps = sourceUrl
                                ? {
                                    href: sourceUrl,
                                    ...(isAbsoluteLink ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
                                  }
                                : {};

                              const titleCandidates = getSourceTitleCandidates(source);
                              const resolvedSourceTitle = selectPreferredSourceTitle(
                                titleCandidates,
                                `Document ${idx + 1}`
                              );

                              const snippetExclusions = [
                                resolvedSourceTitle,
                                ...titleCandidates,
                              ];

                              const fullSnippet = getSourceSnippet(source, {
                                excludeValues: snippetExclusions,
                              });
                              const fallbackSnippet = getFallbackSnippet(source);
                              const resolvedSnippet = fullSnippet || fallbackSnippet || null;
                              const displaySnippet =
                                resolvedSnippet && SOURCE_SNIPPET_MAX_LENGTH > 0 &&
                                resolvedSnippet.length > SOURCE_SNIPPET_MAX_LENGTH
                                  ? `${resolvedSnippet
                                      .slice(0, SOURCE_SNIPPET_MAX_LENGTH)
                                      .trimEnd()}…`
                                  : resolvedSnippet;

                              const citationNumber = typeof source?.citationNumber === 'number'
                                ? source.citationNumber
                                : typeof source?.metadata?.citationNumber === 'number'
                                  ? source.metadata.citationNumber
                                  : null;

                              const displayTitle = citationNumber
                                ? `[${citationNumber}] ${resolvedSourceTitle}`
                                : resolvedSourceTitle;

                              const baseClasses = 'text-xs bg-white bg-opacity-50 p-2 rounded border transition-colors';
                              const interactiveClasses = sourceUrl
                                ? 'block group hover:border-blue-400 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-1'
                                : '';

                              return (
                                <SourceWrapper
                                  key={idx}
                                  className={`${baseClasses} ${interactiveClasses}`.trim()}
                                  {...wrapperProps}
                                >
                                  <div
                                    className={`font-medium truncate ${sourceUrl ? 'text-blue-600 group-hover:text-blue-700 group-focus-visible:text-blue-700' : ''}`.trim()}
                                    title={displayTitle}
                                  >
                                    {displayTitle}
                                  </div>
                                  <div
                                    className="text-gray-600 line-clamp-2"
                                    title={resolvedSnippet || undefined}
                                  >
                                    {displaySnippet || 'No excerpt available.'}
                                  </div>
                                  {sourceUrl && (
                                    <div className="mt-1 flex items-center gap-1 text-[11px] text-blue-600">
                                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                      <span>Open source</span>
                                    </div>
                                  )}
                                </SourceWrapper>
                              );
                            })}
                            {message.sources.length > 3 && (
                              <div className="text-xs text-gray-500 italic">
                                ...and {message.sources.length - 3} more sources
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {message.isStudyNotes && (
                        <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
                              <BookOpen className="h-4 w-4" />
                              <span>Notes ready</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleExportStudyNotes(message)}
                              disabled={!canExportStudyNotes}
                              className={`inline-flex items-center gap-2 rounded-md px-3 py-1 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                                canExportStudyNotes
                                  ? 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500'
                                  : 'bg-blue-100 text-blue-300 cursor-not-allowed focus:ring-blue-200'
                              }`}
                              aria-label="Export notes to Word"
                              title={
                                canExportStudyNotes
                                  ? 'Download a Word copy of these notes.'
                                  : 'Notes are not ready to export yet.'
                              }
                            >
                              <FileDown className="h-4 w-4" />
                              <span>Export to Word</span>
                            </button>
                          </div>
                          <p className="mt-2 text-xs text-blue-600">
                            Save these notes in your Notebook or export a Word copy for offline review.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 p-4 sm:p-6 border-t border-gray-200 bg-gray-50 rounded-b-lg mt-auto">
        {cooldown > 0 && (
          <div className="mb-2 text-sm text-yellow-700 bg-yellow-100 px-3 py-2 rounded">
            You're sending messages too quickly. Please wait {cooldown}s before trying again.
          </div>
        )}
        <div className="flex space-x-3">
          <div className="flex-shrink-0">
            <input
              type="file"
              id="chat-file-upload"
              accept=".pdf,.txt,.md,.docx,.csv,.xlsx"
              className="hidden"
              onChange={(e) => setUploadedFile(e.target.files[0] || null)}
            />
            <label
              htmlFor="chat-file-upload"
              className="flex min-w-[44px] cursor-pointer items-center justify-center rounded-lg bg-gray-200 px-3 py-3 text-gray-700 transition hover:bg-gray-300 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:px-4 sm:py-4"
              title="Attach a PDF, Word (.docx), Markdown (.md), Text (.txt), CSV (.csv), or Excel (.xlsx) document. Non-PDF files will be converted automatically."
            >
              <Paperclip className="h-4 w-4 sm:h-5 sm:w-5" />
            </label>
          </div>
          <div className="flex-1 relative">
            <textarea
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask about quality, compliance, or upload documents for specific guidance..."
              className="w-full p-3 sm:p-4 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm sm:text-base min-h-[44px] max-h-32"
              rows={1}
              style={{
                height: 'auto',
                overflowY: inputMessage.split('\n').length > 3 ? 'auto' : 'hidden',
              }}
              onInput={(e) => {
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px';
              }}
              disabled={isLoading}
            />
          </div>
          <button
            type="button"
            onClick={handleSendMessage}
            disabled={isLoading || cooldown > 0 || (!trimmedInputMessage && !uploadedFile)}
            className="flex min-w-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:px-6 sm:py-4"
            title={cooldown > 0 ? `Please wait ${cooldown}s` : 'Send message'}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
            ) : (
              <Send className="h-4 w-4 sm:h-5 sm:w-5" />
            )}
          </button>
        </div>

        {uploadedFile && (
          <AttachmentPreview file={uploadedFile} onRemove={() => setUploadedFile(null)} />
        )}

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {inputLength > 100 && (
            <div className="text-xs text-gray-500 text-right sm:text-left">
              {inputLength} characters
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              if (clearButtonDisabled || !onClearChat) {
                return;
              }
              onClearChat();
            }}
            disabled={clearButtonDisabled}
            aria-label="Clear chat history"
            title="Clear the current conversation"
            className="inline-flex items-center gap-2 self-end sm:self-auto sm:ml-auto rounded-md border border-transparent bg-white px-3 py-2 text-xs sm:text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
            <span>Clear chat</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export { getSourceSnippet, isDisallowedSnippet };
export default ChatArea;
