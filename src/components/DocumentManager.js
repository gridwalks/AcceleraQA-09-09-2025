import React, { useState, useEffect, useCallback } from 'react';
import { 
  Search, 
  FileText, 
  Calendar, 
  User, 
  Download, 
  Trash2, 
  Edit3, 
  Save, 
  X, 
  Eye,
  Upload,
  Filter,
  SortAsc,
  SortDesc,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock
} from 'lucide-react';

// Document card component
const DocumentCard = ({ 
  document, 
  onView, 
  onEdit, 
  onDelete, 
  onDownload,
  isEditing,
  editingSummary,
  onSaveEdit,
  onCancelEdit,
  onSummaryChange
}) => {
  const [showFullSummary, setShowFullSummary] = useState(false);
  
  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'Invalid date';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'indexed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'processing':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'indexed':
        return 'Ready';
      case 'processing':
        return 'Processing';
      case 'error':
        return 'Error';
      default:
        return 'Unknown';
    }
  };

  const summary = document.manualSummary || document.summary || 'No summary available';
  const displaySummary = showFullSummary ? summary : summary.substring(0, 150);
  const shouldTruncate = summary.length > 150;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start space-x-3 flex-1 min-w-0">
          <FileText className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium text-gray-900 truncate" title={document.title || document.filename}>
              {document.title || document.filename}
            </h3>
            <div className="flex items-center space-x-2 mt-1">
              {getStatusIcon(document.status)}
              <span className="text-xs text-gray-500">{getStatusText(document.status)}</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center space-x-1 ml-2">
          <button
            onClick={() => onView?.(document)}
            className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
            title="View document"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            onClick={() => onEdit?.(document)}
            className="p-1 text-gray-400 hover:text-green-600 transition-colors"
            title="Edit summary"
          >
            <Edit3 className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDownload?.(document)}
            className="p-1 text-gray-400 hover:text-purple-600 transition-colors"
            title="Download document"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete?.(document)}
            className="p-1 text-gray-400 hover:text-red-600 transition-colors"
            title="Delete document"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Metadata */}
      <div className="flex items-center space-x-4 text-xs text-gray-500 mb-3">
        <div className="flex items-center space-x-1">
          <Calendar className="h-3 w-3" />
          <span>{formatDate(document.createdAt)}</span>
        </div>
        {document.uploadedBy && (
          <div className="flex items-center space-x-1">
            <User className="h-3 w-3" />
            <span>{document.uploadedBy}</span>
          </div>
        )}
        {document.fileSize && (
          <span>{(document.fileSize / 1024 / 1024).toFixed(1)} MB</span>
        )}
      </div>

      {/* Summary */}
      <div className="text-sm text-gray-700">
        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={editingSummary}
              onChange={(e) => onSummaryChange?.(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
              placeholder="Enter document summary..."
            />
            <div className="flex items-center space-x-2">
              <button
                onClick={() => onSaveEdit?.(document)}
                className="inline-flex items-center space-x-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
              >
                <Save className="h-3 w-3" />
                <span>Save</span>
              </button>
              <button
                onClick={() => onCancelEdit?.()}
                className="inline-flex items-center space-x-1 px-2 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
              >
                <X className="h-3 w-3" />
                <span>Cancel</span>
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-700 leading-relaxed">
              {displaySummary}
              {shouldTruncate && !showFullSummary && '...'}
            </p>
            {shouldTruncate && (
              <button
                onClick={() => setShowFullSummary(!showFullSummary)}
                className="text-xs text-blue-600 hover:text-blue-800 mt-1"
              >
                {showFullSummary ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tags */}
      {document.tags && document.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {document.tags.map((tag, index) => (
            <span
              key={index}
              className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// Main Document Manager component
const DocumentManager = ({ 
  onDocumentView, 
  onDocumentSelect,
  selectedDocuments = [],
  showSelectionMode = false 
}) => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editingDocument, setEditingDocument] = useState(null);
  const [editingSummary, setEditingSummary] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);

  // Load documents
  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/.netlify/functions/get-indexed-documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'x-user-id': localStorage.getItem('user_id')
        },
        body: JSON.stringify({
          action: 'list',
          search: searchTerm,
          sortBy,
          sortOrder,
          status: statusFilter !== 'all' ? statusFilter : undefined
        })
      });

      if (!response.ok) {
        throw new Error('Failed to load documents');
      }

      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (err) {
      console.error('Error loading documents:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, sortBy, sortOrder, statusFilter]);

  // Load documents on mount and when filters change
  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Handle document view
  const handleViewDocument = (document) => {
    onDocumentView?.(document);
  };

  // Handle document selection
  const handleSelectDocument = (document) => {
    if (showSelectionMode) {
      onDocumentSelect?.(document);
    }
  };

  // Handle document edit
  const handleEditDocument = (document) => {
    setEditingDocument(document);
    setEditingSummary(document.manualSummary || document.summary || '');
  };

  // Handle save edit
  const handleSaveEdit = async (document) => {
    setSavingSummary(true);
    try {
      const response = await fetch('/.netlify/functions/update-manual-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'x-user-id': localStorage.getItem('user_id')
        },
        body: JSON.stringify({
          action: 'update',
          documentId: document.id,
          manualSummary: editingSummary.trim()
        })
      });

      if (response.ok) {
        // Update local state
        setDocuments(prev => prev.map(doc => 
          doc.id === document.id 
            ? { ...doc, manualSummary: editingSummary.trim() }
            : doc
        ));
        setEditingDocument(null);
        setEditingSummary('');
      } else {
        throw new Error('Failed to save summary');
      }
    } catch (err) {
      console.error('Error saving summary:', err);
      alert('Failed to save summary. Please try again.');
    } finally {
      setSavingSummary(false);
    }
  };

  // Handle cancel edit
  const handleCancelEdit = () => {
    setEditingDocument(null);
    setEditingSummary('');
  };

  // Handle document delete
  const handleDeleteDocument = async (document) => {
    if (!confirm(`Are you sure you want to delete "${document.title || document.filename}"?`)) {
      return;
    }

    try {
      const response = await fetch('/.netlify/functions/rag-documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'x-user-id': localStorage.getItem('user_id')
        },
        body: JSON.stringify({
          action: 'delete',
          documentId: document.id
        })
      });

      if (response.ok) {
        // Remove from local state
        setDocuments(prev => prev.filter(doc => doc.id !== document.id));
      } else {
        throw new Error('Failed to delete document');
      }
    } catch (err) {
      console.error('Error deleting document:', err);
      alert('Failed to delete document. Please try again.');
    }
  };

  // Handle document download
  const handleDownloadDocument = async (document) => {
    try {
      const response = await fetch('/.netlify/functions/rag-documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'x-user-id': localStorage.getItem('user_id')
        },
        body: JSON.stringify({
          action: 'download',
          documentId: document.id
        })
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = document.filename || 'document';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        throw new Error('Failed to download document');
      }
    } catch (err) {
      console.error('Error downloading document:', err);
      alert('Failed to download document. Please try again.');
    }
  };

  // Filtered and sorted documents
  const filteredDocuments = documents.filter(doc => {
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      return (
        (doc.title || '').toLowerCase().includes(searchLower) ||
        (doc.filename || '').toLowerCase().includes(searchLower) ||
        (doc.summary || '').toLowerCase().includes(searchLower) ||
        (doc.manualSummary || '').toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  const sortedDocuments = [...filteredDocuments].sort((a, b) => {
    let aValue = a[sortBy];
    let bValue = b[sortBy];
    
    if (sortBy === 'createdAt') {
      aValue = new Date(aValue);
      bValue = new Date(bValue);
    }
    
    if (sortOrder === 'asc') {
      return aValue > bValue ? 1 : -1;
    } else {
      return aValue < bValue ? 1 : -1;
    }
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center space-x-2 text-gray-600">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>Loading documents...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Error Loading Documents</h3>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={loadDocuments}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Try Again</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Document Library</h2>
          <p className="text-gray-600 mt-1">
            {documents.length} document{documents.length !== 1 ? 's' : ''} indexed
          </p>
        </div>
        <button
          onClick={loadDocuments}
          className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filters and Search */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search documents..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Status Filter */}
          <div className="sm:w-48">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Status</option>
              <option value="indexed">Ready</option>
              <option value="processing">Processing</option>
              <option value="error">Error</option>
            </select>
          </div>

          {/* Sort */}
          <div className="sm:w-48">
            <select
              value={`${sortBy}-${sortOrder}`}
              onChange={(e) => {
                const [field, order] = e.target.value.split('-');
                setSortBy(field);
                setSortOrder(order);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="createdAt-desc">Newest First</option>
              <option value="createdAt-asc">Oldest First</option>
              <option value="title-asc">Title A-Z</option>
              <option value="title-desc">Title Z-A</option>
              <option value="filename-asc">Filename A-Z</option>
              <option value="filename-desc">Filename Z-A</option>
            </select>
          </div>
        </div>
      </div>

      {/* Documents Grid */}
      {sortedDocuments.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Documents Found</h3>
          <p className="text-gray-600">
            {searchTerm ? 'Try adjusting your search terms.' : 'Upload some documents to get started.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sortedDocuments.map((document) => (
            <DocumentCard
              key={document.id}
              document={document}
              onView={handleViewDocument}
              onEdit={handleEditDocument}
              onDelete={handleDeleteDocument}
              onDownload={handleDownloadDocument}
              isEditing={editingDocument?.id === document.id}
              editingSummary={editingSummary}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={handleCancelEdit}
              onSummaryChange={setEditingSummary}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default DocumentManager;
