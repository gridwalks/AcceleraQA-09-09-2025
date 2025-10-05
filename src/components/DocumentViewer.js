import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Download, 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  FileText, 
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2
} from 'lucide-react';

// PDF Viewer component
const PDFViewer = ({ document, onClose }) => {
  const [pdfData, setPdfData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [rotation, setRotation] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canvasRef = useRef(null);
  const pdfRef = useRef(null);

  useEffect(() => {
    loadPDF();
  }, [document]);

  const loadPDF = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Try to load PDF.js dynamically
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

      let pdfUrl;
      if (document.blobUrl) {
        pdfUrl = document.blobUrl;
      } else if (document.url) {
        pdfUrl = document.url;
      } else {
        // Fetch document content
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

        if (!response.ok) {
          throw new Error('Failed to load document');
        }

        const blob = await response.blob();
        pdfUrl = URL.createObjectURL(blob);
      }

      const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
      pdfRef.current = pdf;
      setTotalPages(pdf.numPages);
      setPdfData(pdf);
      setCurrentPage(1);
    } catch (err) {
      console.error('Error loading PDF:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const renderPage = async (pageNum) => {
    if (!pdfRef.current || !canvasRef.current) return;

    try {
      const page = await pdfRef.current.getPage(pageNum);
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      const viewport = page.getViewport({ scale, rotation });
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };

      await page.render(renderContext).promise;
    } catch (err) {
      console.error('Error rendering page:', err);
    }
  };

  useEffect(() => {
    if (pdfData && currentPage) {
      renderPage(currentPage);
    }
  }, [pdfData, currentPage, scale, rotation]);

  const handleZoomIn = () => {
    setScale(prev => Math.min(prev + 0.25, 3.0));
  };

  const handleZoomOut = () => {
    setScale(prev => Math.max(prev - 0.25, 0.5));
  };

  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  const handlePreviousPage = () => {
    setCurrentPage(prev => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(prev + 1, totalPages));
  };

  const handlePageInput = (e) => {
    const page = parseInt(e.target.value);
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const handleDownload = async () => {
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
        a.download = document.filename || 'document.pdf';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (err) {
      console.error('Error downloading document:', err);
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex items-center space-x-2 text-gray-600">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading PDF...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Error Loading PDF</h3>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${isFullscreen ? 'fixed inset-0 z-50' : ''} bg-white`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center space-x-4">
          <h3 className="text-lg font-medium text-gray-900 truncate">
            {document.title || document.filename}
          </h3>
          <div className="text-sm text-gray-500">
            Page {currentPage} of {totalPages}
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          {/* Navigation */}
          <button
            onClick={handlePreviousPage}
            disabled={currentPage <= 1}
            className="p-2 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          
          <input
            type="number"
            min="1"
            max={totalPages}
            value={currentPage}
            onChange={handlePageInput}
            className="w-16 px-2 py-1 text-sm border border-gray-300 rounded text-center"
          />
          
          <button
            onClick={handleNextPage}
            disabled={currentPage >= totalPages}
            className="p-2 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          
          <div className="w-px h-6 bg-gray-300 mx-2" />
          
          {/* Zoom Controls */}
          <button
            onClick={handleZoomOut}
            className="p-2 text-gray-600 hover:text-gray-900"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          
          <span className="text-sm text-gray-600 min-w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          
          <button
            onClick={handleZoomIn}
            className="p-2 text-gray-600 hover:text-gray-900"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          
          <div className="w-px h-6 bg-gray-300 mx-2" />
          
          {/* Rotate */}
          <button
            onClick={handleRotate}
            className="p-2 text-gray-600 hover:text-gray-900"
          >
            <RotateCw className="h-4 w-4" />
          </button>
          
          <div className="w-px h-6 bg-gray-300 mx-2" />
          
          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="p-2 text-gray-600 hover:text-gray-900"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          
          {/* Download */}
          <button
            onClick={handleDownload}
            className="p-2 text-gray-600 hover:text-gray-900"
          >
            <Download className="h-4 w-4" />
          </button>
          
          {/* Close */}
          <button
            onClick={onClose}
            className="p-2 text-gray-600 hover:text-gray-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      
      {/* PDF Canvas */}
      <div className="flex-1 overflow-auto bg-gray-100 p-4">
        <div className="flex justify-center">
          <canvas
            ref={canvasRef}
            className="shadow-lg border border-gray-300"
          />
        </div>
      </div>
    </div>
  );
};

// Text Viewer component
const TextViewer = ({ document, onClose }) => {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadContent();
  }, [document]);

  const loadContent = async () => {
    setLoading(true);
    setError(null);
    
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

      if (!response.ok) {
        throw new Error('Failed to load document content');
      }

      const text = await response.text();
      setContent(text);
    } catch (err) {
      console.error('Error loading text content:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
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
        a.download = document.filename || 'document.txt';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (err) {
      console.error('Error downloading document:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex items-center space-x-2 text-gray-600">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading document...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Error Loading Document</h3>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
        <h3 className="text-lg font-medium text-gray-900 truncate">
          {document.title || document.filename}
        </h3>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={handleDownload}
            className="p-2 text-gray-600 hover:text-gray-900"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            className="p-2 text-gray-600 hover:text-gray-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <pre className="whitespace-pre-wrap text-sm text-gray-900 font-mono leading-relaxed">
          {content}
        </pre>
      </div>
    </div>
  );
};

// Main Document Viewer component
const DocumentViewer = ({ document, onClose, isOpen = false }) => {
  if (!isOpen || !document) {
    return null;
  }

  const getFileType = (filename) => {
    if (!filename) return 'unknown';
    const extension = filename.split('.').pop().toLowerCase();
    return extension;
  };

  const fileType = getFileType(document.filename);
  const isPDF = fileType === 'pdf';
  const isTextFile = ['txt', 'md', 'csv', 'json', 'xml', 'html', 'css', 'js', 'ts', 'py', 'java', 'cpp', 'c', 'h'].includes(fileType);

  return (
    <div className="fixed inset-0 z-50 bg-white">
      {isPDF ? (
        <PDFViewer document={document} onClose={onClose} />
      ) : isTextFile ? (
        <TextViewer document={document} onClose={onClose} />
      ) : (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Unsupported File Type</h3>
            <p className="text-gray-600 mb-4">
              This file type ({fileType}) is not supported for viewing.
            </p>
            <div className="flex items-center justify-center space-x-4">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentViewer;
