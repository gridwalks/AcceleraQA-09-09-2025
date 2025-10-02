// Enhanced with Learning Suggestions
import React, { memo, useState, useEffect, useRef, useCallback } from 'react';
import {
  Search,
  ChevronRight,
  ExternalLink,
  BookOpen,
  Brain,
  Sparkles,
  Target,
  Award,
  BookmarkPlus,
  Check,
  FileText,
  Loader2,
  X,
  Download,
  AlertCircle,
  Eye,
  MessageSquare,
  Clock,
  Trash2,
} from 'lucide-react';
import learningSuggestionsService from '../services/learningSuggestionsService';
import { FEATURE_FLAGS } from '../config/featureFlags';
import ragService from '../services/ragService';
import chatHistoryService from '../services/chatHistoryService';

const isGzipCompressed = (bytes) =>
  bytes && bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

let cachedUngzipImplementation = null;

const getUngzipImplementation = () => {
  if (cachedUngzipImplementation) return cachedUngzipImplementation;

  const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};
  const candidates = [globalScope.pako, globalScope.Pako, globalScope.PAKO];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const ungzipFn = typeof candidate.ungzip === 'function'
      ? candidate.ungzip.bind(candidate)
      : typeof candidate.inflate === 'function'
        ? candidate.inflate.bind(candidate)
        : null;
    if (ungzipFn) {
      cachedUngzipImplementation = (input) => {
        const result = ungzipFn(input);
        return result instanceof Uint8Array ? result : new Uint8Array(result);
      };
      return cachedUngzipImplementation;
    }
  }

  return null;
};

const inflateGzipBytes = async (gzipBytes) => {
  if (!isGzipCompressed(gzipBytes)) {
    return gzipBytes;
  }

  if (typeof DecompressionStream === 'function' && typeof Response === 'function') {
    try {
      const sourceStream = new Response(gzipBytes).body;
      if (sourceStream) {
        const decompressedStream = sourceStream.pipeThrough(new DecompressionStream('gzip'));
        const arrayBuffer = await new Response(decompressedStream).arrayBuffer();
        return new Uint8Array(arrayBuffer);
      }
    } catch (error) {
      console.warn('Failed to inflate gzip payload with DecompressionStream; falling back to pako.', error);
    }
  }

  const ungzipImplementation = getUngzipImplementation();
  if (ungzipImplementation) {
    try {
      return ungzipImplementation(gzipBytes);
    } catch (error) {
      console.error('Failed to inflate gzip payload via pako fallback.', error);
    }
  }

  console.warn('No gzip decompression fallback is available; returning original bytes.');
  return gzipBytes;
};

const PDF_HEADER_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PDF_HEADER_MAX_SCAN_BYTES = 1024;
const BOM_SEQUENCES = [
  [0xef, 0xbb, 0xbf], // UTF-8
  [0xff, 0xfe], // UTF-16 LE
  [0xfe, 0xff], // UTF-16 BE
];

const matchesByteSequence = (bytes, offset, sequence) => {
  if (!bytes || !sequence || offset + sequence.length > bytes.length) {
    return false;
  }

  for (let index = 0; index < sequence.length; index += 1) {
    if (bytes[offset + index] !== sequence[index]) {
      return false;
    }
  }

  return true;
};

const findPdfHeaderIndex = (bytes) => {
  if (!bytes || bytes.length < PDF_HEADER_BYTES.length) {
    return -1;
  }

  const maxOffset = Math.min(bytes.length - PDF_HEADER_BYTES.length, PDF_HEADER_MAX_SCAN_BYTES);

  for (let offset = 0; offset <= maxOffset; offset += 1) {
    if (offset === 0) {
      const bomMatch = BOM_SEQUENCES.find((sequence) => matchesByteSequence(bytes, offset, sequence));
      if (bomMatch) {
        offset += bomMatch.length - 1;
        continue;
      }
    }

    let matches = true;
    for (let headerIndex = 0; headerIndex < PDF_HEADER_BYTES.length; headerIndex += 1) {
      if (bytes[offset + headerIndex] !== PDF_HEADER_BYTES[headerIndex]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return offset;
    }
  }

  return -1;
};

const sniffBytesAsText = (bytes) => {
  if (!bytes || bytes.length === 0) return '';

  try {
    const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
    const slice = bytes.length > 512 ? bytes.subarray(0, 512) : bytes;
    return decoder.decode(slice).trim();
  } catch (error) {
    console.warn('Failed to decode sniff bytes as text.', error);
    return '';
  }
};

const decodeUtf8 = (bytes) => {
  if (!bytes || bytes.length === 0) return '';

  try {
    const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
    return decoder.decode(bytes);
  } catch (error) {
    console.warn('Failed to decode bytes as UTF-8 text.', error);
    return '';
  }
};

const collectTextCandidates = (value, collector) => {
  if (!value) return;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) collector.add(trimmed);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectTextCandidates(item, collector));
    return;
  }

  if (typeof value === 'object') {
    collectTextCandidates(value.text, collector);
    collectTextCandidates(value.value, collector);
    collectTextCandidates(value.content, collector);
    collectTextCandidates(value.string, collector);
  }
};

const extractVectorStoreText = (decodedText) => {
  if (!decodedText) return '';

  try {
    const payload = JSON.parse(decodedText);
    const candidates = new Set();

    if (payload && typeof payload === 'object') {
      if (payload.object && /vector_store/i.test(payload.object)) {
        collectTextCandidates(payload.data, candidates);
      }

      collectTextCandidates(payload.text, candidates);
      collectTextCandidates(payload.content, candidates);
    }

    if (candidates.size > 0) {
      return Array.from(candidates).join('\n\n');
    }
  } catch (error) {
    // Not JSON – ignore and fall back to printable detection
  }

  return '';
};

const extractPrintableText = (decodedText) => {
  if (!decodedText) return '';

  const trimmed = decodedText.trim();
  if (!trimmed) {
    return '';
  }

  const printableCharacters = trimmed.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');
  const ratio = printableCharacters.length / trimmed.length;

  return ratio >= 0.6 ? trimmed : '';
};

const ensureValidPdfBytes = async (bytes) => {
  if (!bytes) return bytes;

  const normalizedBytes = await inflateGzipBytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

  if (!normalizedBytes || normalizedBytes.length === 0) {
    throw new Error('The PDF file is empty.');
  }

  const headerIndex = findPdfHeaderIndex(normalizedBytes);

  if (headerIndex === -1) {
    const decodedText = decodeUtf8(normalizedBytes);
    const vectorStoreText = extractVectorStoreText(decodedText);
    const printableText = vectorStoreText || extractPrintableText(decodedText);
    const sniff = sniffBytesAsText(normalizedBytes);

    if (printableText) {
      const maxInlineLength = 200000;
      const isTruncated = printableText.length > maxInlineLength;
      const truncatedText = isTruncated ? `${printableText.slice(0, maxInlineLength).trimEnd()}\n\n[Preview truncated]` : printableText;

      const error = new Error('Document bytes contain readable text but not a valid PDF.');
      error.name = 'TextDocumentFallbackError';
      error.textContent = truncatedText;
      error.isTruncated = isTruncated;
      error.sniff = sniff || truncatedText.slice(0, 512);
      error.source = vectorStoreText ? 'vector_store' : 'plain_text';
      throw error;
    }

    const error = new Error('PDF bytes invalid or corrupted.');
    error.name = 'InvalidPdfBytesError';
    if (sniff) {
      error.sniff = sniff;
    }
    throw error;
  }

  if (headerIndex > 0) {
    return normalizedBytes.subarray(headerIndex);
  }

  return normalizedBytes;
};

