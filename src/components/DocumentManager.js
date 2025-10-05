import React, { useState, useEffect, useCallback } from 'react';
import { 
  Search, 
  Filter, 
  Download, 
  Eye, 
  Edit3, 
  Save, 
  X, 
  FileText, 
  Plus,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  Database,
  FileDown,
  Trash2
} from 'lucide-react';
import DocumentViewer from './DocumentViewer';

const DocumentManager = ({ userId }) => {
  const [documents, setDocuments] = useState([]);
  const [filteredDocuments, setFilteredDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDocumentType, setSelectedDocumentType] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [hasManualSummary, setHasManualSummary] = useState('all');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [documentTypes, setDocumentTypes] = useState([]);
  const [stats, setStats] = useState(null);
  
  // Document viewer state
  const [viewerDocument, setViewerDocument] = useState(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  
  // Manual summary editing state
  const [editingSummary, setEditingSummary] = useState(null);
  const [editingSummaryText, setEditingSummaryText] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);

  const documentsPerPage = 20;

  // Load documents
  const loadDocuments = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const offset = (currentPage - 1) * documentsPerPage;
      const response = await fetch(`/.netlify/functions/get-indexed-documents?action=list&limit=${documentsPerPage}&offset=${offset}&search=${encodeURIComponent(searchTerm)}&documentType=${selectedDocumentType}&status=${selectedStatus}&hasManualSummary=${hasManualSummary}&sortBy=${sortBy}&sortOrder=${sortOrder}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'x-user-id': userId
        }
      });

      if (!response.ok) {
        throw new Error('Failed to load documents');
      }

      const data = await response.json();
      setDocuments(data.documents || []);
      setTotalPages(Math.ceil((data.total || 0) / documentsPerPage));
    } catch (err) {
      console.error('Error loading documents:', err);
      setError('Failed to load documents');
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, searchTerm, selectedDocumentType, selectedStatus, hasManualSummary, sortBy, sortOrder, userId]);

  // Load document types and stats
  const loadMetadata = useCallback(async () => {
    try {
      const [typesResponse, statsResponse] = await Promise.all([
        fetch(`/.netlify/functions/get-indexed-documents?action=types`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
            'x-user-id': userId
          }
        }),
        fetch(`/.netlify/functions/get-indexed-documents?action=stats`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
            'x-user-id': userId
          }
        })
      ]);

      if (typesResponse.ok) {
        const typesData = await typesResponse.json();
        setDocumentTypes(typesData.documentTypes || []);
      }

      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        setStats(statsData.stats);
      }
    } catch (err) {
      console.error('Error loading metadata:', err);
    }
  }, [userId]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  // Filter documents locally for better UX
  useEffect(() => {
    let filtered = [...documents];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(doc => 
        doc.documentName?.toLowerCase().includes(term) ||
        doc.documentNumber?.toLowerCase().includes(term) ||
        doc.summary?.toLowerCase().includes(term) ||
        doc.manualSummary?.toLowerCase().includes(term)
      );
    }

    setFilteredDocuments(filtered);
  }, [documents, searchTerm]);

  const handleSearch = (e) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const handleFilterChange = (filterType, value) => {
    switch (filterType) {
      case 'documentType':
        setSelectedDocumentType(value);
        break;
      case 'status':
        setSelectedStatus(value);
        break;
      case 'hasManualSummary':
        setHasManualSummary(value);
        break;
      case 'sortBy':
        setSortBy(value);
        break;
      case 'sortOrder':
        setSortOrder(value);
        break;
    }
    setCurrentPage(1);
  };

  const handleOpenDocumentViewer = (document) => {
    setViewerDocument(document);
    setIsViewerOpen(true);
  };

  const handleCloseDocumentViewer = () => {
    setIsViewerOpen(false);
    setViewerDocument(null);
  };

  const handleDownload = async (document) => {
    try {
      const response = await fetch(`/.netlify/functions/download-file?documentId=${document.documentId}&format=pdf`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'x-user-id': userId
        }
      });

      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${document.documentName || document.filename}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Download error:', err);
      alert('Failed to download document');
    }
  };

  const handleEditSummary = (document) => {
    setEditingSummary(document);
    setEditingSummaryText(document.manualSummary || document.summary || '');
  };

  const handleSaveSummary = async () => {
    if (!editingSummary || !editingSummaryText.trim()) return;
    
    setSavingSummary(true);
    try {
      const response = await fetch('/.netlify/functions/update-manual-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'x-user-id': userId
        },
        body: JSON.stringify({
          action: 'update',
          documentId: editingSummary.documentId,
          manualSummary: editingSummaryText.trim()
        })
      });

      if (response.ok) {
        // Reload documents to reflect changes
        await loadDocuments();
        setEditingSummary(null);
        setEditingSummaryText('');
      } else {
        throw new Error('Failed to save summary');
      }
    } catch (error) {
      console.error('Error saving summary:', error);
      alert('Failed to save summary. Please try again.');
    } finally {
      setSavingSummary(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingSummary(null);
    setEditingSummaryText('');
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (isLoading && documents.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading documents...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Document Management</h1>
          <p className="text-gray-600">Manage and view your indexed documents</p>
        </div>
        <button
          onClick={loadDocuments}
          disabled={isLoading}
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="flex items-center">
              <Database className="h-8 w-8 text-blue-600" />
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Total Documents</p>
                <p className="text-2xl font-bold text-gray-900">{stats.totalDocuments}</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="flex items-center">
              <CheckCircle className="h-8 w-8 text-green-600" />
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">With Manual Summary</p>
                <p className="text-2xl font-bold text-gray-900">{stats.documentsWithManualSummary}</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="flex items-center">
              <Clock className="h-8 w-8 text-yellow-600" />
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">With AI Summary</p>
                <p className="text-2xl font-bold text-gray-900">{stats.documentsWithAISummary}</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="flex items-center">
              <AlertCircle className="h-8 w-8 text-red-600" />
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Without Summary</p>
                <p className="text-2xl font-bold text-gray-900">{stats.documentsWithoutSummary}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg border border-gray-200">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <div className="md:col-span-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search documents..."
                value={searchTerm}
                onChange={handleSearch}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
          
          <select
            value={selectedDocumentType}
            onChange={(e) => handleFilterChange('documentType', e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All Types</option>
            {documentTypes.map(type => (
              <option key={type.type} value={type.type}>
                {type.type} ({type.count})
              </option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => handleFilterChange('status', e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>

          <select
            value={hasManualSummary}
            onChange={(e) => handleFilterChange('hasManualSummary', e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All Summaries</option>
            <option value="true">With Manual Summary</option>
            <option value="false">Without Manual Summary</option>
          </select>

          <select
            value={`${sortBy}-${sortOrder}`}
            onChange={(e) => {
              const [field, order] = e.target.value.split('-');
              handleFilterChange('sortBy', field);
              handleFilterChange('sortOrder', order);
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="createdAt-desc">Newest First</option>
            <option value="createdAt-asc">Oldest First</option>
            <option value="documentName-asc">Name A-Z</option>
            <option value="documentName-desc">Name Z-A</option>
            <option value="documentNumber-asc">Doc Number</option>
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-red-400 mr-2" />
            <span className="text-red-800">{error}</span>
          </div>
        </div>
      )}

      {/* Documents Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Document
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type & Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Summary
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Size & Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredDocuments.map((doc) => (
                <tr key={doc.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <FileText className="h-8 w-8 text-gray-400 mr-3" />
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {doc.documentName || doc.title || doc.filename}
                        </div>
                        {doc.documentNumber && (
                          <div className="text-sm text-blue-600">
                            {doc.documentNumber} v{doc.majorVersion || 1}.{doc.minorVersion || 0}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="space-y-1">
                      {doc.documentType && (
                        <span className="inline-flex px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 rounded-full capitalize">
                          {doc.documentType}
                        </span>
                      )}
                      {doc.status && (
                        <div>
                          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                            doc.status === 'active' 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {doc.status}
                          </span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900 max-w-xs">
                      {editingSummary?.id === doc.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={editingSummaryText}
                            onChange={(e) => setEditingSummaryText(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded text-sm"
                            rows={3}
                            placeholder="Enter manual summary..."
                          />
                          <div className="flex space-x-2">
                            <button
                              onClick={handleSaveSummary}
                              disabled={savingSummary}
                              className="inline-flex items-center px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                              <Save className="h-3 w-3 mr-1" />
                              Save
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="inline-flex items-center px-2 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700"
                            >
                              <X className="h-3 w-3 mr-1" />
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          {doc.manualSummary ? (
                            <div>
                              <span className="text-xs text-blue-600 font-medium">Manual:</span>
                              <p className="text-xs text-gray-700 line-clamp-2">{doc.manualSummary}</p>
                            </div>
                          ) : doc.summary ? (
                            <div>
                              <span className="text-xs text-gray-500 font-medium">AI:</span>
                              <p className="text-xs text-gray-700 line-clamp-2">{doc.summary}</p>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400 italic">No summary</span>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div>{formatFileSize(doc.fileSize)}</div>
                    <div>{formatDate(doc.createdAt)}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleOpenDocumentViewer(doc)}
                        className="text-blue-600 hover:text-blue-900"
                        title="View document"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDownload(doc)}
                        className="text-green-600 hover:text-green-900"
                        title="Download document"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleEditSummary(doc)}
                        className="text-gray-600 hover:text-gray-900"
                        title="Edit summary"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="bg-white px-4 py-3 border-t border-gray-200 sm:px-6">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing page {currentPage} of {totalPages}
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Document Viewer Modal */}
      <DocumentViewer
        document={viewerDocument}
        isOpen={isViewerOpen}
        onClose={handleCloseDocumentViewer}
        onDownload={handleDownload}
      />
    </div>
  );
};

export default DocumentManager;