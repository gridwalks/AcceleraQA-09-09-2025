// src/components/RAGConfigurationPage.js - Document management screen for the knowledge base
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Upload,
  FileText,
  Trash2,
  AlertCircle,
  CheckCircle,
  Download,
  Database,
  Loader,
  X,
  User,
  Key,
  BookOpen,
  RefreshCw,
  ExternalLink,
  Pencil,
  Save,
  PlusCircle,
  AlertTriangle,
  Copy
} from 'lucide-react';
import ragService from '../services/ragService';
import { getToken } from '../services/authService';
import { hasAdminRole } from '../utils/auth';
import trainingResourceService from '../services/trainingResourceService';
import SummaryRequestPanel from './SummaryRequestPanel';

const describeConversionSource = (conversion) => {
  if (!conversion) {
    return null;
  }

  const conversionLabels = {
    'docx-to-pdf': 'DOCX',
    'markdown-to-pdf': 'Markdown',
    'text-to-pdf': 'text',
    'csv-to-pdf': 'CSV',
    'xlsx-to-pdf': 'Excel',
  };

  return conversionLabels[conversion] || null;
};

const getDocumentTitle = (doc) => {
  const rawTitle = doc?.metadata?.title;

  if (typeof rawTitle === 'string') {
    const trimmedTitle = rawTitle.trim();

    if (trimmedTitle) {
      return trimmedTitle;
    }
  }

  return doc?.filename || '';
};

const USER_DOCUMENT_LIMIT = 20;

const INITIAL_UPLOAD_METADATA = {
  fileName: '',
  title: '',
  description: '',
  tags: '',
  category: 'general',
  version: ''
};

const INITIAL_EDIT_METADATA = {
  title: '',
  description: '',
  tags: '',
  category: 'general',
  version: ''
};

const TRAINING_RESOURCE_FORM_INITIAL_STATE = {
  name: '',
  description: '',
  url: '',
  tag: '',
};

const normalizeFormValue = (value) => (typeof value === 'string' ? value.trim() : '');

const buildTrainingResourcePayload = (form, { includeEmpty = false } = {}) => {
  if (!form || typeof form !== 'object') {
    return {};
  }

  const payload = {};
  const name = normalizeFormValue(form.name || form.title);
  const url = normalizeFormValue(form.url);
  const description = normalizeFormValue(form.description);
  const tag = normalizeFormValue(form.tag);

  if (name) {
    payload.name = name;
  }

  if (url || includeEmpty) {
    payload.url = url;
  }

  if (description || includeEmpty) {
    payload.description = description;
  }

  if (tag || includeEmpty) {
    payload.tag = tag;
  }

  if (payload.name && !payload.title) {
    payload.title = payload.name;
  }

  return payload;
};

const resolveExternalResourceId = (resource) => {
  if (!resource || typeof resource !== 'object') {
    return null;
  }

  return (
    resource.id ||
    resource.resourceId ||
    resource.externalId ||
    resource.trainingResourceId ||
    resource.url ||
    null
  );
};

const formatStorageTimestamp = (value) => {
  if (!value) {
    return null;
  }

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  } catch (error) {
    console.warn('Failed to format Storage error timestamp:', error);
    return value;
  }
};

const buildStorageClipboardText = (details) => {
  if (!details || typeof details !== 'object') {
    return 'Storage upload error details unavailable.';
  }

  const lines = [
    `Message: ${details.message || 'Netlify Blob upload failed.'}`,
  ];

  if (details.statusCode) {
    lines.push(`Status Code: ${details.statusCode}`);
  }
  if (details.code) {
    lines.push(`Error Code: ${details.code}`);
  }
  if (details.store) {
    lines.push(`Store: ${details.store}`);
  }
  if (details.prefix) {
    lines.push(`Prefix: ${details.prefix}`);
  }
  if (details.requestId) {
    lines.push(`Request ID: ${details.requestId}`);
  }
  if (details.hostId) {
    lines.push(`Host ID: ${details.hostId}`);
  }
  if (details.storageMessage) {
    lines.push(`Storage Message: ${details.storageMessage}`);
  }
  if (details.suggestion) {
    lines.push(`Suggestion: ${details.suggestion}`);
  }
  if (details.timestamp) {
    lines.push(`Captured: ${formatStorageTimestamp(details.timestamp)}`);
  }
  if (details.responseBody) {
    lines.push('Response Body:');
    lines.push(details.responseBody);
  }

  return lines.join('\n');
};

const extractStorageErrorDetails = (error) => {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const message = typeof error.message === 'string' ? error.message : 'Netlify Blob upload failed.';
  const details = error.details && typeof error.details === 'object' ? error.details : null;

  if (!details) {
    if (!/Netlify Blob|storage/i.test(message)) {
      return null;
    }

    return {
      message,
      statusCode: error.statusCode || null,
    };
  }

  if (details.provider && details.provider !== 'netlify-blobs') {
    return null;
  }

  return {
    message,
    statusCode: details.statusCode ?? error.statusCode ?? null,
    code: details.code ?? null,
    store: details.store ?? null,
    prefix: details.prefix ?? null,
    suggestion: details.suggestion ?? null,
    responseBody: details.responseBody ?? null,
    storageMessage: details.storageMessage ?? details.s3Message ?? null,
    requestId: details.requestId ?? null,
    hostId: details.hostId ?? null,
    timestamp: details.timestamp ?? null,
    rawMessage: details.rawMessage ?? null,
  };
};

