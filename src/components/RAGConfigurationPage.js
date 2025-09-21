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
  ExternalLink
} from 'lucide-react';
import ragService from '../services/ragService';
import { getToken } from '../services/authService';
import { hasAdminRole } from '../utils/auth';
import trainingResourceService from '../services/trainingResourceService';

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

const RAGConfigurationPage = ({ user, onClose }) => {
  const [activeTab, setActiveTab] = useState('documents');
  const [documents, setDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [error, setError] = useState(null);
  const [debugInfo, setDebugInfo] = useState(null);
  const [authDebug, setAuthDebug] = useState(null);
  const [uploadMetadata, setUploadMetadata] = useState({
    fileName: '',
    title: '',
    description: '',
    tags: '',
    category: 'general',
    version: ''
  });
  const [trainingResources, setTrainingResources] = useState([]);
  const [isLoadingTraining, setIsLoadingTraining] = useState(false);
  const [trainingError, setTrainingError] = useState(null);
  const isMountedRef = useRef(false);

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
    : `${documents.length} of ${USER_DOCUMENT_LIMIT} document uploads`


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
      const isDocxConversion = savedMetadata?.conversion === 'docx-to-pdf';
      const originalName = savedMetadata?.originalFilename || selectedFile.name;
      const storedName = savedDocument?.filename || selectedFile.name;
      const successMessage = isDocxConversion
        ? `Converted "${originalName}" to PDF and uploaded as "${storedName}"`
        : `Successfully uploaded "${storedName}"`;

      setUploadStatus({
        type: 'success',
        message: successMessage
      });

      setSelectedFile(null);
      setUploadMetadata({
        fileName: '',
        title: '',
        description: '',
        tags: '',
        category: 'general',
        version: ''
      });

      const fileInput = document.getElementById('file-upload');
      if (fileInput) fileInput.value = '';
      
      await loadDocuments();
      
    } catch (error) {
      console.error('Error uploading document:', error);
      setUploadStatus({ 
        type: 'error', 
        message: `Upload failed: ${error.message}` 
      });
      setError(`Upload failed: ${error.message}`);
      
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

  const getFileTypeIcon = (type) => {
    const lowerType = type?.toLowerCase() || '';
    if (lowerType.includes('pdf')) return '📄';
    if (lowerType.includes('word')) return '📝';
    if (lowerType.includes('text')) return '📃';
    return '📄';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden">
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
              </div>
              <button
                onClick={() => setError(null)}
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
                  {uploadStatus.type === 'success' ? 'Upload Successful' :
                   uploadStatus.type === 'error' ? 'Upload Failed' :
                   'Processing...'}
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
                                  <button
                                    onClick={() => handleDelete(doc.id, displayTitle || doc.filename)}
                                    className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                                    aria-label={`Delete ${displayTitle || doc.filename}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
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

          {activeTab === 'training' && (
            <div className="space-y-6">
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
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
                    className="inline-flex items-center px-3 py-2 text-sm font-medium border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${isLoadingTraining ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>

                {trainingError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                    {trainingError}
                  </div>
                )}

                {isLoadingTraining ? (
                  <div className="py-12 text-center text-gray-600">
                    <Loader className="h-6 w-6 animate-spin mx-auto mb-3 text-purple-500" />
                    <p>Loading external resources...</p>
                  </div>
                ) : trainingResources.length === 0 ? (
                  <div className="py-12 text-center text-gray-600">
                    <BookOpen className="h-8 w-8 mx-auto mb-3 text-purple-500" />
                    <h4 className="text-lg font-medium text-gray-900 mb-2">No external resources yet</h4>
                    <p className="text-sm">
                      External resources added by your administrators will appear here.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {trainingResources.map((resource, index) => {
                      const name = typeof resource?.name === 'string' && resource.name.trim()
                        ? resource.name.trim()
                        : typeof resource?.title === 'string' && resource.title.trim()
                          ? resource.title.trim()
                          : 'Untitled resource';
                      const description = typeof resource?.description === 'string' ? resource.description.trim() : '';
                      const url = typeof resource?.url === 'string' ? resource.url.trim() : '';
                      const tag = typeof resource?.tag === 'string' ? resource.tag.trim() : '';
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
                          key={resource?.id || index}
                          className="p-4 border border-gray-200 rounded-lg hover:border-purple-300 hover:shadow-sm transition-all"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h4 className="text-base font-semibold text-gray-900">{name}</h4>
                              {tag && (
                                <span className="inline-flex items-center mt-2 px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
                                  #{tag}
                                </span>
                              )}
                            </div>
                            {url && (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center text-sm text-purple-600 hover:text-purple-800"
                                title={url}
                              >
                                <span>{hostname ? `Open ${hostname}` : 'Open resource'}</span>
                                <ExternalLink className="h-4 w-4 ml-1" />
                              </a>
                            )}
                          </div>
                          {description && (
                            <p className="mt-3 text-sm text-gray-600">{description}</p>
                          )}
                          {!url && (
                            <p className="mt-3 text-xs text-gray-500">No direct link provided for this resource.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default RAGConfigurationPage;