export const decodeBase64ToUint8Array = async (base64) => {
  if (!base64) return null;

  const normalizeBase64 = (value) => {
    if (!value) return '';
    let sanitized = value.trim();

    const dataUrlMatch = sanitized.match(/^data:([^;,]+);base64,(.*)$/i);
    if (dataUrlMatch) {
      sanitized = dataUrlMatch[2];
    }

    sanitized = sanitized.replace(/\s+/g, '');
    sanitized = sanitized.replace(/-/g, '+').replace(/_/g, '/');

    const padding = sanitized.length % 4;
    if (padding === 2) sanitized += '==';
    if (padding === 3) sanitized += '=';
    if (padding === 1) {
      console.error('Invalid base64 string length.');
      return null;
    }

    return sanitized;
  };

  const normalized = normalizeBase64(base64);
  if (!normalized) return null;

  const atobFn =
    (typeof window !== 'undefined' && typeof window.atob === 'function')
      ? window.atob
      : (typeof globalThis !== 'undefined' && typeof globalThis.atob === 'function')
        ? globalThis.atob
        : null;

  if (!atobFn) {
    console.error('Base64 decoding is not supported in this environment.');
    return null;
  }

  try {
    const byteCharacters = atobFn(normalized);
    const byteArray = new Uint8Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i += 1) {
      byteArray[i] = byteCharacters.charCodeAt(i);
    }

    if (isGzipCompressed(byteArray)) {
      return inflateGzipBytes(byteArray);
    }

    return byteArray;
  } catch (error) {
    console.error('Failed to decode base64 document content:', error);
    return null;
  }
};

const NETLIFY_BLOB_PROVIDER = 'netlify-blobs';

export const buildNetlifyBlobDownloadUrl = (storageLocation = {}) => {
  if (!storageLocation || typeof storageLocation !== 'object') {
    return '';
  }

  const directUrl = typeof storageLocation.url === 'string' ? storageLocation.url.trim() : '';
  if (directUrl) {
    return directUrl;
  }

  // Use the user function for blob access instead of admin function
  const userFunctionUrl = process.env.REACT_APP_USER_BLOB_FUNCTION || '/.netlify/functions/user-blob-access';
  
  const normalizePath = (input) => {
    if (typeof input !== 'string') {
      return '';
    }

    const trimmed = input.trim().replace(/^\/+/, '');
    if (!trimmed) {
      return '';
    }

    return trimmed
      .split('/')
      .filter(Boolean)
      .map((segment) => {
        const safeSegment = segment.trim();
        if (!safeSegment) {
          return '';
        }

        let decodedSegment = safeSegment;
        try {
          decodedSegment = decodeURIComponent(safeSegment);
        } catch (decodeError) {
          // If the segment is not a valid encoded URI component we fall back to the raw value.
          if (process.env.NODE_ENV !== 'production') {
            console.warn('Unable to decode Netlify Blob path segment:', decodeError);
          }
        }

        return encodeURIComponent(decodedSegment);
      })
      .filter(Boolean)
      .join('/');
  };

  // Extract the blob key from the storage location
  let blobKey = '';
  
  if (storageLocation.key) {
    blobKey = normalizePath(storageLocation.key);
  } else if (storageLocation.path) {
    blobKey = normalizePath(storageLocation.path);
  } else if (storageLocation.store && storageLocation.key) {
    blobKey = normalizePath(`${storageLocation.store}/${storageLocation.key}`);
  }

  if (blobKey) {
    return `${userFunctionUrl}?key=${encodeURIComponent(blobKey)}`;
  }

  return '';
};

const createInitialViewerState = () => ({
  isOpen: false,
  title: '',
  filename: '',
  contentType: '',
  allowDownload: false,
  url: '',
  blobData: null,
});