const StorageErrorModal = ({ isOpen, onClose, details }) => {
  const [copyFeedback, setCopyFeedback] = useState(null);

  useEffect(() => {
    if (!copyFeedback) {
      return undefined;
    }

    const timeoutId = setTimeout(() => setCopyFeedback(null), 2000);
    return () => clearTimeout(timeoutId);
  }, [copyFeedback]);

  if (!isOpen || !details) {
    return null;
  }

  const formattedTimestamp = formatStorageTimestamp(details.timestamp);
  const detailItems = [
    { label: 'Status Code', value: details.statusCode },
    { label: 'Error Code', value: details.code },
    { label: 'Storage Message', value: details.storageMessage },
    { label: 'Store', value: details.store },
    { label: 'Prefix', value: details.prefix },
    { label: 'Request ID', value: details.requestId },
    { label: 'Host ID', value: details.hostId },
  ].filter(item => item.value);

  const handleCopy = async () => {
    try {
      if (!navigator?.clipboard?.writeText) {
        setCopyFeedback('Clipboard unavailable');
        return;
      }

      await navigator.clipboard.writeText(buildStorageClipboardText(details));
      setCopyFeedback('Copied!');
    } catch (copyError) {
      console.error('Failed to copy Storage error details:', copyError);
      setCopyFeedback('Copy failed');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-5">
          <div className="flex items-center space-x-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Storage Upload Error</h3>
              <p className="text-sm text-gray-500">The document could not be stored in the Netlify Blob store.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close Storage error details"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-700">
            <p className="font-medium text-red-800">{details.message}</p>
            {details.rawMessage && details.rawMessage !== details.message && (
              <p className="mt-2 text-xs text-red-600">{details.rawMessage}</p>
            )}
          </div>

          {details.suggestion && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              {details.suggestion}
            </div>
          )}

          {detailItems.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {detailItems.map(item => (
                <div key={item.label} className="rounded-lg border border-gray-200 p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-500">{item.label}</p>
                  <p className="mt-1 break-words text-sm text-gray-900">{item.value}</p>
                </div>
              ))}
            </div>
          )}

          {details.responseBody && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">Storage Response</h4>
              <pre className="max-h-56 overflow-auto rounded-lg border border-gray-200 bg-gray-900 p-4 text-xs text-gray-100">
                {details.responseBody}
              </pre>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-gray-500">
            {formattedTimestamp ? `Captured ${formattedTimestamp}` : 'Captured just now'}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {copyFeedback && (
              <span
                className={`text-xs ${
                  copyFeedback === 'Copied!'
                    ? 'text-green-600'
                    : copyFeedback === 'Clipboard unavailable'
                      ? 'text-amber-600'
                      : 'text-red-600'
                }`}
              >
                {copyFeedback}
              </span>
            )}
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy error details
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const RAGConfigurationPage = ({ user, onClose }) => {
  const [activeTab, setActiveTab] = useState('documents');
  const [documents, setDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [error, setError] = useState(null);
  const [debugInfo, setDebugInfo] = useState(null);
  const [authDebug, setAuthDebug] = useState(null);
  const [uploadMetadata, setUploadMetadata] = useState(() => ({ ...INITIAL_UPLOAD_METADATA }));
  const [editingDocument, setEditingDocument] = useState(null);
  const [editMetadata, setEditMetadata] = useState(() => ({ ...INITIAL_EDIT_METADATA }));
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editFormError, setEditFormError] = useState(null);
  const [trainingResources, setTrainingResources] = useState([]);
  const [isLoadingTraining, setIsLoadingTraining] = useState(false);
  const [trainingError, setTrainingError] = useState(null);
  const [trainingForm, setTrainingForm] = useState({ ...TRAINING_RESOURCE_FORM_INITIAL_STATE });
  const [trainingFormError, setTrainingFormError] = useState(null);
  const [isSavingTrainingResource, setIsSavingTrainingResource] = useState(false);
  const [trainingStatus, setTrainingStatus] = useState(null);
  const [editingTrainingResourceId, setEditingTrainingResourceId] = useState(null);
  const [editingTrainingForm, setEditingTrainingForm] = useState({ ...TRAINING_RESOURCE_FORM_INITIAL_STATE });
  const [isSavingTrainingEdit, setIsSavingTrainingEdit] = useState(false);
  const [trainingEditError, setTrainingEditError] = useState(null);
  const [storageErrorDetails, setStorageErrorDetails] = useState(null);
  const [showStorageErrorModal, setShowStorageErrorModal] = useState(false);
  const isMountedRef = useRef(false);

  const openStorageErrorModal = useCallback(() => {
    if (storageErrorDetails) {
      setShowStorageErrorModal(true);
    }
  }, [storageErrorDetails]);

  const closeStorageErrorModal = useCallback(() => {
    setShowStorageErrorModal(false);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isAdmin = hasAdminRole(user);
  const hasReachedDocumentLimit = !isAdmin && documents.length >= USER_DOCUMENT_LIMIT;
  const documentLimitMessage = `You have reached the maximum of ${USER_DOCUMENT_LIMIT} documents (${documents.length}/${USER_DOCUMENT_LIMIT}). Delete an existing document before uploading a new one.`;
  const documentCountLabel = isAdmin
    ? `${documents.length} document${documents.length === 1 ? '' : 's'} uploaded`
    : `${documents.length} of ${USER_DOCUMENT_LIMIT} document uploads`;
  const editingDocumentTitle = editingDocument ? getDocumentTitle(editingDocument) : '';
  const editingDocumentFilename = editingDocument?.filename || '';

  useEffect(() => {
    if (!isAdmin && activeTab === 'summary') {
      setActiveTab('documents');
    }
  }, [isAdmin, activeTab]);

  
  // Enhanced authentication debugging
  const checkAuthentication = useCallback(async () => {
    try {
      console.log('=== AUTHENTICATION DEBUG ===');
      
      const authInfo = {
        user: {
          present: !!user,
          sub: user?.sub,
          email: user?.email,
          name: user?.name
        },
        token: {
          present: false,
          valid: false,
          payload: null
        },
        timestamp: new Date().toISOString()
      };

      // Try to get token
      try {
        const token = await getToken();
        authInfo.token.present = !!token;
        
        if (token) {
          try {
            const tokenParts = token.split('.');
            if (tokenParts.length === 3) {
              const payload = JSON.parse(atob(tokenParts[1]));
              authInfo.token.valid = true;
              authInfo.token.payload = {
                sub: payload.sub,
                aud: payload.aud,
                exp: payload.exp,
                iat: payload.iat,
                scope: payload.scope
              };
            }
          } catch (parseError) {
            console.error('Token parsing error:', parseError);
            authInfo.token.parseError = parseError.message;
          }
        }
      } catch (tokenError) {
        console.error('Token retrieval error:', tokenError);
        authInfo.token.error = tokenError.message;
      }

      console.log('Authentication info:', authInfo);
      setAuthDebug(authInfo);
      return authInfo;
      
    } catch (error) {
      console.error('Authentication check failed:', error);
      setAuthDebug({ error: error.message });
      return null;
    }
  }, [user]);

  const loadDocuments = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      console.log('Loading documents...');
      const docs = await ragService.getDocuments(user?.sub);
      console.log('Documents loaded:', docs);
      setDocuments(docs);
    } catch (error) {
      console.error('Error loading documents:', error);
      setError(`Failed to load documents: ${error.message}`);

      // If it's an auth error, check authentication
      if (error.message.includes('authentication') || error.message.includes('401')) {
        await checkAuthentication();
      }
    } finally {
      setIsLoading(false);
    }
  }, [user, checkAuthentication]);

  const loadTrainingResources = useCallback(async () => {
    if (typeof localStorage === 'undefined') {
      if (isMountedRef.current) {
        setTrainingResources([]);
      }
      return;
    }

    if (isMountedRef.current) {
      setIsLoadingTraining(true);
      setTrainingError(null);
    }

    try {
      const resources = await trainingResourceService.getTrainingResources();
      if (isMountedRef.current) {
        setTrainingResources(Array.isArray(resources) ? resources : []);
      }
    } catch (resourceError) {
      console.error('Failed to load external resources:', resourceError);
      if (isMountedRef.current) {
        setTrainingResources([]);
        setTrainingError('Failed to load external resources. Please try again.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoadingTraining(false);
      }
    }
  }, []);

  useEffect(() => {
    loadTrainingResources();
  }, [loadTrainingResources]);

  useEffect(() => {
    if (activeTab === 'training') {
      loadTrainingResources();
    }
  }, [activeTab, loadTrainingResources]);


  const handleTrainingFormChange = useCallback((field, value) => {
    setTrainingForm((prev) => ({ ...prev, [field]: value }));
    setTrainingFormError(null);
    setTrainingStatus(null);
  }, []);

  const handleAddTrainingResource = useCallback(async (event) => {
    event.preventDefault();

    if (isSavingTrainingResource) {
      return;
    }

    const payload = buildTrainingResourcePayload(trainingForm);
    if (!payload.name || !payload.url) {
      setTrainingFormError('Name and URL are required.');
      return;
    }

    setIsSavingTrainingResource(true);
    setTrainingFormError(null);
    setTrainingStatus(null);

    try {
      const created = await trainingResourceService.addTrainingResource(payload);
      setTrainingResources((prev) => {
        if (!Array.isArray(prev) || prev.length === 0) {
          return [created];
        }

        const createdId = resolveExternalResourceId(created);
        if (!createdId) {
          return [created, ...prev];
        }

        const seenIds = new Set(prev.map((item) => resolveExternalResourceId(item)));
        if (seenIds.has(createdId)) {
          return prev.map((item) => {
            const itemId = resolveExternalResourceId(item);
            return itemId && String(itemId) === String(createdId)
              ? { ...item, ...created }
              : item;
          });
        }

        return [created, ...prev];
      });

      const displayName = normalizeFormValue(created?.name || created?.title) || 'resource';
      setTrainingStatus({
        type: 'success',
        message: `Added "${displayName}" to external resources.`,
      });
      setTrainingForm({ ...TRAINING_RESOURCE_FORM_INITIAL_STATE });
    } catch (error) {
      setTrainingFormError(error.message || 'Failed to add external resource.');
    } finally {
      setIsSavingTrainingResource(false);
    }
  }, [isSavingTrainingResource, trainingForm]);

  const startEditingTrainingResource = useCallback((resource) => {
    const resourceId = resolveExternalResourceId(resource);

    if (!resourceId) {
      setTrainingStatus({
        type: 'error',
        message: 'Unable to edit this resource because it is missing an identifier.',
      });
      return;
    }

    setTrainingStatus(null);
    setEditingTrainingResourceId(resourceId);
    setEditingTrainingForm({
      name: normalizeFormValue(resource?.name || resource?.title),
      description: normalizeFormValue(resource?.description),
      url: normalizeFormValue(resource?.url),
      tag: normalizeFormValue(resource?.tag),
    });
    setTrainingEditError(null);
  }, []);

  const handleEditingTrainingFieldChange = useCallback((field, value) => {
    setEditingTrainingForm((prev) => ({ ...prev, [field]: value }));
    setTrainingEditError(null);
  }, []);

  const cancelEditingTrainingResource = useCallback(() => {
    setEditingTrainingResourceId(null);
    setEditingTrainingForm({ ...TRAINING_RESOURCE_FORM_INITIAL_STATE });
    setTrainingEditError(null);
  }, []);

  const handleSaveTrainingResource = useCallback(async (event) => {
    event.preventDefault();

    if (!editingTrainingResourceId || isSavingTrainingEdit) {
      return;
    }

    const payload = buildTrainingResourcePayload(editingTrainingForm, { includeEmpty: true });

    if (!normalizeFormValue(payload.name || payload.title) || !normalizeFormValue(payload.url)) {
      setTrainingEditError('Name and URL are required.');
      return;
    }

    setIsSavingTrainingEdit(true);
    setTrainingEditError(null);
    setTrainingStatus(null);

    try {
      const updated = await trainingResourceService.updateTrainingResource(
        editingTrainingResourceId,
        payload
      );
      const updatedId = resolveExternalResourceId(updated) || editingTrainingResourceId;

      setTrainingResources((prev) =>
        prev.map((item) => {
          const itemId = resolveExternalResourceId(item);
          return itemId && String(itemId) === String(updatedId)
            ? { ...item, ...updated }
            : item;
        })
      );

      const displayName = normalizeFormValue(updated?.name || updated?.title) || 'resource';
      setTrainingStatus({
        type: 'success',
        message: `Updated "${displayName}" successfully.`,
      });

      setEditingTrainingResourceId(null);
      setEditingTrainingForm({ ...TRAINING_RESOURCE_FORM_INITIAL_STATE });
    } catch (error) {
      setTrainingEditError(error.message || 'Failed to update external resource.');
    } finally {
      setIsSavingTrainingEdit(false);
    }
  }, [editingTrainingForm, editingTrainingResourceId, isSavingTrainingEdit]);


  const testConnection = async () => {
    try {
      console.log('=== CONNECTION TEST DEBUG ===');
      console.log('User object:', user);
      
      // Check authentication first
      const authInfo = await checkAuthentication();
      if (!authInfo?.user?.present || !authInfo?.user?.sub) {
        setError('User authentication missing. Please sign in again.');
        setDebugInfo({
          success: false,
          error: 'No authenticated user found',
          authInfo
        });
        return;
      }

      if (!authInfo?.token?.present) {
        setError('Authentication token missing. Please try refreshing the page.');
        setDebugInfo({
          success: false,
          error: 'No authentication token available',
          authInfo
        });
        return;
      }

      console.log('Testing RAG connection with auth info:', authInfo);
      
      const result = await ragService.testConnection(user?.sub);
      console.log('RAG test result:', result);
      
      setDebugInfo({
        ...result,
        authInfo,
        timestamp: new Date().toISOString()
      });
      
      if (!result.success) {
        setError(`Connection test failed: ${result.error}`);
      } else {
        setError(null);
      }
    } catch (error) {
      console.error('Connection test error:', error);
      const authInfo = await checkAuthentication();
      setDebugInfo({ 
        success: false, 
        error: error.message,
        authInfo,
        timestamp: new Date().toISOString()
      });
      setError(`Connection test failed: ${error.message}`);
    }
  };

  useEffect(() => {
    loadDocuments();
    testConnection();
    checkAuthentication();
  }, [loadDocuments, checkAuthentication, user]);


  const handleFileSelect = (event) => {
    if (hasReachedDocumentLimit) {
      event.target.value = '';
      return;
    }

    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file);
      setUploadMetadata(prev => ({
        ...prev,
        fileName: file.name,
        title: ''
      }));
    }
  };

  const handleUpload = async () => {
    if (hasReachedDocumentLimit) {
      return;
    }

    if (!selectedFile) {
      setError('Please select a file to upload');
      return;
    }

    // Check authentication before upload
    const authInfo = await checkAuthentication();
    if (!authInfo?.user?.present || !authInfo?.token?.present) {
      setError('Authentication required. Please sign in again.');
      return;
    }

    setIsLoading(true);
    setUploadStatus({ type: 'processing', message: 'Processing document...' });
    setError(null);

    try {
      const metadata = {
        ...uploadMetadata,
        fileName: uploadMetadata.fileName || selectedFile.name,
        tags: uploadMetadata.tags
          .split(',')
          .map(tag => tag.trim())
          .filter(tag => tag)
      };

      if (!metadata.tags.length) {
        delete metadata.tags;
      }

      if (typeof metadata.title === 'string') {
        metadata.title = metadata.title.trim();
        if (!metadata.title) delete metadata.title;
      }

      if (typeof metadata.description === 'string') {
        metadata.description = metadata.description.trim();
        if (!metadata.description) delete metadata.description;
      }

      if (typeof metadata.version === 'string') {
        metadata.version = metadata.version.trim();
        if (!metadata.version) delete metadata.version;
      }

      console.log('Uploading document with metadata:', metadata);
      const result = await ragService.uploadDocument(selectedFile, metadata, user?.sub);
      console.log('Upload result:', result);

      const savedDocument = result?.document || null;
      const savedMetadata = savedDocument?.metadata || result?.metadata || {};
      const conversionType = savedMetadata?.conversion;
      const wasConverted = savedMetadata?.converted || !!conversionType;
      const originalName = savedMetadata?.originalFilename || selectedFile.name;
      const storedName = savedDocument?.filename || selectedFile.name;
      
      let successMessage;
      if (wasConverted && conversionType) {
        const sourceType = describeConversionSource(conversionType);
        successMessage = sourceType 
          ? `Converted "${originalName}" from ${sourceType} to PDF and uploaded as "${storedName}"`
          : `Converted "${originalName}" to PDF and uploaded as "${storedName}"`;
      } else {
        successMessage = `Successfully uploaded "${storedName}"`;
      }

      setUploadStatus({
        type: 'success',
        message: successMessage
      });

      setSelectedFile(null);
      setUploadMetadata({ ...INITIAL_UPLOAD_METADATA });

      const fileInput = document.getElementById('file-upload');
      if (fileInput) fileInput.value = '';

      await loadDocuments();
      setStorageErrorDetails(null);
      setShowStorageErrorModal(false);

    } catch (error) {
      console.error('Error uploading document:', error);
      setUploadStatus({
        type: 'error',
        message: `Upload failed: ${error.message}`
      });
      setError(`Upload failed: ${error.message}`);

      const storageDetails = extractStorageErrorDetails(error);
      if (storageDetails) {
        setStorageErrorDetails(storageDetails);
        setShowStorageErrorModal(true);
      } else {
        setStorageErrorDetails(null);
        setShowStorageErrorModal(false);
      }

      // If it's an auth error, check authentication
      if (error.message.includes('authentication') || error.message.includes('401')) {
        await checkAuthentication();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (documentId, filename) => {
    const confirmed = window.confirm(`Are you sure you want to delete "${filename}"? This action cannot be undone.`);

    if (!confirmed) return;

    try {
      await ragService.deleteDocument(documentId, user?.sub);
      setDocuments(prev => prev.filter(doc => doc.id !== documentId));

    } catch (error) {
      console.error('Error deleting document:', error);
      setError(`Failed to delete "${filename}": ${error.message}`);

      if (error.message.includes('authentication') || error.message.includes('401')) {
        await checkAuthentication();
      }
    }
  };

  const formatTagsForInput = (tags) => {
    if (Array.isArray(tags)) {
      return tags
        .map(tag => (typeof tag === 'string' ? tag.trim() : ''))
        .filter(Boolean)
        .join(', ');
    }

    if (typeof tags === 'string') {
      return tags;
    }

    return '';
  };

  const startEditingDocument = (doc) => {
    if (!doc) {
      return;
    }

    const metadata = doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {};
    const normalizedCategory = typeof metadata.category === 'string' && metadata.category.trim()
      ? metadata.category.trim().toLowerCase()
      : 'general';

    const normalizedMetadata = {
      title: typeof metadata.title === 'string' ? metadata.title.trim() : '',
      description: typeof metadata.description === 'string' ? metadata.description.trim() : '',
      category: normalizedCategory,
      version: typeof metadata.version === 'string' ? metadata.version.trim() : '',
      tags: formatTagsForInput(metadata.tags),
    };

    setEditMetadata(normalizedMetadata);
    setEditFormError(null);
    setEditingDocument(doc);
  };

  const closeEditModal = ({ force = false } = {}) => {
    if (isSavingEdit && !force) {
      return;
    }

    setEditingDocument(null);
    setEditMetadata({ ...INITIAL_EDIT_METADATA });
    setEditFormError(null);
  };

  const handleEditMetadataChange = (field, value) => {
    setEditMetadata(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSaveMetadataChanges = async (event) => {
    if (event?.preventDefault) {
      event.preventDefault();
    }

    if (!editingDocument) {
      return;
    }

    const documentId = editingDocument.id || editingDocument.documentId || editingDocument.fileId;
    if (!documentId) {
      setEditFormError('Unable to determine which document to update.');
      return;
    }

    setIsSavingEdit(true);
    setEditFormError(null);

    try {
      const metadataPayload = {
        title: editMetadata.title,
        description: editMetadata.description,
        category: editMetadata.category || 'general',
        version: editMetadata.version,
        tags: editMetadata.tags,
      };

      const updatedDocument = await ragService.updateDocumentMetadata(documentId, metadataPayload, user?.sub);

      if (updatedDocument && typeof updatedDocument === 'object') {
        setDocuments(prevDocuments => {
          const index = prevDocuments.findIndex(doc => doc.id === updatedDocument.id);
          if (index === -1) {
            return prevDocuments;
          }

          const nextDocuments = [...prevDocuments];
          nextDocuments[index] = { ...prevDocuments[index], ...updatedDocument };
          return nextDocuments;
        });

        const updatedTitle = getDocumentTitle(updatedDocument) || updatedDocument.filename || 'document';
        setUploadStatus({
          type: 'success',
          title: 'Document details updated',
          message: `Saved new details for "${updatedTitle}".`,
        });
      }

      closeEditModal({ force: true });
    } catch (metadataError) {
      console.error('Failed to update document metadata:', metadataError);
      setEditFormError(metadataError.message || 'Failed to update document metadata.');

      const message = metadataError?.message || '';
      if (message.includes('authentication') || message.includes('401')) {
        await checkAuthentication();
      }
    } finally {
      setIsSavingEdit(false);
    }
  };

  const getFileTypeIcon = (type) => {
    const lowerType = type?.toLowerCase() || '';
    if (lowerType.includes('pdf')) return '📄';
    if (lowerType.includes('word')) return '📝';
    if (lowerType.includes('text')) return '📃';
    return '📄';
  };

  return (
    <>
      {storageErrorDetails && (
        <StorageErrorModal
          isOpen={showStorageErrorModal}
          onClose={closeStorageErrorModal}
          details={storageErrorDetails}
        />
      )}
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <Database className="h-6 w-6 text-blue-600" />
              <div>
              <h2 className="text-xl font-semibold text-gray-900">My Resources</h2>
              <p className="text-sm text-gray-500">Upload documents to power your workspace knowledge base</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close My Resources"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Enhanced Debug Info */}
        {debugInfo && !debugInfo.success && (
          <div className="p-4 border-b bg-red-50 border-red-200">
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span className="text-sm font-medium text-red-800">Function Status: Error</span>
            </div>
            <p className="text-sm text-red-700 mt-1">Error: {debugInfo.error}</p>

            {/* Authentication Status */}
            {authDebug && (
              <div className="mt-2 text-xs">
                <div className={`inline-flex items-center space-x-1 ${authDebug.user?.present ? 'text-green-600' : 'text-red-600'}`}>
                  <User className="h-3 w-3" />
                  <span>User: {authDebug.user?.present ? '✓' : '✗'}</span>
                  {authDebug.user?.sub && <span>({authDebug.user.sub.substring(0, 8)}...)</span>}
                </div>
                <div className={`inline-flex items-center space-x-1 ml-4 ${authDebug.token?.present ? 'text-green-600' : 'text-red-600'}`}>
                  <Key className="h-3 w-3" />
                  <span>Token: {authDebug.token?.present ? '✓' : '✗'}</span>
                  {authDebug.token?.valid && <span>(Valid)</span>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-220px)]">
          <div className="mb-6 border-b border-gray-200">
            <nav className="flex space-x-4" aria-label="Document and external resource tabs">
              <button
                type="button"
                onClick={() => setActiveTab('documents')}
                className={`flex items-center space-x-2 py-2 px-1 border-b-2 text-sm font-medium ${
                  activeTab === 'documents'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <span>My Resources</span>
                <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs rounded-full bg-blue-50 text-blue-600">
                  {documents.length}
                </span>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setActiveTab('summary')}
                  className={`flex items-center space-x-2 py-2 px-1 border-b-2 text-sm font-medium ${
                    activeTab === 'summary'
                      ? 'border-emerald-600 text-emerald-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <span>Generate Summary</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setActiveTab('training')}
                className={`flex items-center space-x-2 py-2 px-1 border-b-2 text-sm font-medium ${
                  activeTab === 'training'
                    ? 'border-purple-600 text-purple-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <span>External Resources</span>

                {trainingResources.length > 0 && (
                  <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs rounded-full bg-purple-50 text-purple-600">
                    {trainingResources.length}
                  </span>
                )}
              </button>
            </nav>
          </div>
          {activeTab === 'documents' && (
            <>
          {/* Error Display */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-red-800 font-medium">Error</p>
                <p className="text-red-700 text-sm">{error}</p>
                {error.includes('authentication') && (
                  <button
                    onClick={checkAuthentication}
                    className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
                  >
                    Check Authentication Status
                  </button>
                )}
                {storageErrorDetails && (
                  <button
                    type="button"
                    onClick={openStorageErrorModal}
                    className="mt-2 text-sm text-red-600 underline transition-colors hover:text-red-800"
                  >
                    View Storage error details
                  </button>
                )}
              </div>
              <button
                onClick={() => {
                  setError(null);
                  setStorageErrorDetails(null);
                  setShowStorageErrorModal(false);
                }}
                className="ml-auto text-red-500 hover:text-red-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Upload Status */}
          {uploadStatus && (
            <div className={`mb-6 p-4 rounded-lg flex items-start space-x-3 ${
              uploadStatus.type === 'success' ? 'bg-green-50 border border-green-200' :
              uploadStatus.type === 'error' ? 'bg-red-50 border border-red-200' :
              'bg-blue-50 border border-blue-200'
            }`}>
              {uploadStatus.type === 'success' && <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />}
              {uploadStatus.type === 'error' && <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />}
              {uploadStatus.type === 'processing' && <Loader className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5 animate-spin" />}
              <div className="flex-1">
                <p className={`font-medium ${
                  uploadStatus.type === 'success' ? 'text-green-800' :
                  uploadStatus.type === 'error' ? 'text-red-800' :
                  'text-blue-800'
                }`}>
                  {uploadStatus.title
                    ? uploadStatus.title
                    : uploadStatus.type === 'success'
                      ? 'Upload Successful'
                      : uploadStatus.type === 'error'
                        ? 'Upload Failed'
                        : 'Processing...'}
                </p>
                <p className={`text-sm ${
                  uploadStatus.type === 'success' ? 'text-green-700' :
                  uploadStatus.type === 'error' ? 'text-red-700' :
                  'text-blue-700'
                }`}>
                  {uploadStatus.message}
                </p>
              </div>
              <button
                onClick={() => setUploadStatus(null)}
                className={`${
                  uploadStatus.type === 'success' ? 'text-green-500 hover:text-green-700' :
                  uploadStatus.type === 'error' ? 'text-red-500 hover:text-red-700' :
                  'text-blue-500 hover:text-blue-700'
                }`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="space-y-6">
            {/* Upload Section */}
            <div className="bg-gray-50 p-6 rounded-lg">
                <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center space-x-2">
                  <Upload className="h-5 w-5" />
                  <span>Upload Document to Knowledge Base</span>
                </h3>

                {hasReachedDocumentLimit && (
                  <div className="mb-4 flex items-start space-x-3 rounded-md border border-amber-200 bg-amber-50 p-4">
                    <AlertCircle className="mt-0.5 h-5 w-5 text-amber-500" />
                    <div>
                      <p className="text-sm font-medium text-amber-800">Document limit reached</p>
                      <p className="text-sm text-amber-700">{documentLimitMessage}</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select File (PDF, DOCX, TXT, MD, CSV, or XLSX)
                    </label>
                      <input
                        id="file-upload"
                        type="file"
                        accept=".pdf,.txt,.md,.docx,.csv,.xlsx"
                        onChange={handleFileSelect}
                        disabled={hasReachedDocumentLimit}
                        className="block w-full text-sm text-gray-500 disabled:cursor-not-allowed disabled:opacity-60 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                      />
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-1">
                        File Name
                      </label>
                      <input
                        type="text"
                        value={uploadMetadata.fileName}
                        readOnly
                        className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 text-gray-900 placeholder-gray-500"
                        placeholder="Select a file to populate the file name"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-1">
                        Title
                      </label>
                      <input
                        type="text"
                        value={uploadMetadata.title}
                        onChange={(e) => setUploadMetadata(prev => ({ ...prev, title: e.target.value }))}
                        disabled={hasReachedDocumentLimit}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                        placeholder="Document title"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-1">
                        Document Summary (optional)
                      </label>
                      <textarea
                        value={uploadMetadata.description}
                        onChange={(e) => setUploadMetadata(prev => ({ ...prev, description: e.target.value }))}
                        disabled={hasReachedDocumentLimit}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                        placeholder="Add a short summary to help teammates understand when to use this document"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Provide 1-2 sentences describing the document so it appears in search results with helpful context.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-1">
                        Category
                      </label>
                      <select
                        value={uploadMetadata.category}
                        onChange={(e) => setUploadMetadata(prev => ({ ...prev, category: e.target.value }))}
                        disabled={hasReachedDocumentLimit}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                      >
                        <option value="general">General</option>
                        <option value="gmp">GMP</option>
                        <option value="validation">Validation</option>
                        <option value="capa">CAPA</option>
                        <option value="regulatory">Regulatory</option>
                        <option value="quality">Quality</option>
                        <option value="sop">SOP</option>
                        <option value="training">Training</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-1">
                        Document Version (optional)
                      </label>
                      <input
                        type="text"
                        value={uploadMetadata.version}
                        onChange={(e) => setUploadMetadata(prev => ({ ...prev, version: e.target.value }))}
                        disabled={hasReachedDocumentLimit}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                        placeholder="e.g. v1.2, Rev B"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Keep track of revisions such as SOP versions or controlled document releases.
                      </p>
                    </div>

                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    onClick={handleUpload}
                    disabled={!selectedFile || isLoading || !debugInfo?.success || hasReachedDocumentLimit}
                    className="px-6 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
                  >
                    {isLoading ? (
                      <>
                        <Loader className="h-4 w-4 animate-spin" />
                        <span>Processing...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4" />
                        <span>Upload & Process</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Documents List */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">Uploaded Documents</h3>
                    <p className="text-sm text-gray-500">{documentCountLabel}</p>
                  </div>
                  <button
                    onClick={loadDocuments}
                    disabled={isLoading}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-md hover:border-gray-400 transition-colors flex items-center space-x-2"
                  >
                    <Download className="h-4 w-4" />
                    <span>Refresh</span>
                  </button>
                </div>

                {isLoading ? (
                  <div className="text-center py-12">
                    <Loader className="h-8 w-8 text-blue-600 mx-auto animate-spin mb-4" />
                    <p className="text-gray-600">Loading your uploaded documents...</p>
                  </div>
                ) : documents.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h4 className="text-lg font-medium text-gray-900 mb-2">No Documents Yet</h4>
                    <p className="text-gray-600">Upload your first document to get started with RAG search.</p>
                    {!debugInfo?.success && (
                      <p className="text-red-600 text-sm mt-2">
                        Please fix authentication issues above before uploading.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Document
                            </th>
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Category
                            </th>
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Version
                            </th>
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Uploaded
                            </th>
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Tags
                            </th>
                            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {documents.map((doc) => {
                            const rawTitle = typeof doc?.metadata?.title === 'string' ? doc.metadata.title.trim() : '';
                            const displayTitle = getDocumentTitle(doc);
                            const storedFilename = doc?.filename || '';
                            const showStoredFilename = Boolean(rawTitle) && storedFilename && displayTitle !== storedFilename;
                            const description = typeof doc?.metadata?.description === 'string'
                              ? doc.metadata.description.trim()
                              : '';

                            return (
                              <tr key={doc.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3">
                                  <div className="flex items-center space-x-3">
                                    <span className="text-2xl">{getFileTypeIcon(doc.type)}</span>
                                    <div className="min-w-0">
                                      <p
                                        className="text-sm font-semibold text-gray-900 truncate max-w-[240px]"
                                        title={displayTitle}
                                      >
                                        {displayTitle}
                                      </p>
                                      {showStoredFilename && (
                                        <p
                                          className="text-xs text-gray-500 truncate max-w-[240px]"
                                          title={storedFilename}
                                        >
                                          {storedFilename}
                                        </p>
                                      )}
                                      {description && (
                                        <p className="mt-1 text-xs text-gray-600">
                                          {description}
                                        </p>
                                      )}
                                      {doc.metadata?.conversion && doc.metadata?.originalFilename && (
                                        <p className="text-xs text-gray-500 mt-1">
                                          <span className="font-medium text-gray-600">Original:</span> {doc.metadata.originalFilename} (converted from {describeConversionSource(doc.metadata.conversion) || 'the uploaded format'})
                                        </p>
                                      )}
                                      {doc.metadata?.storage && (
                                        <p className="text-xs text-gray-500 mt-1 space-y-0.5">
                                          <span className="font-medium text-gray-600">Storage:</span>{' '}
                                          {doc.metadata.storage.url ? (
                                            <a
                                              href={doc.metadata.storage.url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-blue-600 hover:text-blue-500 underline"
                                            >
                                              View item
                                            </a>
                                          ) : (
                                            <span className="text-gray-600">Netlify Blob item</span>
                                          )}
                                          {doc.metadata.storage.path && (
                                            <span className="block text-[11px] text-gray-400 break-all">
                                              Path: {doc.metadata.storage.path}
                                            </span>
                                          )}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-700">
                                  {(doc.metadata?.category || 'General')}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-700">
                                  {doc.metadata?.version || '—'}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                                  {new Date(doc.createdAt).toLocaleDateString()}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-700">
                                  {doc.metadata?.tags && doc.metadata.tags.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {doc.metadata.tags.map((tag, index) => (
                                        <span
                                          key={index}
                                          className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full"
                                        >
                                          {tag}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <div className="inline-flex items-center space-x-2">
                                    <button
                                      onClick={() => startEditingDocument(doc)}
                                      className="p-2 text-gray-400 hover:text-blue-500 transition-colors"
                                      aria-label={`Edit ${displayTitle || doc.filename}`}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </button>
                                    <button
                                      onClick={() => handleDelete(doc.id, displayTitle || doc.filename)}
                                      className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                                      aria-label={`Delete ${displayTitle || doc.filename}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
            </div>
          </div>
          </>
        )}

        {isAdmin && activeTab === 'summary' && (
          <div className="space-y-6">
            <SummaryRequestPanel documents={documents} user={user} />
          </div>
        )}

        {activeTab === 'training' && (
          <div className="space-y-6">
            <div className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="flex items-center space-x-2 text-lg font-semibold text-gray-900">
                      <BookOpen className="h-5 w-5 text-purple-600" />
                      <span>External Resources</span>
                    </h3>
                    <p className="text-sm text-gray-500">
                      Access curated external references provided by your administrators.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={loadTrainingResources}
                    disabled={isLoadingTraining}
                    className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${isLoadingTraining ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>

                {trainingError && (
                  <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {trainingError}
                  </div>
                )}

                {trainingStatus && (
                  <div
                    className={`mt-4 flex items-start justify-between gap-3 rounded-md border p-4 text-sm ${
                      trainingStatus.type === 'success'
                        ? 'border-green-200 bg-green-50 text-green-800'
                        : 'border-red-200 bg-red-50 text-red-800'
                    }`}
                  >
                    <p className="flex-1">{trainingStatus.message}</p>
                    <button
                      type="button"
                      onClick={() => setTrainingStatus(null)}
                      className="text-current transition-colors hover:text-gray-900"
                      aria-label="Dismiss external resource status"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                <form
                  onSubmit={handleAddTrainingResource}
                  className="mt-6 rounded-lg border border-purple-200 bg-purple-50 p-4"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h4 className="flex items-center text-sm font-semibold text-purple-900">
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Add external resource
                      </h4>
                      <p className="mt-1 text-xs text-purple-800/80">
                        Store helpful links so they are always available in your workspace.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-purple-900">Name</label>
                      <input
                        type="text"
                        value={trainingForm.name}
                        onChange={(event) => handleTrainingFormChange('name', event.target.value)}
                        className="w-full rounded-md border border-purple-200 px-3 py-2 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/40"
                        placeholder="Resource title"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-purple-900">URL</label>
                      <input
                        type="url"
                        value={trainingForm.url}
                        onChange={(event) => handleTrainingFormChange('url', event.target.value)}
                        className="w-full rounded-md border border-purple-200 px-3 py-2 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/40"
                        placeholder="https://example.com/resource"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-purple-900">Description (optional)</label>
                      <textarea
                        rows={3}
                        value={trainingForm.description}
                        onChange={(event) => handleTrainingFormChange('description', event.target.value)}
                        className="w-full rounded-md border border-purple-200 px-3 py-2 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/40"
                        placeholder="Brief summary of how this resource helps"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-purple-900">Tag (optional)</label>
                      <input
                        type="text"
                        value={trainingForm.tag}
                        onChange={(event) => handleTrainingFormChange('tag', event.target.value)}
                        className="w-full rounded-md border border-purple-200 px-3 py-2 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/40"
                        placeholder="e.g., compliance"
                      />
                    </div>
                  </div>

                  {trainingFormError && (
                    <p className="mt-3 text-sm text-red-600">{trainingFormError}</p>
                  )}

                  <div className="mt-4 flex justify-end">
                    <button
                      type="submit"
                      disabled={isSavingTrainingResource}
                      className="inline-flex items-center rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSavingTrainingResource ? (
                        <Loader className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <PlusCircle className="mr-2 h-4 w-4" />
                      )}
                      {isSavingTrainingResource ? 'Saving...' : 'Add Resource'}
                    </button>
                  </div>
                </form>

                <div className="mt-6 border-t border-gray-100 pt-6">
                  {isLoadingTraining ? (
                    <div className="py-12 text-center text-gray-600">
                      <Loader className="mx-auto mb-3 h-6 w-6 animate-spin text-purple-500" />
                      <p>Loading external resources...</p>
                    </div>
                  ) : trainingResources.length === 0 ? (
                    <div className="py-12 text-center text-gray-600">
                      <BookOpen className="mx-auto mb-3 h-8 w-8 text-purple-500" />
                      <h4 className="mb-2 text-lg font-medium text-gray-900">No external resources yet</h4>
                      <p className="text-sm">
                        External resources added by your team will appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      {trainingResources.map((resource, index) => {
                        const resourceId = resolveExternalResourceId(resource);
                        const resourceKey = resourceId ? String(resourceId) : `resource-${index}`;
                        const name = normalizeFormValue(resource?.name || resource?.title) || 'Untitled resource';
                        const description = normalizeFormValue(resource?.description);
                        const url = normalizeFormValue(resource?.url);
                        const tag = normalizeFormValue(resource?.tag);
                        const isEditing = Boolean(
                          editingTrainingResourceId &&
                          resourceId &&
                          String(editingTrainingResourceId) === String(resourceId)
                        );
                        let hostname = '';

                        if (url) {
                          try {
                            hostname = new URL(url).hostname;
                          } catch (urlError) {
                            hostname = url;
                          }
                        }

                        return (
                          <div
                            key={resourceKey}
                            className="rounded-lg border border-gray-200 p-4 transition-all hover:border-purple-300 hover:shadow-sm"
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <h4 className="text-base font-semibold text-gray-900">
                                  {url ? (
                                    <a
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-purple-700 hover:text-purple-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 rounded"
                                      title={url}
                                    >
                                      {name}
                                    </a>
                                  ) : (
                                    name
                                  )}
                                </h4>
                                {tag && (
                                  <span className="mt-2 inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                                    #{tag}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {!isEditing && (
                                  <button
                                    type="button"
                                    onClick={() => startEditingTrainingResource(resource)}
                                    className="inline-flex items-center rounded-md border border-purple-200 px-2.5 py-1 text-xs font-medium text-purple-700 transition-colors hover:border-purple-300 hover:text-purple-900"
                                  >
                                    <Pencil className="mr-1 h-3.5 w-3.5" />
                                    Edit
                                  </button>
                                )}
                                {url && (
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center text-sm text-purple-600 transition-colors hover:text-purple-800"
                                    title={url}
                                  >
                                    <span>{hostname ? `Open ${hostname}` : 'Open resource'}</span>
                                    <ExternalLink className="ml-1 h-4 w-4" />
                                  </a>
                                )}
                              </div>
                            </div>

                            {isEditing ? (
                              <form
                                onSubmit={handleSaveTrainingResource}
                                className="mt-4 space-y-4 rounded-lg border border-purple-100 bg-purple-50 p-4"
                              >
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                  <div>
                                    <label className="mb-1 block text-xs font-medium text-purple-900">Name</label>
                                    <input
                                      type="text"
                                      value={editingTrainingForm.name}
                                      onChange={(event) => handleEditingTrainingFieldChange('name', event.target.value)}
                                      className="w-full rounded-md border border-purple-200 px-3 py-2 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/40"
                                      placeholder="Resource title"
                                    />
                                  </div>
                                  <div>
                                    <label className="mb-1 block text-xs font-medium text-purple-900">URL</label>
                                    <input
                                      type="url"
                                      value={editingTrainingForm.url}
                                      onChange={(event) => handleEditingTrainingFieldChange('url', event.target.value)}
                                      className="w-full rounded-md border border-purple-200 px-3 py-2 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/40"
                                      placeholder="https://example.com/resource"
                                    />
                                  </div>
                                  <div className="md:col-span-2">
                                    <label className="mb-1 block text-xs font-medium text-purple-900">Description (optional)</label>
                                    <textarea
                                      rows={3}
                                      value={editingTrainingForm.description}
                                      onChange={(event) => handleEditingTrainingFieldChange('description', event.target.value)}
                                      className="w-full rounded-md border border-purple-200 px-3 py-2 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/40"
                                      placeholder="Brief summary"
                                    />
                                  </div>
                                  <div>
                                    <label className="mb-1 block text-xs font-medium text-purple-900">Tag (optional)</label>
                                    <input
                                      type="text"
                                      value={editingTrainingForm.tag}
                                      onChange={(event) => handleEditingTrainingFieldChange('tag', event.target.value)}
                                      className="w-full rounded-md border border-purple-200 px-3 py-2 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/40"
                                      placeholder="e.g., compliance"
                                    />
                                  </div>
                                </div>
                                {trainingEditError && (
                                  <p className="text-sm text-red-600">{trainingEditError}</p>
                                )}
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={cancelEditingTrainingResource}
                                    className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="submit"
                                    disabled={isSavingTrainingEdit}
                                    className="inline-flex items-center rounded-md bg-purple-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {isSavingTrainingEdit ? (
                                      <Loader className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                      <Save className="mr-2 h-4 w-4" />
                                    )}
                                    {isSavingTrainingEdit ? 'Saving...' : 'Save changes'}
                                  </button>
                                </div>
                              </form>
                            ) : (
                              <>
                                {description && (
                                  <p className="mt-3 text-sm text-gray-600">{description}</p>
                                )}
                                {!url && (
                                  <p className="mt-3 text-xs text-gray-500">
                                    No direct link provided for this resource.
                                  </p>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>

        {editingDocument && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm overflow-y-auto">
            <div className="flex min-h-full items-center justify-center px-4 py-8">
              <div className="bg-white w-full max-w-3xl rounded-lg shadow-2xl flex flex-col max-h-[80vh] overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                  <div>
                    <div className="flex items-center space-x-2">
                      <Pencil className="h-5 w-5 text-blue-600" />
                      <h3 className="text-lg font-semibold text-gray-900">Edit document details</h3>
                    </div>
                    <p className="text-sm text-gray-500 mt-1 truncate">
                      {editingDocumentTitle || editingDocumentFilename}
                      {editingDocumentFilename && editingDocumentTitle && editingDocumentTitle !== editingDocumentFilename && (
                        <span className="text-gray-400"> · {editingDocumentFilename}</span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => closeEditModal()}
                    disabled={isSavingEdit}
                    className="p-2 text-gray-400 hover:text-gray-600 disabled:opacity-60 disabled:cursor-not-allowed"
                    aria-label="Close edit document modal"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <form onSubmit={handleSaveMetadataChanges} className="flex-1 flex flex-col min-h-0">
                  <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                    {editFormError && (
                      <div className="p-3 border border-red-200 bg-red-50 rounded-md text-sm text-red-700">
                        {editFormError}
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-900 mb-1">
                          Title
                        </label>
                        <input
                          type="text"
                          value={editMetadata.title}
                          onChange={(event) => handleEditMetadataChange('title', event.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-500"
                          placeholder="Document title"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-900 mb-1">
                          Document Summary (optional)
                        </label>
                        <textarea
                          value={editMetadata.description}
                          onChange={(event) => handleEditMetadataChange('description', event.target.value)}
                          rows={4}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-500"
                          placeholder="Add a short summary to help teammates understand when to use this document"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">
                          Category
                        </label>
                        <select
                          value={editMetadata.category}
                          onChange={(event) => handleEditMetadataChange('category', event.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                        >
                          <option value="general">General</option>
                          <option value="gmp">GMP</option>
                          <option value="validation">Validation</option>
                          <option value="capa">CAPA</option>
                          <option value="regulatory">Regulatory</option>
                          <option value="quality">Quality</option>
                          <option value="sop">SOP</option>
                          <option value="training">Training</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">
                          Document Version (optional)
                        </label>
                        <input
                          type="text"
                          value={editMetadata.version}
                          onChange={(event) => handleEditMetadataChange('version', event.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-500"
                          placeholder="e.g. v1.2, Rev B"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-900 mb-1">
                          Tags (optional)
                        </label>
                        <input
                          type="text"
                          value={editMetadata.tags}
                          onChange={(event) => handleEditMetadataChange('tags', event.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-500"
                          placeholder="Comma separated keywords (e.g. policy, onboarding)"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          Separate tags with commas to help group similar documents in search results.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-gray-100 px-6 py-4 flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => closeEditModal()}
                      disabled={isSavingEdit}
                      className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 border border-gray-300 rounded-md hover:border-gray-400 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingEdit}
                      className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isSavingEdit ? (
                        <>
                          <Loader className="h-4 w-4 animate-spin" />
                          <span className="ml-2">Saving...</span>
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4" />
                          <span className="ml-2">Save changes</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </>
  );
};

export default RAGConfigurationPage;
