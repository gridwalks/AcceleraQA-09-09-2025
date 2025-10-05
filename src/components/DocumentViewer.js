import React, { useState, useEffect, useRef } from 'react';
import { X, Download, FileText, Eye, Loader2, AlertCircle, ExternalLink } from 'lucide-react';

const DocumentViewer = ({ 
  document, 
  isOpen, 
  onClose, 
  onDownload 
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [documentContent, setDocumentContent] = useState(null);
  const [viewMode, setViewMode] = useState('text'); // 'text', 'pdf', 'summary'
  const iframeRef = useRef(null);

  useEffect(() => {
    if (isOpen && document) {
      loadDocumentContent();
    }
  }, [isOpen, document]);

  const loadDocumentContent = async () => {
    if (!document) return;

    setIsLoading(true);
    setError(null);

    try {
      // For now, we'll use the text content directly
      // In a real implementation, you might fetch the actual file
      setDocumentContent({
        text: document.textContent || document.summary || 'No content available',
        filename: document.filename || document.documentName,
        fileType: document.fileType || 'text',
        size: document.fileSize
      });
    } catch (err) {
      console.error('Error loading document:', err);
      setError('Failed to load document content');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!document) return;

    try {
      setIsLoading(true);
      
      const response = await fetch(`/.netlify/functions/download-file?documentId=${document.documentId}&format=pdf`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'x-user-id': localStorage.getItem('user_id')
        }
      });

      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${document.filename || document.documentName}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      if (onDownload) {
        onDownload(document);
      }
    } catch (err) {
      console.error('Download error:', err);
      setError('Failed to download document');
    } finally {
      setIsLoading(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown size';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown date';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (!isOpen || !document) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
          onClick={onClose}
        />
        
        {/* Modal */}
        <div className="relative w-full max-w-6xl bg-white rounded-lg shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <FileText className="h-6 w-6 text-blue-600" />
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {document.documentName || document.title || document.filename}
                </h2>
                <div className="flex items-center space-x-4 text-sm text-gray-500 mt-1">
                  {document.documentNumber && (
                    <span>Document: {document.documentNumber}</span>
                  )}
                  {document.majorVersion && document.minorVersion && (
                    <span>Version: {document.majorVersion}.{document.minorVersion}</span>
                  )}
                  {document.documentType && (
                    <span className="capitalize">{document.documentType}</span>
                  )}
                  {document.status && (
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      document.status === 'active' 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {document.status}
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              {/* View Mode Toggle */}
              <div className="flex rounded-lg border border-gray-300">
                <button
                  onClick={() => setViewMode('text')}
                  className={`px-3 py-1 text-sm rounded-l-lg ${
                    viewMode === 'text'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Text
                </button>
                <button
                  onClick={() => setViewMode('summary')}
                  className={`px-3 py-1 text-sm border-l border-r border-gray-300 ${
                    viewMode === 'summary'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Summary
                </button>
                <button
                  onClick={() => setViewMode('pdf')}
                  className={`px-3 py-1 text-sm rounded-r-lg ${
                    viewMode === 'pdf'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  PDF
                </button>
              </div>
              
              {/* Download Button */}
              <button
                onClick={handleDownload}
                disabled={isLoading}
                className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span className="ml-2">Download</span>
              </button>
              
              {/* Close Button */}
              <button
                onClick={onClose}
                className="inline-flex items-center justify-center w-8 h-8 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center">
                  <AlertCircle className="h-5 w-5 text-red-400 mr-2" />
                  <span className="text-red-800">{error}</span>
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                <span className="ml-2 text-gray-600">Loading document...</span>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Document Metadata */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg">
                  <div>
                    <label className="text-sm font-medium text-gray-500">File Size</label>
                    <p className="text-sm text-gray-900">{formatFileSize(document.fileSize)}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-500">Created</label>
                    <p className="text-sm text-gray-900">{formatDate(document.createdAt)}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-500">Updated</label>
                    <p className="text-sm text-gray-900">{formatDate(document.updatedAt)}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-500">File Type</label>
                    <p className="text-sm text-gray-900 capitalize">{document.fileType || 'Unknown'}</p>
                  </div>
                </div>

                {/* Document Content */}
                <div className="border border-gray-200 rounded-lg">
                  {viewMode === 'text' && (
                    <div className="p-6">
                      <h3 className="text-lg font-medium text-gray-900 mb-4">Document Content</h3>
                      <div className="prose max-w-none">
                        <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 p-4 rounded-lg overflow-auto max-h-96">
                          {documentContent?.text || 'No content available'}
                        </pre>
                      </div>
                    </div>
                  )}

                  {viewMode === 'summary' && (
                    <div className="p-6">
                      <h3 className="text-lg font-medium text-gray-900 mb-4">Document Summary</h3>
                      <div className="space-y-4">
                        {document.manualSummary && (
                          <div>
                            <h4 className="text-sm font-medium text-blue-600 mb-2">Manual Summary</h4>
                            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                              <p className="text-sm text-gray-700">{document.manualSummary}</p>
                            </div>
                          </div>
                        )}
                        {document.summary && (
                          <div>
                            <h4 className="text-sm font-medium text-gray-600 mb-2">AI Summary</h4>
                            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                              <p className="text-sm text-gray-700">{document.summary}</p>
                            </div>
                          </div>
                        )}
                        {!document.manualSummary && !document.summary && (
                          <div className="text-center py-8 text-gray-500">
                            <FileText className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                            <p>No summary available for this document</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {viewMode === 'pdf' && (
                    <div className="p-6">
                      <h3 className="text-lg font-medium text-gray-900 mb-4">PDF View</h3>
                      <div className="text-center py-8 text-gray-500">
                        <FileText className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                        <p>PDF view not available in this demo</p>
                        <p className="text-sm">Click Download to get the PDF version</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DocumentViewer;