const ResourcesView = memo(({ currentResources = [], user, onSuggestionsUpdate, onAddResource, messages = [], onLoadChatHistory }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredResources, setFilteredResources] = useState(currentResources);
  const [learningSuggestions, setLearningSuggestions] = useState([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [openSections, setOpenSections] = useState({
    suggestions: false,
    resources: true,
    chatHistories: false
  });
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [addedResources, setAddedResources] = useState(new Set());
  const [showToast, setShowToast] = useState(false);
  const [downloadingResourceId, setDownloadingResourceId] = useState(null);
  const [chatHistories, setChatHistories] = useState([]);
  const [filteredHistories, setFilteredHistories] = useState([]);
  const toastTimeoutRef = useRef(null);

  const [viewerState, setViewerState] = useState(() => createInitialViewerState());
  const [isViewerLoading, setIsViewerLoading] = useState(false);
  const [viewerErrorInfo, setViewerErrorInfo] = useState(null);
  const activeObjectUrlRef = useRef(null);
  const viewerRequestRef = useRef(0);
  const userId = user?.sub || null;

  const getResourceKey = useCallback((resource, index = 0) => {
    if (!resource) return `resource-${index}`;
    return (
      resource.id ||
      resource?.metadata?.documentId ||
      resource?.metadata?.fileId ||
      resource.url ||
      resource.title ||
      `resource-${index}`
    );
  }, []);

  const createObjectUrlFromBlob = useCallback((blob) => {
    if (!blob) return null;

    const urlFactory = (() => {
      if (typeof window !== 'undefined' && window.URL && typeof window.URL.createObjectURL === 'function') {
        return window.URL;
      }
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        return URL;
      }
      return null;
    })();

    if (!urlFactory) {
      console.error('Object URL API is not available; unable to preview document.');
      return null;
    }
    activeObjectUrlRef.current = null;

    try {
      const objectUrl = urlFactory.createObjectURL(blob);
      const revoke = () => {
        try {
          urlFactory.revokeObjectURL(objectUrl);
        } catch (revokeError) {
          console.warn('Failed to revoke object URL:', revokeError);
        }
      };

      return { url: objectUrl, revoke };
    } catch (error) {
      console.error('Failed to create object URL for document blob:', error);
      return null;
    }
  }, []);

  const revokeActiveObjectUrl = useCallback(() => {
    if (activeObjectUrlRef.current?.revoke) {
      try {
        activeObjectUrlRef.current.revoke();
      } catch (error) {
        console.warn('Failed to revoke active object URL:', error);
      }
    }
    activeObjectUrlRef.current = null;
  }, []);

  const logDocumentUrl = useCallback((url, sourceLabel) => {
    if (!url) return;
    console.log(`Document viewer URL (${sourceLabel}):`, url);
  }, []);

  const loadNetlifyBlobDocument = useCallback(
    async ({
      storageLocation,
      requestId,
      fallbackTitle,
      fallbackFilename,
      fallbackContentType,
      responseFilename,
      responseContentType,
    }) => {
      console.log('loadNetlifyBlobDocument called with:', {
        storageLocation,
        requestId,
        fallbackTitle,
        fallbackFilename
      });
      const downloadUrl = buildNetlifyBlobDownloadUrl(storageLocation);
      if (!downloadUrl) {
        throw new Error('Netlify Blob storage location is missing a downloadable path.');
      }

      if (typeof fetch !== 'function') {
        throw new Error('This environment does not support fetching Netlify Blob documents.');
      }

      // Get authentication token and user ID (matching admin panel approach)
      const { getToken, getTokenInfo } = await import('../services/authService');
      const token = await getToken();
      const tokenInfo = getTokenInfo();
      const userId = tokenInfo?.sub || user?.sub;
      
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-user-id': userId,
      };
      
      const blobResponse = await fetch(downloadUrl, { 
        credentials: 'include',
        headers
      });
      if (!blobResponse.ok) {
        const error = new Error(`Failed to download Netlify Blob document (status ${blobResponse.status}).`);
        error.status = blobResponse.status;
        error.statusText = typeof blobResponse.statusText === 'string' ? blobResponse.statusText : '';
        error.code = blobResponse.status === 404 ? 'NETLIFY_BLOB_NOT_FOUND' : 'NETLIFY_BLOB_DOWNLOAD_FAILED';
        error.downloadUrl = downloadUrl;
        error.requestId = requestId;
        throw error;
      }

      // Handle JSON response from user function
      const responseData = await blobResponse.json();
      console.log('Blob response data:', responseData);
      if (!responseData || !responseData.data) {
        console.error('Invalid response from Netlify Blob service:', responseData);
        throw new Error('Invalid response from Netlify Blob service.');
      }

      // Convert base64 data to blob
      const binaryString = atob(responseData.data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const blob = new Blob([bytes], { type: responseData.contentType || 'application/octet-stream' });
      console.log('Created blob:', { size: blob.size, type: blob.type });
      console.log('Response data keys:', Object.keys(responseData));
      console.log('Response contentType:', responseData.contentType);
      const objectUrlResult = createObjectUrlFromBlob(blob);
      if (!objectUrlResult) {
        throw new Error('Unable to create object URL for Netlify Blob document.');
      }
      console.log('Created object URL:', objectUrlResult.url);

      const arrayBuffer = await blob.arrayBuffer();
      const byteArray = new Uint8Array(arrayBuffer);

      if (viewerRequestRef.current !== requestId) {
        objectUrlResult.revoke();
        return 'stale';
      }

      activeObjectUrlRef.current = objectUrlResult;

      let transportableBytes = null;
      try {
        const { buffer, byteOffset, byteLength } = byteArray;
        transportableBytes = buffer.slice(byteOffset, byteOffset + byteLength);
      } catch (sliceError) {
        console.warn('Unable to create ArrayBuffer copy for Netlify Blob viewer state:', sliceError);
      }

      const resolvedContentType =
        responseContentType ||
        storageLocation?.contentType ||
        (typeof blobResponse.headers?.get === 'function' ? blobResponse.headers.get('content-type') : null) ||
        blob.type ||
        fallbackContentType;

      logDocumentUrl(downloadUrl, 'netlify blob download URL');
      logDocumentUrl(objectUrlResult.url, 'netlify blob object URL');

      setViewerState({
        isOpen: true,
        title: fallbackTitle,
        url: objectUrlResult.url,
        filename: responseFilename || fallbackFilename,
        contentType: resolvedContentType,
        allowDownload: true,
        blobData: transportableBytes || byteArray,
      });
      setIsViewerLoading(false);
      return 'success';
    },
    [createObjectUrlFromBlob, logDocumentUrl, user]
  );

  const closeDocumentViewer = useCallback(() => {
    viewerRequestRef.current += 1;
    revokeActiveObjectUrl();
    setViewerState(createInitialViewerState());
    setViewerErrorInfo(null);
    setIsViewerLoading(false);
  }, [revokeActiveObjectUrl]);

  useEffect(() => () => {
    revokeActiveObjectUrl();
  }, [revokeActiveObjectUrl]);

  useEffect(() => {
    if (!viewerState.isOpen || typeof window === 'undefined') return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDocumentViewer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewerState.isOpen, closeDocumentViewer]);

  // Load learning suggestions on mount/user change
  useEffect(() => {
    if (FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS && user?.sub) {
      loadLearningSuggestions();
    }
  }, [user]);

  // Load chat histories on mount/user change
  useEffect(() => {
    if (user?.sub) {
      loadChatHistories();
    }
  }, [user]);

  // Filter resources
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredResources(currentResources);
      return;
    }
    const term = searchTerm.trim().toLowerCase();
    const filtered = currentResources.filter(resource => {
      if (!resource) return false;
      const fields = [
        resource.title,
        resource.type,
        resource.description,
        resource.origin,
        resource.location,
        resource.tag,
      ];
      return fields.some(v => typeof v === 'string' && v.toLowerCase().includes(term));
    });
    setFilteredResources(filtered);
  }, [currentResources, searchTerm]);

  // Filter chat histories
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredHistories(chatHistories);
      return;
    }
    const term = searchTerm.trim().toLowerCase();
    const filtered = chatHistories.filter(history => {
      if (!history) return false;
      const fields = [
        history.title,
        history.description,
        history.metadata?.capturedAt,
      ];
      return fields.some(v => typeof v === 'string' && v.toLowerCase().includes(term));
    });
    setFilteredHistories(filtered);
  }, [chatHistories, searchTerm]);

  const loadLearningSuggestions = async () => {
    if (!FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS || !user?.sub) return;

    setIsLoadingSuggestions(true);
    try {
      const suggestions = await learningSuggestionsService.getLearningSuggestions(user.sub);
      setLearningSuggestions(suggestions);
      onSuggestionsUpdate?.(suggestions);
    } catch (error) {
      console.error('Error loading learning suggestions:', error);
      setLearningSuggestions([]);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const loadChatHistories = () => {
    try {
      const histories = chatHistoryService.getAllHistories(user?.sub);
      const resourceFormattedHistories = histories.map(history => 
        chatHistoryService.historyToResource(history)
      );
      setChatHistories(resourceFormattedHistories);
    } catch (error) {
      console.error('Error loading chat histories:', error);
      setChatHistories([]);
    }
  };

  const handleCaptureCurrentChat = () => {
    if (!messages || messages.length === 0) {
      alert('No messages to capture in current chat');
      return;
    }

    try {
      const historyEntry = chatHistoryService.captureCurrentChat(messages, user);
      loadChatHistories(); // Refresh the list
      setShowToast(true);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = setTimeout(() => setShowToast(false), 3000);
    } catch (error) {
      console.error('Error capturing chat:', error);
      alert('Failed to capture chat: ' + error.message);
    }
  };

  const handleHistoryClick = (historyResource) => {
    const historyId = historyResource.metadata?.historyId;
    if (historyId && onLoadChatHistory) {
      // Load the chat history into the chat area
      onLoadChatHistory(historyId);
    } else {
      console.error('Cannot load chat history: missing historyId or onLoadChatHistory function');
    }
  };

  const handleDeleteHistory = (historyResource) => {
    const historyId = historyResource.metadata?.historyId;
    if (historyId && confirm('Are you sure you want to delete this chat history?')) {
      const success = chatHistoryService.deleteHistory(historyId);
      if (success) {
        loadChatHistories(); // Refresh the list
      } else {
        alert('Failed to delete chat history');
      }
    }
  };

  const handleSearchChange = (e) => setSearchTerm(e.target.value);
  const toggleSection = (section) => setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));

  const handleResourceClick = useCallback(async (resource, index = 0) => {
    console.log('handleResourceClick called with:', { resource, index });
    if (!resource) return;

    const requestId = viewerRequestRef.current + 1;
    viewerRequestRef.current = requestId;

    const metadata = resource.metadata || {};
    const fallbackTitle = metadata.documentTitle || resource.title || 'Document';
    const fallbackFilename = metadata.filename || metadata.documentTitle || resource.title || 'document';
    const contentType = metadata.contentType || '';

    const directUrl = typeof resource.url === 'string' ? resource.url.trim() : '';
    const metadataUrl = typeof metadata.downloadUrl === 'string' ? metadata.downloadUrl.trim() : '';
    const resolvedUrl = directUrl || metadataUrl;

    revokeActiveObjectUrl();
    setViewerErrorInfo(null);

    if (resolvedUrl) {
      setViewerState({
        isOpen: true,
        title: fallbackTitle,
        filename: fallbackFilename,
        contentType,
        allowDownload: true,
        url: resolvedUrl,
        blobData: null,
      });
      logDocumentUrl(resolvedUrl, 'resource metadata');
      setIsViewerLoading(false);
      return;
    }

    const documentId = typeof metadata.documentId === 'string' ? metadata.documentId.trim() : '';
    const fileId = typeof metadata.fileId === 'string' ? metadata.fileId.trim() : '';

    if (!documentId && !fileId) {
      console.warn('Resource does not include a downloadable reference.');
      setViewerState({
        isOpen: true,
        title: fallbackTitle,
        filename: fallbackFilename,
        contentType,
        allowDownload: false,
        url: '',
        blobData: null,
      });
      setViewerErrorInfo({
        message: 'This resource does not include a downloadable document.',
        hint: 'No document reference or storage path was provided with this resource.',
      });
      setIsViewerLoading(false);
      return;
    }

    const storageLocationFromMetadata =
      (metadata && typeof metadata.storage === 'object' && metadata.storage) ||
      (metadata && typeof metadata.storageLocation === 'object' && metadata.storageLocation) ||
      null;
    
    console.log('Document viewer debug:', {
      metadata,
      storageLocationFromMetadata,
      provider: storageLocationFromMetadata?.provider,
      isNetlifyBlob: storageLocationFromMetadata?.provider === NETLIFY_BLOB_PROVIDER
    });

    const resourceKey = getResourceKey(resource, index);
    setDownloadingResourceId(resourceKey);
    setIsViewerLoading(true);
    setViewerState({
      isOpen: true,
      title: fallbackTitle,
      url: '',
      filename: fallbackFilename,
      contentType,
      allowDownload: false,
      blobData: null,
    });

    const attemptedSources = [];
    let lastNetlifyError = null;
    const recordAttemptedSource = (label, path) => {
      if (!path) return;
      const trimmed = `${path}`.trim();
      if (!trimmed) return;
      attemptedSources.push({ label, path: trimmed });
    };

    try {
      if (storageLocationFromMetadata?.provider === NETLIFY_BLOB_PROVIDER) {
        const netlifyPathCandidate =
          buildNetlifyBlobDownloadUrl(storageLocationFromMetadata) ||
          storageLocationFromMetadata?.path ||
          storageLocationFromMetadata?.key ||
          '';
        recordAttemptedSource('Netlify Blob', netlifyPathCandidate);

        try {
          const netlifyResult = await loadNetlifyBlobDocument({
            storageLocation: storageLocationFromMetadata,
            requestId,
            fallbackTitle,
            fallbackFilename,
            fallbackContentType: contentType,
            responseFilename: metadata.filename,
            responseContentType: metadata.contentType,
          });

          if (netlifyResult === 'success' || netlifyResult === 'stale') {
            return;
          }
        } catch (netlifyError) {
          lastNetlifyError = netlifyError;
          console.warn('Failed to load Netlify Blob document from resource metadata:', netlifyError);
        }
      }

      if (documentId || fileId) {
        const referenceParts = [];
        if (documentId) referenceParts.push(`documentId=${documentId}`);
        if (fileId) referenceParts.push(`fileId=${fileId}`);
        recordAttemptedSource('Document reference', referenceParts.join(' '));
      }

      const response = await ragService.downloadDocument({ documentId, fileId }, userId);
      if (viewerRequestRef.current !== requestId) return;
      if (!response) throw new Error('No response received from download request');

      const responseUrl = [response.downloadUrl, response.url, response.blobUrl]
        .map(value => (typeof value === 'string' ? value.trim() : ''))
        .find(candidate => !!candidate) || '';

      if (responseUrl) {
        setViewerState({
          isOpen: true,
          title: fallbackTitle,
          url: responseUrl,
          filename: response.filename || fallbackFilename,
          contentType: response.contentType || contentType,
          allowDownload: true,
          blobData: null,
        });
        logDocumentUrl(responseUrl, 'backend download URL');
        setIsViewerLoading(false);
        return;
      }

      const storageLocation =
        (response && typeof response.storageLocation === 'object' && response.storageLocation) ||
        (response && typeof response.metadata === 'object' && response.metadata?.storage);

      if (storageLocation?.provider === NETLIFY_BLOB_PROVIDER) {
        const netlifyPathCandidate =
          buildNetlifyBlobDownloadUrl(storageLocation) ||
          storageLocation?.path ||
          storageLocation?.key ||
          '';
        recordAttemptedSource('Netlify Blob (backend response)', netlifyPathCandidate);

        try {
          const netlifyResult = await loadNetlifyBlobDocument({
            storageLocation,
            requestId,
            fallbackTitle,
            fallbackFilename,
            fallbackContentType: contentType,
            responseFilename: response.filename,
            responseContentType: response.contentType,
          });

          if (netlifyResult === 'success' || netlifyResult === 'stale') {
            return;
          }
        } catch (netlifyError) {
          lastNetlifyError = netlifyError;
          console.warn('Failed to load Netlify Blob document from backend response:', netlifyError);
        }
      }

      // Fallback: backend returned base64 content; build a blob URL
      const base64Content = typeof response.content === 'string' ? response.content.trim() : '';
      const encoding = typeof response.encoding === 'string' ? response.encoding.trim().toLowerCase() : 'base64';

      if (!base64Content) {
        if (
          lastNetlifyError &&
          (lastNetlifyError.code === 'NETLIFY_BLOB_NOT_FOUND' || lastNetlifyError.status === 404)
        ) {
          const storageError = new Error('This document could not be found in Netlify Blob storage.');
          storageError.code = 'DOCUMENT_STORAGE_NOT_FOUND';
          storageError.status = lastNetlifyError.status || 404;
          storageError.downloadUrl = lastNetlifyError.downloadUrl || '';
          storageError.cause = lastNetlifyError;
          throw storageError;
        }

        throw new Error('Document content payload is empty.');
      }

      if (encoding && encoding !== 'base64') {
        throw new Error(`Unsupported document encoding: ${encoding}`);
      }

      const byteArray = await decodeBase64ToUint8Array(base64Content);
      if (!byteArray) throw new Error('Unable to decode document content');

      const blob = new Blob([byteArray], { type: response.contentType || contentType || 'application/octet-stream' });
      const objectUrlResult = createObjectUrlFromBlob(blob);
      if (!objectUrlResult) throw new Error('Unable to create object URL for document');

      if (viewerRequestRef.current !== requestId) {
        objectUrlResult.revoke();
        return;
      }

      activeObjectUrlRef.current = objectUrlResult;

      let transportableBytes = null;
      try {
        const { buffer, byteOffset, byteLength } = byteArray;
        transportableBytes = buffer.slice(byteOffset, byteOffset + byteLength);
      } catch (sliceError) {
        console.warn('Unable to create ArrayBuffer copy for viewer state:', sliceError);
      }

      setViewerState({
        isOpen: true,
        title: fallbackTitle,
        url: objectUrlResult.url,
        filename: response.filename || fallbackFilename,
        contentType: response.contentType || contentType,
        allowDownload: true,
        blobData: transportableBytes || byteArray,
      });
      logDocumentUrl(objectUrlResult.url, 'generated object URL');
      setIsViewerLoading(false);
    } catch (error) {
      console.error('Failed to open resource document:', error);
      if (viewerRequestRef.current === requestId) {
        const primaryAttempt = attemptedSources.find((entry) => entry?.path);

        let message = 'We were unable to load this document in the viewer.';
        let hint = 'If a download option is available, please try that instead.';
        let targetPath = primaryAttempt?.path || '';
        let targetLabel = primaryAttempt?.label || '';

        if (error?.code === 'DOCUMENT_STORAGE_NOT_FOUND' || error?.status === 404) {
          message = 'This document could not be found in Netlify Blob storage.';
          hint = 'Netlify Blob reported a 404 Not Found response. Please contact an administrator to restore or remove this resource.';
          if (lastNetlifyError?.downloadUrl) {
            targetPath = lastNetlifyError.downloadUrl;
            targetLabel = 'Netlify Blob download';
          }
        }

        const debugMessages = [];
        const addDebugMessage = (value) => {
          if (!value) return;
          const normalized = typeof value === 'string' ? value.trim() : String(value).trim();
          if (!normalized) return;
          if (debugMessages.includes(normalized)) return;
          debugMessages.push(normalized);
        };

        if (error?.message && error.message !== message) {
          addDebugMessage(error.message);
        }
        if (error?.status) {
          addDebugMessage(`Status: ${error.status}`);
        }

        const causeMessage = error?.cause?.message;
        if (causeMessage) {
          addDebugMessage(`Cause: ${causeMessage}`);
        } else if (lastNetlifyError && lastNetlifyError !== error && lastNetlifyError?.message) {
          addDebugMessage(`Netlify Blob error: ${lastNetlifyError.message}`);
        }

        if (lastNetlifyError?.status && lastNetlifyError !== error) {
          addDebugMessage(`Netlify Blob status: ${lastNetlifyError.status}`);
        }
        if (lastNetlifyError?.statusText) {
          addDebugMessage(`Netlify Blob status text: ${lastNetlifyError.statusText}`);
        }

        let debugMessage = '';
        if (debugMessages.length > 0) {
          debugMessage = debugMessages.join('\n');
        } else {
          const fallbackCandidates = [];
          if (error?.message) fallbackCandidates.push(error.message.trim());
          const errorString = typeof error === 'string' ? error : String(error);
          if (errorString) fallbackCandidates.push(errorString.trim());

          const fallbackDebug = fallbackCandidates.find((candidate) => {
            if (!candidate) return false;
            if (candidate === message) return false;
            if (candidate === `Error: ${message}`) return false;
            return true;
          });

          debugMessage = fallbackDebug || 'No additional technical details are available.';
        }
        setViewerErrorInfo({
          message,
          hint,
          attemptedPaths: attemptedSources,
          debugMessage: debugMessage || error?.message || String(error),
          targetPath,
          targetLabel,
        });
        setIsViewerLoading(false);
      }
    } finally {
      setDownloadingResourceId((current) => (current === resourceKey ? null : current));
    }
  }, [
    createObjectUrlFromBlob,
    decodeBase64ToUint8Array,
    getResourceKey,
    loadNetlifyBlobDocument,
    logDocumentUrl,
    revokeActiveObjectUrl,
    userId,
  ]);

  const handleSuggestionClick = (suggestion) => {
    if (suggestion?.url) {
      window.open(suggestion.url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleAdd = (item) => {
    if (!item) return;
    onAddResource?.(item);
    const id = item.url || item.id || item.title;
    setAddedResources(prev => {
      const newSet = new Set(prev);
      newSet.add(id);
      return newSet;
    });
    setShowToast(true);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setShowToast(false), 2000);
  };

  useEffect(() => {
    return () => { if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current); };
  }, []);

  const getDifficultyColor = (difficulty) => {
    switch (difficulty?.toLowerCase()) {
      case 'beginner': return 'bg-green-100 text-green-800 border-green-200';
      case 'intermediate': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'advanced': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getTypeIcon = (type) => {
    switch (type?.toLowerCase()) {
      case 'training': return <BookOpen className="h-4 w-4" />;
      case 'guideline': return <Target className="h-4 w-4" />;
      case 'reference': return <Award className="h-4 w-4" />;
      default: return <BookOpen className="h-4 w-4" />;
    }
  };

  const resourceTypeColors = {
    'Regulation': 'bg-red-50 text-red-700 border-red-200',
    'Guideline': 'bg-blue-50 text-blue-700 border-blue-200',
    'Guidance': 'bg-green-50 text-green-700 border-green-200',
    'Training': 'bg-purple-50 text-purple-700 border-purple-200',
    'Portal': 'bg-orange-50 text-orange-700 border-orange-200',
    'Database': 'bg-gray-50 text-gray-700 border-gray-200',
    'Framework': 'bg-indigo-50 text-indigo-700 border-indigo-200',
    'Template': 'bg-pink-50 text-pink-700 border-pink-200',
    'Report': 'bg-yellow-50 text-yellow-700 border-yellow-200',
    'Reference': 'bg-teal-50 text-teal-700 border-teal-200',
    'Admin Resource': 'bg-amber-50 text-amber-700 border-amber-200',
    'Knowledge Base': 'bg-sky-50 text-sky-700 border-sky-200',
    'User Upload': 'bg-slate-100 text-slate-700 border-slate-300',
    default: 'bg-gray-100 text-gray-700 border-gray-200'
  };

  const displayedSuggestions = showAllSuggestions ? learningSuggestions : learningSuggestions.slice(0, 3);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 h-full shadow-sm flex flex-col">
      <div className="flex-1 overflow-y-auto space-y-4">
        {FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS && (
          <div className="border border-gray-200 rounded-lg">
            <button
              type="button"
              onClick={() => toggleSection('suggestions')}
              className="w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-left hover:bg-gray-50 rounded-t-lg"
            >
              <div className="flex items-center space-x-2">
                <Sparkles className="h-4 w-4" />
                <span>AI Suggestions</span>
                {learningSuggestions.length > 0 && (
                  <span className="bg-purple-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                    {learningSuggestions.length}
                  </span>
                )}
              </div>
              <ChevronRight className={`h-4 w-4 transform transition-transform ${openSections.suggestions ? 'rotate-90' : ''}`} />
            </button>
            {openSections.suggestions && (
              <div className="p-4 space-y-4 border-t border-gray-200">
                {isLoadingSuggestions ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-4"></div>
                    <p className="text-gray-600 text-sm">Analyzing your conversations...</p>
                  </div>
                ) : learningSuggestions.length > 0 ? (
                  <>
                    <div className="bg-gradient-to-r from-purple-50 to-blue-50 p-4 rounded-lg border border-purple-100 mb-4">
                      <div className="flex items-center space-x-2 mb-2">
                        <Brain className="h-4 w-4 text-purple-600" />
                        <span className="text-sm font-medium text-purple-800">
                          Suggestions Based on Your Recent Conversations
                        </span>
                      </div>
                    </div>

                    {displayedSuggestions.map((suggestion, index) => (
                      <SuggestionCard
                        key={suggestion.id}
                        suggestion={suggestion}
                        onClick={() => handleSuggestionClick(suggestion)}
                        getDifficultyColor={getDifficultyColor}
                        getTypeIcon={getTypeIcon}
                        index={index}
                        onAdd={() => handleAdd(suggestion)}
                        isAdded={addedResources.has(suggestion.id || suggestion.url || suggestion.title)}
                      />
                    ))}

                    {learningSuggestions.length > 3 && (
                      <button
                        onClick={() => setShowAllSuggestions(!showAllSuggestions)}
                        className="w-full py-2 px-4 text-sm text-purple-600 hover:text-purple-800 border border-purple-200 rounded-lg hover:bg-purple-50 transition-colors"
                      >
                        {showAllSuggestions
                          ? `Show Less (${learningSuggestions.length - 3} hidden)`
                          : `Show ${learningSuggestions.length - 3} More Suggestions`}
                      </button>
                    )}
                  </>
                ) : (
                  <div className="text-center py-12">
                    <div className="w-12 h-12 bg-purple-100 rounded-lg mx-auto mb-4 flex items-center justify-center">
                      <Brain className="h-6 w-6 text-purple-600" />
                    </div>
                    <h4 className="text-lg font-medium text-gray-900 mb-2">No Suggestions Yet</h4>
                    <p className="text-gray-600 text-sm mb-4">
                      Start conversations to get personalized learning recommendations
                    </p>
                    <button
                      onClick={loadLearningSuggestions}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 transition-colors"
                    >
                      Generate Suggestions
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Chat Histories Section */}
        <div className="border border-gray-200 rounded-lg">
          <button
            type="button"
            onClick={() => toggleSection('chatHistories')}
            className="w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-left hover:bg-gray-50 rounded-t-lg"
          >
            <div className="flex items-center space-x-2">
              <MessageSquare className="h-4 w-4" />
              <span>Chat Histories</span>
              {chatHistories.length > 0 && (
                <span className="bg-green-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                  {chatHistories.length}
                </span>
              )}
            </div>
            <ChevronRight className={`h-4 w-4 transform transition-transform ${openSections.chatHistories ? 'rotate-90' : ''}`} />
          </button>
          {openSections.chatHistories && (
            <div className="p-4 space-y-4 border-t border-gray-200">
              {/* Capture Current Chat Button */}
              {messages && messages.length > 0 && (
                <button
                  onClick={handleCaptureCurrentChat}
                  className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                >
                  <BookmarkPlus className="h-4 w-4" />
                  <span>Save Current Chat</span>
                </button>
              )}

              {chatHistories.length > 0 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search chat histories..."
                    value={searchTerm}
                    onChange={handleSearchChange}
                    className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
              )}

              {chatHistories.length > 0 ? (
                filteredHistories.length > 0 ? (
                  filteredHistories.map((historyResource, index) => {
                    const key = `history-${historyResource.id}-${index}`;
                    const addedKey = historyResource.id;
                    return (
                      <ChatHistoryCard
                        key={key}
                        historyResource={historyResource}
                        onClick={() => handleHistoryClick(historyResource)}
                        onAdd={() => handleAdd(historyResource)}
                        onDelete={() => handleDeleteHistory(historyResource)}
                        isAdded={addedResources.has(addedKey)}
                      />
                    );
                  })
                ) : (
                  <div className="text-center py-8">
                    <Search className="w-8 h-8 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-600 text-sm">
                      No chat histories match "{searchTerm}"
                    </p>
                    <button
                      onClick={() => setSearchTerm('')}
                      className="mt-2 text-sm text-green-600 hover:text-green-800"
                    >
                      Clear search
                    </button>
                  </div>
                )
              ) : (
                <div className="text-center py-12">
                  <div className="w-12 h-12 bg-gray-100 rounded-lg mx-auto mb-4 flex items-center justify-center">
                    <MessageSquare className="h-6 w-6 text-gray-400" />
                  </div>
                  <h4 className="text-lg font-medium text-gray-900 mb-2">No chat histories yet</h4>
                  <p className="text-gray-600 text-sm mb-4">
                    Start a conversation and save it to create your first chat history
                  </p>
                  {messages && messages.length > 0 && (
                    <button
                      onClick={handleCaptureCurrentChat}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors"
                    >
                      Save Current Chat
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border border-gray-200 rounded-lg">
          <button
            type="button"
            onClick={() => toggleSection('resources')}
            className="w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-left hover:bg-gray-50 rounded-t-lg"
          >
            <div className="flex items-center space-x-2">
              <BookOpen className="h-4 w-4" />
              <span>Resources</span>
              {currentResources.length > 0 && (
                <span className="bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                  {currentResources.length}
                </span>
              )}
            </div>
            <ChevronRight className={`h-4 w-4 transform transition-transform ${openSections.resources ? 'rotate-90' : ''}`} />
          </button>
          {openSections.resources && (
            <div className="p-4 space-y-4 border-t border-gray-200">
              {currentResources.length > 0 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search resources..."
                    value={searchTerm}
                    onChange={handleSearchChange}
                    className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              )}

              {currentResources.length > 0 ? (
                filteredResources.length > 0 ? (
                  filteredResources.map((resource, index) => {
                    const key = getResourceKey(resource, index);
                    const addedKey = resource?.url || resource?.id || resource?.title;
                    return (
                      <ResourceCard
                        key={`${key}-${index}`}
                        resource={resource}
                        onClick={() => handleResourceClick(resource, index)}
                        colorClass={resourceTypeColors[resource.type] || resourceTypeColors.default}
                        onAdd={() => handleAdd(resource)}
                        isAdded={addedResources.has(addedKey)}
                        isDownloading={downloadingResourceId === key}
                      />
                    );
                  })
                ) : (
                  <div className="text-center py-8">
                    <Search className="w-8 h-8 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-600 text-sm">
                      No resources match "{searchTerm}"
                    </p>
                    <button
                      onClick={() => setSearchTerm('')}
                      className="mt-2 text-sm text-blue-600 hover:text-blue-800"
                    >
                      Clear search
                    </button>
                  </div>
                )
              ) : (
                <div className="text-center py-12">
                  <div className="w-12 h-12 bg-gray-100 rounded-lg mx-auto mb-4 flex items-center justify-center">
                    <BookOpen className="h-6 w-6 text-gray-400" />
                  </div>
                  <h4 className="text-lg font-medium text-gray-900 mb-2">No resources yet</h4>
                  <p className="text-gray-600">
                    Ask a question to see relevant learning resources
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

      </div>

      {showToast && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white text-sm px-3 py-2 rounded shadow-lg z-50">
          Added to Notebook
        </div>
      )}

      <DocumentViewer
        isOpen={viewerState.isOpen}
        title={viewerState.title}
        url={viewerState.url}
        blobData={viewerState.blobData}
        contentType={viewerState.contentType}
        filename={viewerState.filename}
        isLoading={isViewerLoading}
        error={viewerErrorInfo}
        allowDownload={viewerState.allowDownload}
        onClose={closeDocumentViewer}
      />
    </div>
  );
});

const isBlobLikeUrl = (candidate) => typeof candidate === 'string' && (candidate.startsWith('blob:') || candidate.startsWith('data:'));

export const PdfBlobViewer = memo(({ url, title, blobData }) => {
  const containerRef = useRef(null);
  const [{ isRendering, error, fallback }, setRenderState] = useState({
    isRendering: true,
    error: null,
    fallback: null,
  });

  useEffect(() => {
    let isCancelled = false;
    let cleanupTasks = [];
    const container = containerRef.current;

    if (!container || (!url && !blobData)) {
      setRenderState((prev) => ({
        ...prev,
        isRendering: false,
        error: 'PDF preview is unavailable.',
        fallback: null,
      }));
      return () => {};
    }

    container.innerHTML = '';
    setRenderState({ isRendering: true, error: null, fallback: null });

    const renderDocument = async () => {
      try {
        const [pdfCore, workerModule] = await Promise.all([
          import('pdfjs-dist/build/pdf'),
          import('pdfjs-dist/build/pdf.worker.entry'),
        ]);

        const { GlobalWorkerOptions, getDocument } = pdfCore;
        const workerSrc = workerModule?.default || workerModule;

        if (GlobalWorkerOptions && workerSrc) {
          GlobalWorkerOptions.workerSrc = workerSrc;
        }

        const ensurePdfBytes = async () => {
          if (blobData) {
            if (ArrayBuffer.isView(blobData)) {
              const view = blobData;
              const { buffer, byteOffset = 0, byteLength = view.byteLength } = view;
              return ensureValidPdfBytes(
                new Uint8Array(buffer.slice(byteOffset, byteOffset + byteLength))
              );
            }

            if (blobData instanceof ArrayBuffer) {
              return ensureValidPdfBytes(new Uint8Array(blobData.slice(0)));
            }

            const BlobConstructor = typeof Blob !== 'undefined' ? Blob : null;
            if (BlobConstructor && blobData instanceof BlobConstructor) {
              const arrayBuffer = await blobData.arrayBuffer();
              return ensureValidPdfBytes(new Uint8Array(arrayBuffer));
            }
          }

          if (!url) {
            throw new Error('No PDF URL available for preview.');
          }

          const normalizedUrl = `${url}`;
          const isObjectOrDataUrl = isBlobLikeUrl(normalizedUrl);
          if (isObjectOrDataUrl) {
            throw new Error('Failed to fetch PDF bytes due to browser security settings.');
          }
          const isHttpUrl = /^https?:/i.test(normalizedUrl);

          if (!isHttpUrl) {
            throw new Error('Unable to resolve PDF bytes for non-HTTP URL without embedded data.');
          }

          if (typeof fetch !== 'function') {
            throw new Error('This browser does not support fetching PDF blobs for preview.');
          }

          const response = await fetch(normalizedUrl, {
            credentials: 'include',
            headers: {
              Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
            },
          });
          if (!response.ok) {
            throw new Error(`Unexpected response (${response.status}) while retrieving PDF.`);
          }
          const arrayBuffer = await response.arrayBuffer();
          const pdfBytes = new Uint8Array(arrayBuffer);
          return ensureValidPdfBytes(pdfBytes);
        };

        const pdfBytes = await ensurePdfBytes();

        const loadingTask = getDocument({ data: pdfBytes });
        if (!loadingTask || typeof loadingTask.promise?.then !== 'function') {
          throw new Error('PDF.js did not return a loading task.');
        }
        cleanupTasks.push(() => {
          try {
            loadingTask.destroy?.();
          } catch (destroyError) {
            console.warn('Failed to destroy PDF loading task:', destroyError);
          }
        });

        const pdfDocument = await loadingTask.promise;

        if (isCancelled) {
          pdfDocument.destroy?.();
          return;
        }

        const renderPage = async (pageNumber) => {
          const page = await pdfDocument.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const containerWidth = container.clientWidth || baseViewport.width;
          const computedScale = containerWidth / baseViewport.width || 1;
          const scale = Math.min(Math.max(computedScale, 0.5), 2.5);
          const viewport = page.getViewport({ scale });

          const pageWrapper = document.createElement('div');
          pageWrapper.className = 'mb-6 flex justify-center';

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          canvas.className = 'shadow-sm border border-gray-200 rounded';
          pageWrapper.appendChild(canvas);
          container.appendChild(pageWrapper);

          const canvasContext = canvas.getContext('2d');
          await page.render({ canvasContext, viewport }).promise;
          page.cleanup();
        };

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          if (isCancelled) break;
          // eslint-disable-next-line no-await-in-loop
          await renderPage(pageNumber);
        }

        if (!isCancelled) {
          setRenderState({ isRendering: false, error: null, fallback: null });
        }

        cleanupTasks.push(() => {
          try {
            pdfDocument.cleanup?.();
            pdfDocument.destroy?.();
          } catch (cleanupError) {
            console.warn('Failed to clean up PDF document:', cleanupError);
          }
        });
      } catch (renderError) {
        console.error('Failed to render PDF blob preview:', renderError);
        if (
          !isCancelled &&
          renderError?.name === 'TextDocumentFallbackError' &&
          renderError.textContent
        ) {
          setRenderState({
            isRendering: false,
            error: null,
            fallback: {
              type: 'text',
              content: renderError.textContent,
              truncated: Boolean(renderError.isTruncated),
              source: renderError.source || 'plain_text',
            },
          });
          return;
        }

        if (renderError?.name === 'InvalidPdfBytesError' && renderError.sniff) {
          console.error('Non-PDF payload preview snippet:', renderError.sniff);
        }
        if (!isCancelled) {
          const message =
            renderError?.name === 'UnexpectedResponseException' ||
            /Unexpected response/i.test(renderError?.message || '') ||
            /Failed to fetch/i.test(renderError?.message || '')
              ? 'Browser security settings prevented the PDF preview. Please download the file to view it.'
              : 'Unable to display this PDF document in the preview.';
          setRenderState({
            isRendering: false,
            error: message,
            fallback: null,
          });
        }
      }
    };

    renderDocument();

    return () => {
      isCancelled = true;
      cleanupTasks.forEach((task) => {
        try {
          task();
        } catch (cleanupError) {
          console.warn('Failed to execute PDF cleanup task:', cleanupError);
        }
      });
      cleanupTasks = [];
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [url, blobData]);

  if (fallback?.type === 'text') {
    return (
      <div className="relative h-full w-full bg-white" data-testid="pdf-blob-viewer-text-fallback">
        <div className="h-full w-full overflow-y-auto px-6 py-6">
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <p className="font-medium">This document was returned as extracted text.</p>
            <p className="mt-1 text-amber-800/90">
              We’re showing the readable text content because a valid PDF file was not available.
            </p>
            {fallback.truncated ? (
              <p className="mt-1 text-amber-800/90">
                The preview has been truncated for performance. Use the download option to retrieve the full document.
              </p>
            ) : null}
          </div>
          <pre className="whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-gray-50 px-4 py-4 text-sm leading-relaxed text-gray-800">
            {fallback.content}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-white" data-testid="pdf-blob-viewer">
      <div
        ref={containerRef}
        className="h-full w-full overflow-y-auto px-6 py-6"
        role="document"
        aria-label={`${title || 'PDF document'} preview`}
      />
      {isRendering && !error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center space-y-3 bg-white/80">
          <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
          <p className="text-sm text-gray-600">Rendering PDF...</p>
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white px-6 text-center">
          <p className="text-sm text-gray-600">{error}</p>
        </div>
      ) : null}
    </div>
  );
});

export const DocumentViewer = ({
  isOpen,
  title,
  url,
  blobData,
  contentType,
  isLoading,
  onClose,
  filename,
  error: errorInfo,
  allowDownload,
}) => {
  if (!isOpen) return null;

  const safeTitle = title || 'Document';

  const resolvedError = errorInfo
    ? typeof errorInfo === 'string'
      ? { message: errorInfo }
      : errorInfo
    : null;
  const attemptedPaths = Array.isArray(resolvedError?.attemptedPaths)
    ? resolvedError.attemptedPaths
        .filter((entry) => entry && typeof entry.path === 'string' && `${entry.path}`.trim())
        .map((entry) => ({
          label: entry.label || '',
          path: `${entry.path}`.trim(),
        }))
    : [];
  const errorMessage = resolvedError?.message || 'Document preview is not available.';
  const errorHint = resolvedError?.hint || '';
  const errorDebugMessage = resolvedError?.debugMessage || '';
  const hasError = Boolean(resolvedError);
  const targetPath = typeof resolvedError?.targetPath === 'string' ? resolvedError.targetPath.trim() : '';
  const targetLabel = typeof resolvedError?.targetLabel === 'string' ? resolvedError.targetLabel.trim() : '';
  const primaryAttempt = !targetPath && attemptedPaths.length > 0 ? attemptedPaths[0] : null;
  const resolvedTargetPath = targetPath || primaryAttempt?.path || '';
  const resolvedTargetLabel = targetLabel || primaryAttempt?.label || '';


  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6 py-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-viewer-title"
    >
      <div
        className="absolute inset-0 bg-gray-900/70"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-7xl h-[90vh] bg-white rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-200">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <FileText className="h-5 w-5 text-blue-600" />
              <span
                id="document-viewer-title"
                className="truncate"
                title={safeTitle}
              >
                {safeTitle}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {contentType || 'Document'}
              {filename && filename !== safeTitle && ` • ${filename}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {allowDownload && url && !isLoading && (
              <>
                <button
                  type="button"
                  onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
                >
                  <Eye className="h-4 w-4" />
                  <span>Open in new tab</span>
                </button>
                <a
                  href={url}
                  download={filename || true}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-green-600 border border-green-200 rounded hover:bg-green-50"
                >
                  <Download className="h-4 w-4" />
                  <span>Download</span>
                </a>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded hover:bg-gray-50"
            >
              <X className="h-4 w-4" />
              <span>Close</span>
            </button>
          </div>
        </div>

        <div className="flex-1 bg-gray-100">
          {isLoading ? (
            <div className="flex h-full flex-col items-center justify-center space-y-3 text-gray-500">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm font-medium">Loading document...</p>
            </div>
          ) : hasError ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center text-gray-600">
              <div className="w-full max-w-lg space-y-4">
                <div className="flex flex-col items-center space-y-3">
                  <AlertCircle className="h-10 w-10 text-amber-500" />
                  <h3 className="text-base font-semibold text-gray-900">{errorMessage}</h3>
                  {errorHint ? <p className="text-sm text-gray-600">{errorHint}</p> : null}
                </div>
                {allowDownload && url ? (
                  <div className="flex justify-center">
                    <a
                      href={url}
                      download={filename || true}
                      className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-green-600 border border-green-200 rounded hover:bg-green-50"
                    >
                      <Download className="h-4 w-4" />
                      <span>Download document</span>
                    </a>
                  </div>
                ) : null}
              </div>
            </div>
          ) : url ? (
            <iframe
              title={`Preview of ${safeTitle}`}
              src={url}
              className="w-full h-full min-h-[420px] bg-white"
              onLoad={() => console.log('Document iframe loaded successfully')}
              onError={(e) => console.error('Document iframe load error:', e)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center space-y-3 text-gray-500">
              <FileText className="h-10 w-10 text-gray-300" />
              <p className="text-sm">Document preview is not available.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Individual suggestion card component
const SuggestionCard = memo(({ suggestion, onClick, getDifficultyColor, getTypeIcon, index, onAdd, isAdded }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className={`group border rounded-lg transition-all duration-300 cursor-pointer ${isAdded ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:border-purple-300 hover:shadow-md bg-white'}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1">
              {getTypeIcon(suggestion.type)}
              <span className={`text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded-full border ${
                suggestion.type === 'Training' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                suggestion.type === 'Guideline' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                'bg-gray-50 text-gray-700 border-gray-200'
              }`}>
                {suggestion.type}
              </span>
            </div>
            {suggestion.isPersonalized && (
              <span className="inline-flex items-center space-x-1 text-xs bg-gradient-to-r from-purple-100 to-blue-100 text-purple-700 px-2 py-1 rounded-full">
                <Sparkles className="h-3 w-3" />
                <span>AI</span>
              </span>
            )}
          </div>

          <div className="flex items-center space-x-1">
            <button
              onClick={(e) => { e.stopPropagation(); if (!isAdded) onAdd?.(); }}
              className={`p-1 ${isAdded ? 'text-green-600' : 'text-gray-400 hover:text-purple-600'}`}
              aria-label="Add to notebook"
              title="Add this resource to your notebook"
              disabled={isAdded}
            >
              {isAdded ? <Check className="h-4 w-4" /> : <BookmarkPlus className="h-4 w-4" />}
            </button>
            <ChevronRight
              className={`h-4 w-4 text-gray-400 group-hover:text-purple-600 transition-all flex-shrink-0 ${isHovered ? 'translate-x-1' : ''}`}
            />
          </div>
        </div>

        <h4 className="font-semibold text-gray-900 group-hover:text-purple-800 mb-2 leading-snug">
          {suggestion.title}
        </h4>

        <p className="text-sm text-gray-600 mb-3 line-clamp-2">
          {suggestion.description}
        </p>

        {suggestion.objective && (
          <div className="mb-3">
            <span className="text-xs font-medium text-gray-500">Learning Objective:</span>
            <p className="text-xs text-gray-600 mt-1">{suggestion.objective}</p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {suggestion.difficulty && (
              <span className={`text-xs font-medium px-2 py-1 rounded-full border ${getDifficultyColor(suggestion.difficulty)}`}>
                {suggestion.difficulty}
              </span>
            )}
            {suggestion.relevanceScore && (
              <div className="flex items-center space-x-1">
                <span className="text-xs text-gray-500">Relevance:</span>
                <div className="flex space-x-0.5">
                  {[...Array(5)].map((_, i) => (
                    <div
                      key={i}
                      className={`w-2 h-2 rounded-full ${i < Math.round(suggestion.relevanceScore / 2) ? 'bg-purple-400' : 'bg-gray-200'}`}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {suggestion.isPersonalized && (
            <span className="text-xs text-purple-600 font-medium">Personalized</span>
          )}
        </div>

        {suggestion.url && (
          <div className="mt-4 flex items-center justify-between text-xs text-purple-700">
            <a
              href={suggestion.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center space-x-1 font-medium hover:text-purple-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 rounded"
            >
              <span>Open recommended resource</span>
              <ExternalLink className="h-3 w-3" />
            </a>
            {suggestion.linkedResourceTitle && (
              <span className="ml-2 text-[11px] text-gray-500 truncate max-w-[150px]" title={suggestion.linkedResourceTitle}>
                {suggestion.linkedResourceTitle}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// Individual resource card component
const ResourceCard = memo(({ resource, onClick, colorClass, onAdd, isAdded, isDownloading = false }) => {
  const [isHovered, setIsHovered] = useState(false);
  const badgeClass = colorClass || 'bg-gray-100 text-gray-800 border-gray-200';
  const metadata = resource?.metadata || {};
  const directUrl = typeof resource?.url === 'string' ? resource.url.trim() : '';
  const metadataUrl = typeof metadata.downloadUrl === 'string' ? metadata.downloadUrl.trim() : '';
  const hasDownloadReference = Boolean(
    metadataUrl ||
    (typeof metadata.documentId === 'string' && metadata.documentId.trim()) ||
    (typeof metadata.fileId === 'string' && metadata.fileId.trim())
  );
  const hasUrl = Boolean(directUrl) || hasDownloadReference;
  const isDownloadingActive = Boolean(isDownloading);

  let hostname = '';
  if (directUrl) {
    try { hostname = new URL(directUrl).hostname; } catch { hostname = directUrl; }
  } else if (hasDownloadReference) {
    hostname = metadata.filename || metadata.documentTitle || resource?.title || 'Open document';
  }

  return (
    <div
      className={`group border rounded-lg transition-all duration-300 ${
        isAdded ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:border-gray-400 hover:shadow-sm'
      } ${isDownloadingActive ? 'cursor-wait opacity-80' : 'cursor-pointer'}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={(event) => {
        if (isDownloadingActive) {
          event.preventDefault();
          return;
        }
        onClick?.();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (isDownloadingActive) { e.preventDefault(); return; }
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
      }}
      aria-disabled={isDownloadingActive}
    >
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2 mb-3">
              <span className={`text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded-full border ${badgeClass}`}>
                {resource.type || 'Resource'}
              </span>
            </div>

            <h4 className="font-semibold text-gray-900 group-hover:text-black mb-2 leading-snug">
              {resource.title}
            </h4>

            {resource.description && (
              <p className="text-sm text-gray-600 mb-3 line-clamp-3">{resource.description}</p>
            )}

            <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
              <div className="flex items-center space-x-2">
                {hasUrl ? (
                  <>
                    {isDownloadingActive ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                    <span className="truncate">{hostname || (hasDownloadReference ? 'Open document' : '')}</span>
                  </>
                ) : (
                  <>
                    <FileText className="h-3 w-3" />
                    <span className="truncate">{resource.location || resource.origin || 'Stored in workspace'}</span>
                  </>
                )}
              </div>
              {resource.tag && (
                <span className="ml-2 text-[11px] text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                  #{resource.tag}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-1">
            <button
              onClick={(e) => { e.stopPropagation(); if (!isAdded) onAdd?.(); }}
              className={`p-1 ${isAdded ? 'text-green-600' : 'text-gray-400 hover:text-blue-600'}`}
              aria-label="Add to notebook"
              title="Add this resource to your notebook"
              disabled={isAdded}
            >
              {isAdded ? <Check className="h-4 w-4" /> : <BookmarkPlus className="h-4 w-4" />}
            </button>
            <ChevronRight className={`h-4 w-4 text-gray-400 group-hover:text-black transition-all flex-shrink-0 ${isHovered ? 'translate-x-1' : ''}`} />
          </div>
        </div>

        {/* Progress indicator for known long resources */}
        {resource.type === 'Guideline' && (
          <div className="mt-3 pt-2 border-t border-gray-100">
            <div className="flex items-center text-xs text-gray-500">
              <BookOpen className="h-3 w-3 mr-1" />
              <span>Comprehensive guidance document</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

// Chat History Card component
const ChatHistoryCard = memo(({ historyResource, onClick, onAdd, onDelete, isAdded = false }) => {
  const [isHovered, setIsHovered] = useState(false);
  const metadata = historyResource?.metadata || {};
  const capturedAt = metadata.capturedAt ? new Date(metadata.capturedAt) : null;
  const messageCount = metadata.messageCount || 0;
  const conversationCount = metadata.conversationCount || 0;

  return (
    <div
      className={`group border rounded-lg transition-all duration-300 ${
        isAdded ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:border-green-300 hover:shadow-sm'
      } cursor-pointer`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2 mb-3">
              <span className="text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded-full border bg-green-50 text-green-700 border-green-200">
                Chat History
              </span>
              {capturedAt && (
                <div className="flex items-center space-x-1 text-xs text-gray-500">
                  <Clock className="h-3 w-3" />
                  <span>{capturedAt.toLocaleDateString()}</span>
                </div>
              )}
            </div>

            <h4 className="font-semibold text-gray-900 group-hover:text-green-800 mb-2 leading-snug">
              {historyResource.title}
            </h4>

            {historyResource.description && (
              <p className="text-sm text-gray-600 mb-3 line-clamp-3">{historyResource.description}</p>
            )}

            <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-1">
                  <MessageSquare className="h-3 w-3" />
                  <span>{conversationCount} conversation{conversationCount !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <FileText className="h-3 w-3" />
                  <span>{messageCount} message{messageCount !== 1 ? 's' : ''}</span>
                </div>
              </div>
              {capturedAt && (
                <span className="text-[11px] text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                  {capturedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-1">
            <button
              onClick={(e) => { e.stopPropagation(); if (!isAdded) onAdd?.(); }}
              className={`p-1 ${isAdded ? 'text-green-600' : 'text-gray-400 hover:text-green-600'}`}
              aria-label="Add to notebook"
              title="Add this chat history to your notebook"
              disabled={isAdded}
            >
              {isAdded ? <Check className="h-4 w-4" /> : <BookmarkPlus className="h-4 w-4" />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
              className="p-1 text-gray-400 hover:text-red-600"
              aria-label="Delete chat history"
              title="Delete this chat history"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <ChevronRight className={`h-4 w-4 text-gray-400 group-hover:text-green-600 transition-all flex-shrink-0 ${isHovered ? 'translate-x-1' : ''}`} />
          </div>
        </div>
      </div>
    </div>
  );
});

SuggestionCard.displayName = 'SuggestionCard';
ResourceCard.displayName = 'ResourceCard';
ChatHistoryCard.displayName = 'ChatHistoryCard';
ResourcesView.displayName = 'ResourcesView';
PdfBlobViewer.displayName = 'PdfBlobViewer';
DocumentViewer.displayName = 'DocumentViewer';

export default ResourcesView;
