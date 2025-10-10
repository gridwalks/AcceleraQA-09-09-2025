// src/components/AdminScreen.js - Comprehensive Admin Dashboard
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  ArrowLeft, 
  Users, 
  Database, 
  Activity, 
  Settings, 
  FileText, 
  BarChart3, 
  Shield, 
  AlertTriangle,
  CheckCircle,
  Clock,
  Download,
  Trash2,
  RefreshCw,
  Eye,
  Cloud,
  HardDrive,
  Zap,
  Bug,
  Monitor,
  Search,
  BookOpen,
  X
} from 'lucide-react';

// Import services
import neonService from '../services/neonService';
import ragService from '../services/ragService';
import { getToken, getTokenInfo } from '../services/authService';
import { hasAdminRole } from '../utils/auth';
import RAGConfigurationPage from './RAGConfigurationPage';
import TrainingResourcesAdmin from './TrainingResourcesAdmin';
import { getCurrentModel, getModelProvider, setModelProvider, getSystemPromptOverride, setSystemPromptOverride, clearSystemPromptOverride } from '../config/modelConfig';
import { OPENAI_CONFIG } from '../config/constants';
import { getTokenUsageStats } from '../utils/tokenUsage';
import { getRagBackendLabel, isNeonBackend } from '../config/ragConfig';
import blobAdminService from '../services/blobAdminService';

export const checkStorageHealth = async () => {
  // Check browser storage capacity
  try {
    if (typeof navigator === 'undefined' || !navigator.storage) {
      return {
        status: 'unknown',
        message: 'Storage info unavailable',
        quota: null
      };
    }

    const usage = await navigator.storage.estimate();
    const usagePercent = (usage.usage / usage.quota * 100).toFixed(1);

    return {
      status: usage.usage / usage.quota < 0.8 ? 'healthy' : 'warning',
      message: `Storage ${usagePercent}% used`,
      quota: `${(usage.quota / 1024 / 1024).toFixed(0)}MB`
    };
  } catch (error) {
    return {
      status: 'unknown',
      message: 'Storage info unavailable',
      quota: null
    };
  }
};

const formatBytes = (bytes) => {
  if (bytes === 0) {
    return '0 B';
  }

  if (!Number.isFinite(bytes) || bytes == null || bytes < 0) {
    return '—';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  const decimals = value >= 10 || exponent === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[exponent]}`;
};

const formatDateTime = (value) => {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
};

const formatMetadataValue = (value) => {
  if (value === null || value === undefined) {
    return '—';
  }

  if (typeof value === 'object') {
    try {
      const stringified = JSON.stringify(value);
      return stringified.length > 60 ? `${stringified.slice(0, 57)}…` : stringified;
    } catch (error) {
      console.warn('Failed to stringify metadata value for preview:', error);
      return '[object]';
    }
  }

  const text = String(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
};

const AdminScreen = ({ user, onBack }) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [isLoading, setIsLoading] = useState(false);
  const [systemStats, setSystemStats] = useState(null);
  const [ragStats, setRAGStats] = useState(null);
  const [authStats, setAuthStats] = useState(null);
  const [systemHealth, setSystemHealth] = useState(null);
  const [error, setError] = useState(null);
  const [chatModel] = useState(getCurrentModel());
  const [tokenUsage, setTokenUsage] = useState({ daily: [], monthly: [] });
  const [blobFiles, setBlobFiles] = useState([]);
  const [blobMetadata, setBlobMetadata] = useState({ store: '', prefix: '', timestamp: null, total: null, truncated: false });
  const [blobError, setBlobError] = useState(null);
  const [isBlobLoading, setIsBlobLoading] = useState(false);
  const [hasLoadedBlobInventory, setHasLoadedBlobInventory] = useState(false);
  const [blobPrefixInput, setBlobPrefixInput] = useState('');
  const [appliedBlobPrefix, setAppliedBlobPrefix] = useState('');
  const [blobSearchTerm, setBlobSearchTerm] = useState('');
  const [blobSort, setBlobSort] = useState('newest');
  const [downloadingBlobKeys, setDownloadingBlobKeys] = useState(() => new Set());
  const [blobPreview, setBlobPreview] = useState(null);
  const ragBackendLabel = getRagBackendLabel();
  const neonBackendEnabled = isNeonBackend();

  // Check if user has admin role
  const isAdmin = hasAdminRole(user);

  const releasePreviewObjectUrl = useCallback((objectUrl) => {
    if (!objectUrl) {
      return;
    }

    if (typeof window !== 'undefined' && typeof window.URL?.revokeObjectURL === 'function') {
      window.URL.revokeObjectURL(objectUrl);
    }
  }, []);

  const closeBlobPreview = useCallback(() => {
    setBlobPreview((previous) => {
      if (previous?.objectUrl) {
        releasePreviewObjectUrl(previous.objectUrl);
      }
      return null;
    });
  }, [releasePreviewObjectUrl]);

  useEffect(() => {
    return () => {
      if (blobPreview?.objectUrl) {
        releasePreviewObjectUrl(blobPreview.objectUrl);
      }
    };
  }, [blobPreview, releasePreviewObjectUrl]);

  useEffect(() => {
    if (!blobPreview) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeBlobPreview();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', handleKeyDown);
      }
    };
  }, [blobPreview, closeBlobPreview]);

  const renderMetadataPreview = useCallback((metadata) => {
    if (!metadata || typeof metadata !== 'object' || Object.keys(metadata).length === 0) {
      return <span className="text-gray-400">No metadata</span>;
    }

    const entries = Object.entries(metadata);
    const visibleEntries = entries.slice(0, 4);

    return (
      <div className="flex flex-wrap gap-1">
        {visibleEntries.map(([key, value]) => (
          <span
            key={key}
            className="px-2 py-0.5 bg-gray-100 border border-gray-200 rounded text-gray-700"
          >
            <span className="font-medium text-gray-800">{key}</span>: {formatMetadataValue(value)}
          </span>
        ))}
        {entries.length > 4 && (
          <span className="px-2 py-0.5 bg-gray-50 border border-dashed border-gray-200 rounded text-gray-500">
            +{entries.length - 4} more
          </span>
        )}
      </div>
    );
  }, []);

  const loadAdminData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [stats, ragData, health, auth] = await Promise.allSettled([
        getSystemStats(),
        getRAGStats(),
        getSystemHealth(),
        getAuthStats()
      ]);

      if (stats.status === 'fulfilled') setSystemStats(stats.value);
      if (ragData.status === 'fulfilled') setRAGStats(ragData.value);
      if (health.status === 'fulfilled') setSystemHealth(health.value);
      if (auth.status === 'fulfilled') setAuthStats(auth.value);
      setTokenUsage(getTokenUsageStats());

      // Log any failures
      [stats, ragData, health, auth].forEach((result, index) => {
        if (result.status === 'rejected') {
          console.warn(`Admin data load failed for index ${index}:`, result.reason);
        }
      });

    } catch (error) {
      console.error('Error loading admin data:', error);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // System statistics
  const getSystemStats = async () => {
    try {
      const [conversationStats, ragStats] = await Promise.all([
        neonService.getConversationStats(),
        ragService.getStats(user?.sub)
      ]);

      return {
        conversations: conversationStats,
        rag: ragStats,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting system stats:', error);
      return {
        conversations: { totalConversations: 0, totalMessages: 0, ragConversations: 0 },
        rag: { totalDocuments: 0, totalChunks: 0 },
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  };

  // RAG system statistics
  const getRAGStats = async () => {
    try {
      const diagnostics = await ragService.runDiagnostics(user?.sub);
      return {
        ...diagnostics,
        lastCheck: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting RAG stats:', error);
      return {
        health: { score: 0, status: 'error', error: error.message },
        lastCheck: new Date().toISOString()
      };
    }
  };

  // Authentication statistics
  const getAuthStats = async () => {
    try {
      const tokenInfo = getTokenInfo();
      const token = await getToken();

      return {
        tokenInfo,
        hasValidToken: !!token,
        tokenLength: token?.length || 0,
        checkTime: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting auth stats:', error);
      return {
        hasValidToken: false,
        error: error.message,
        checkTime: new Date().toISOString()
      };
    }
  };

  const loadBlobInventory = useCallback(
    async (overridePrefix) => {
      if (!isAdmin) {
        return;
      }

      const sanitizedOverride =
        typeof overridePrefix === 'string'
          ? overridePrefix.trim().replace(/^\/+|\/+$/g, '')
          : null;

      const prefixToUse = sanitizedOverride !== null ? sanitizedOverride : appliedBlobPrefix;

      if (sanitizedOverride !== null && sanitizedOverride !== appliedBlobPrefix) {
        setAppliedBlobPrefix(sanitizedOverride);
      }

      setBlobError(null);
      setIsBlobLoading(true);

      try {
        const response = await blobAdminService.listBlobs({
          user,
          prefix: prefixToUse || undefined,
        });

        const normalized = Array.isArray(response?.blobs)
          ? response.blobs.map((blob) => ({
              key: blob.key,
              relativeKey: blob.relativeKey || blob.key,
              userId: blob.userId || null,
              documentId: blob.documentId || null,
              filename: blob.filename || null,
              size:
                typeof blob.size === 'number' && Number.isFinite(blob.size)
                  ? Number(blob.size)
                  : null,
              contentType: typeof blob.contentType === 'string' ? blob.contentType : null,
              uploadedAt: typeof blob.uploadedAt === 'string' ? blob.uploadedAt : null,
              etag: blob.etag || null,
              metadata:
                blob.metadata && typeof blob.metadata === 'object' ? blob.metadata : {},
              segments: Array.isArray(blob.segments) ? blob.segments : [],
            }))
          : [];

        setBlobFiles(normalized);
        setBlobMetadata({
          store: response?.store || '',
          prefix: response?.prefix || prefixToUse || '',
          timestamp: response?.timestamp || new Date().toISOString(),
          total: typeof response?.total === 'number' ? response.total : normalized.length,
          truncated: Boolean(response?.truncated),
        });
        setHasLoadedBlobInventory(true);
      } catch (inventoryError) {
        console.error('Failed to load Netlify blobs:', inventoryError);
        setBlobError(inventoryError.message || 'Failed to load Netlify blob inventory.');
        setHasLoadedBlobInventory(false);
      } finally {
        setIsBlobLoading(false);
      }
    },
    [appliedBlobPrefix, isAdmin, user]
  );

  useEffect(() => {
    if (isAdmin) {
      loadAdminData();
    }
  }, [isAdmin, loadAdminData]);

  useEffect(() => {
    if (activeTab === 'blobStorage' && isAdmin && !hasLoadedBlobInventory && !isBlobLoading) {
      loadBlobInventory();
    }
  }, [activeTab, hasLoadedBlobInventory, isAdmin, isBlobLoading, loadBlobInventory]);

  // System health check
  const getSystemHealth = async () => {
    try {
      const checks = {
        backend: await checkBackendHealth(),
        rag: await checkRAGHealth(),
        authentication: await checkAuthHealth(),
        storage: await checkStorageHealth()
      };

      const allHealthy = Object.values(checks).every(check => check.status === 'healthy');
      
      return {
        overall: allHealthy ? 'healthy' : 'degraded',
        checks,
        lastCheck: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error checking system health:', error);
      return {
        overall: 'error',
        error: error.message,
        lastCheck: new Date().toISOString()
      };
    }
  };

  const checkBackendHealth = async () => {
    try {
      const result = await neonService.isServiceAvailable();
      if (result.ok) {
        return {
          status: 'healthy',
          message: 'OpenAI backend reachable',
          responseTime: '< 100ms' // Placeholder
        };
      }

      return {
        status: 'unhealthy',
        message: result.error || 'OpenAI backend unavailable',
        responseTime: null
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        responseTime: null
      };
    }
  };

  const checkRAGHealth = async () => {
    try {
      const testResult = await ragService.testConnection(user?.sub);
      return {
        status: testResult.success ? 'healthy' : 'unhealthy',
        message: testResult.success ? 'RAG system operational' : `RAG error: ${testResult.error}`,
        features: testResult.data?.mode || 'unknown'
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        features: null
      };
    }
  };

  const checkAuthHealth = async () => {
    try {
      const token = await getToken();
      const tokenInfo = getTokenInfo();
      
      return {
        status: token && !tokenInfo.isExpired ? 'healthy' : 'warning',
        message: token ? 'Authentication active' : 'No active token',
        expiresIn: tokenInfo.timeUntilExpiry ? `${Math.round(tokenInfo.timeUntilExpiry / 60)} minutes` : 'Unknown'
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        expiresIn: null
      };
    }
  };

  // Refresh data
  const handleRefresh = () => {
    loadAdminData();
    if (activeTab === 'blobStorage') {
      loadBlobInventory();
    }
  };

  // Export system data
  const handleExportData = async () => {
    try {
      const exportData = {
        timestamp: new Date().toISOString(),
        systemStats,
        ragStats,
        authStats,
        systemHealth,
        exportedBy: user.email || user.name || 'Admin'
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `acceleraqa-admin-export-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  const handleBlobPrefixSubmit = useCallback(
    (event) => {
      event.preventDefault();
      const sanitized = blobPrefixInput.trim().replace(/^\/+|\/+$/g, '');
      setBlobPrefixInput(sanitized);
      loadBlobInventory(sanitized);
    },
    [blobPrefixInput, loadBlobInventory]
  );

  const handleBlobPrefixReset = useCallback(() => {
    if (!blobPrefixInput && !appliedBlobPrefix) {
      return;
    }
    setBlobPrefixInput('');
    loadBlobInventory('');
  }, [appliedBlobPrefix, blobPrefixInput, loadBlobInventory]);

  const markBlobDownloading = useCallback(
    (key, isDownloading) => {
      if (!key) {
        return;
      }

      setDownloadingBlobKeys((previous) => {
        const next = new Set(previous);
        if (isDownloading) {
          next.add(key);
        } else {
          next.delete(key);
        }
        return next;
      });
    },
    [setDownloadingBlobKeys]
  );

  const openBlobPreviewInNewTab = useCallback(() => {
    if (!blobPreview?.objectUrl) {
      return;
    }

    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(blobPreview.objectUrl, '_blank', 'noopener,noreferrer');
    }
  }, [blobPreview]);

  const handleBlobView = useCallback(
    async (file) => {
      if (!file?.key) {
        setBlobError('Unable to view file: missing blob key.');
        return;
      }

      if (
        typeof window === 'undefined' ||
        typeof window.URL?.createObjectURL !== 'function' ||
        typeof document === 'undefined'
      ) {
        setBlobError('File downloads are not supported in this environment.');
        return;
      }

      const blobKey = file.key;
      markBlobDownloading(blobKey, true);
      setBlobError(null);

      try {
        // Use user blob access instead of admin service
        const userBlobUrl = `/.netlify/functions/user-blob-access?key=${encodeURIComponent(blobKey)}`;
        
        // Get authentication token and user ID
        const token = await getToken();
        const tokenInfo = getTokenInfo();
        const userId = tokenInfo?.sub || user?.sub;
        
        const headers = {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-user-id': userId,
        };
        
        const response = await fetch(userBlobUrl, { 
          credentials: 'include',
          headers
        });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch blob: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();

        if (result.encoding && result.encoding !== 'base64') {
          throw new Error(`Unsupported blob encoding: ${result.encoding}`);
        }

        const base64Data = result.data;
        if (typeof base64Data !== 'string' || !base64Data) {
          throw new Error('Received an empty blob payload.');
        }

        let binaryString;
        if (typeof window !== 'undefined' && typeof window.atob === 'function') {
          binaryString = window.atob(base64Data);
        } else if (typeof atob === 'function') {
          binaryString = atob(base64Data);
        } else if (typeof Buffer !== 'undefined') {
          binaryString = Buffer.from(base64Data, 'base64').toString('binary');
        } else {
          throw new Error('Base64 decoding is not supported in this environment.');
        }

        const byteLength = binaryString.length;
        const bytes = new Uint8Array(byteLength);
        for (let index = 0; index < byteLength; index += 1) {
          bytes[index] = binaryString.charCodeAt(index);
        }

        const contentType = result.contentType || file.contentType || 'application/octet-stream';
        const blob = new Blob([bytes], { type: contentType });
        const objectUrl = window.URL.createObjectURL(blob);
        const downloadName =
          result.filename ||
          file.filename ||
          result.relativeKey ||
          file.relativeKey ||
          blobKey.split('/').pop() ||
          'download';
        console.log('Setting blob preview:', {
          objectUrl,
          filename: downloadName,
          contentType,
          size: Number.isFinite(file?.size) ? file.size : bytes.length,
          key: blobKey
        });
        
        setBlobPreview((previous) => {
          if (previous?.objectUrl) {
            releasePreviewObjectUrl(previous.objectUrl);
          }

          return {
            objectUrl,
            filename: downloadName,
            contentType,
            size: Number.isFinite(file?.size) ? file.size : bytes.length,
            key: blobKey,
            downloadedAt: new Date().toISOString(),
          };
        });
      } catch (error) {
        console.error('Failed to load blob file for viewing:', error);
        setBlobError(error.message || 'Failed to load file from Netlify blobs.');
      } finally {
        markBlobDownloading(blobKey, false);
      }
    },
    [markBlobDownloading, releasePreviewObjectUrl, setBlobError]
  );

  // Test system components
  const runSystemTests = async () => {
    setIsLoading(true);
    try {
      const testResults = await Promise.allSettled([
        ragService.testUpload(user?.sub),
        ragService.testSearch(user?.sub)
      ]);

      const results = {
        ragUpload: testResults[0],
        ragSearch: testResults[1],
        timestamp: new Date().toISOString()
      };

      console.log('System test results:', results);
      alert('System tests completed. Check console for detailed results.');
    } catch (error) {
      console.error('System tests failed:', error);
      alert(`System tests failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredBlobFiles = useMemo(() => {
    const search = blobSearchTerm.trim().toLowerCase();
    const files = Array.isArray(blobFiles) ? [...blobFiles] : [];

    const getTime = (value) => {
      if (!value) return 0;
      const timestamp = new Date(value).getTime();
      return Number.isNaN(timestamp) ? 0 : timestamp;
    };

    const sizeForLargest = (value) =>
      Number.isFinite(value) && value >= 0 ? value : -1;

    const sizeForSmallest = (value) =>
      Number.isFinite(value) && value >= 0 ? value : Number.MAX_SAFE_INTEGER;

    let result = files;

    if (search) {
      result = result.filter((file) => {
        const searchTargets = [
          file.key,
          file.relativeKey,
          file.userId,
          file.documentId,
          file.filename,
          file.contentType,
          file.etag,
        ]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase());

        if (searchTargets.some((value) => value.includes(search))) {
          return true;
        }

        if (file.metadata && typeof file.metadata === 'object') {
          return Object.entries(file.metadata).some(([key, value]) => {
            if (String(key).toLowerCase().includes(search)) {
              return true;
            }

            if (value === null || value === undefined) {
              return false;
            }

            const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
            return text.toLowerCase().includes(search);
          });
        }

        return false;
      });
    }

    const sorted = [...result];
    sorted.sort((a, b) => {
      switch (blobSort) {
        case 'oldest':
          return getTime(a.uploadedAt) - getTime(b.uploadedAt);
        case 'largest':
          return sizeForLargest(b.size) - sizeForLargest(a.size);
        case 'smallest':
          return sizeForSmallest(a.size) - sizeForSmallest(b.size);
        case 'alphabetical':
          return (a.relativeKey || a.key || '').localeCompare(
            b.relativeKey || b.key || '',
            undefined,
            { sensitivity: 'base' }
          );
        case 'newest':
        default:
          return getTime(b.uploadedAt) - getTime(a.uploadedAt);
      }
    });

    return sorted;
  }, [blobFiles, blobSearchTerm, blobSort]);

  const totalBlobSize = useMemo(
    () =>
      blobFiles.reduce(
        (sum, file) =>
          Number.isFinite(file?.size) && file.size >= 0 ? sum + Number(file.size) : sum,
        0
      ),
    [blobFiles]
  );

  const uniqueBlobUsers = useMemo(() => {
    const ids = new Set();
    blobFiles.forEach((file) => {
      if (file?.userId) {
        ids.add(file.userId);
      }
    });
    return ids.size;
  }, [blobFiles]);

  const uniqueBlobDocuments = useMemo(() => {
    const ids = new Set();
    blobFiles.forEach((file) => {
      if (file?.documentId) {
        ids.add(file.documentId);
      }
    });
    return ids.size;
  }, [blobFiles]);

  const displayedBlobCount = filteredBlobFiles.length;
  const blobStoreName = blobMetadata?.store || 'rag-documents';
  const blobPrefixDisplay = blobMetadata?.prefix || (appliedBlobPrefix || '');
  const blobLastUpdated = blobMetadata?.timestamp;
  const blobTotalCount = typeof blobMetadata?.total === 'number' ? blobMetadata.total : blobFiles.length;
  const blobInventoryTruncated = Boolean(blobMetadata?.truncated);

  // Don't render if user is not admin
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <Shield className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600 mb-6">
            You need administrator privileges to access this area.
          </p>
          <button
            onClick={onBack}
            className="px-6 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
          >
            Return to App
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={onBack}
                className="flex items-center space-x-2 px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to App</span>
              </button>
              <div className="h-6 w-px bg-gray-300" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center space-x-2">
                  <Shield className="h-6 w-6 text-blue-600" />
                  <span>Admin Dashboard</span>
                </h1>
                <p className="text-sm text-gray-500">AcceleraQA System Administration</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <button
                onClick={handleRefresh}
                disabled={isLoading}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
              
              <button
                onClick={handleExportData}
                className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
              >
                <Download className="h-4 w-4" />
                <span>Export</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Admin User Info */}
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-center space-x-3">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-sm text-blue-800">
              Logged in as <strong>{user.email || user.name}</strong> with Administrator privileges
            </span>
            <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
              Admin Session Active
            </span>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-start space-x-3">
              <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-medium text-red-800">Error Loading Admin Data</h3>
                <p className="text-red-700 text-sm mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex space-x-8">
            {[
              { id: 'overview', label: 'Overview', icon: Monitor },
              { id: 'users', label: 'Users & Auth', icon: Users },
              { id: 'backend', label: 'Backend', icon: Database },
              { id: 'rag', label: 'RAG System', icon: FileText },
              { id: 'blobStorage', label: 'Netlify Blobs', icon: Cloud },
              { id: 'ragConfig', label: 'My Resources', icon: Search },
              { id: 'aiModel', label: 'AI Model', icon: Zap },
              { id: 'system', label: 'System Health', icon: Activity },
              { id: 'usage', label: 'Token Usage', icon: BarChart3 },
              { id: 'training', label: 'External Resources', icon: BookOpen },
              { id: 'tools', label: 'Admin Tools', icon: Settings }
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="space-y-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* System Health Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <SystemHealthCard
                  title="Backend"
                  status={systemHealth?.checks?.backend?.status || 'unknown'}
                  message={systemHealth?.checks?.backend?.message || 'Checking...'}
                  icon={Database}
                />
                <SystemHealthCard
                  title="RAG System"
                  status={systemHealth?.checks?.rag?.status || 'unknown'}
                  message={systemHealth?.checks?.rag?.message || 'Checking...'}
                  icon={FileText}
                />
                <SystemHealthCard
                  title="Authentication"
                  status={systemHealth?.checks?.authentication?.status || 'unknown'}
                  message={systemHealth?.checks?.authentication?.message || 'Checking...'}
                  icon={Shield}
                />
                <SystemHealthCard
                  title="Storage"
                  status={systemHealth?.checks?.storage?.status || 'unknown'}
                  message={systemHealth?.checks?.storage?.message || 'Checking...'}
                  icon={HardDrive}
                />
              </div>

              {/* System Statistics */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-lg shadow p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                    <BarChart3 className="h-5 w-5 mr-2 text-blue-600" />
                    System Statistics
                  </h3>
                  <div className="space-y-4">
                    <StatItem
                      label="Total Conversations"
                      value={systemStats?.conversations?.totalConversations || 0}
                      description="Across all users"
                    />
                    <StatItem
                      label="Total Messages"
                      value={systemStats?.conversations?.totalMessages || 0}
                      description="User and AI responses"
                    />
                    <StatItem
                      label="RAG Usage"
                      value={`${systemStats?.conversations?.ragUsagePercentage || 0}%`}
                      description="Conversations using document search"
                    />
                    <StatItem
                      label="Documents Uploaded"
                      value={systemStats?.rag?.totalDocuments || 0}
                      description="Across all users"
                    />
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                    <Activity className="h-5 w-5 mr-2 text-green-600" />
                    System Performance
                  </h3>
                  <div className="space-y-4">
                    <StatItem
                      label="RAG Health Score"
                      value={`${ragStats?.health?.score || 0}%`}
                      description={ragStats?.health?.status || 'Unknown'}
                      status={ragStats?.health?.score >= 80 ? 'good' : ragStats?.health?.score >= 50 ? 'warning' : 'error'}
                    />
                    <StatItem
                      label="Backend Status"
                      value={systemHealth?.checks?.backend?.status || 'Unknown'}
                      description={systemHealth?.checks?.backend?.responseTime || 'Checking...'}
                      status={systemHealth?.checks?.backend?.status === 'healthy' ? 'good' : 'warning'}
                    />
                    <StatItem
                      label="Auth Token"
                      value={authStats?.hasValidToken ? 'Valid' : 'Invalid'}
                      description={authStats?.tokenInfo?.timeUntilExpiry ? `Expires in ${Math.round(authStats.tokenInfo.timeUntilExpiry / 60)}m` : 'No expiry info'}
                      status={authStats?.hasValidToken ? 'good' : 'error'}
                    />
                    <StatItem
                      label="Last Health Check"
                      value={systemHealth?.lastCheck ? new Date(systemHealth.lastCheck).toLocaleTimeString() : 'Never'}
                      description="Automatic system monitoring"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Users & Auth Tab */}
          {activeTab === 'users' && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Authentication Status</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <h4 className="font-medium text-gray-900">Current Session</h4>
                      <div className="mt-2 space-y-2 text-sm">
                        <div>User: <span className="font-mono">{user.sub}</span></div>
                        <div>Email: <span className="font-mono">{user.email}</span></div>
                        <div>Roles: <span className="font-mono">{user.roles?.join(', ') || 'None'}</span></div>
                      </div>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <h4 className="font-medium text-gray-900">Token Information</h4>
                      <div className="mt-2 space-y-2 text-sm">
                        <div>Valid: <span className={authStats?.hasValidToken ? 'text-green-600' : 'text-red-600'}>{authStats?.hasValidToken ? 'Yes' : 'No'}</span></div>
                        <div>Length: {authStats?.tokenLength || 0} characters</div>
                        <div>Cached: <span className={authStats?.tokenInfo?.hasCachedToken ? 'text-green-600' : 'text-gray-600'}>{authStats?.tokenInfo?.hasCachedToken ? 'Yes' : 'No'}</span></div>
                        <div>Expires: {authStats?.tokenInfo?.timeUntilExpiry ? `${Math.round(authStats.tokenInfo.timeUntilExpiry / 60)} minutes` : 'Unknown'}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Backend Tab */}
          {activeTab === 'backend' && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">RAG Backend ({ragBackendLabel})</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 bg-blue-50 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-blue-900">Conversations</h4>
                          <p className="text-2xl font-bold text-blue-600">{systemStats?.conversations?.totalConversations || 0}</p>
                        </div>
                        <Database className="h-8 w-8 text-blue-500" />
                      </div>
                    </div>
                    <div className="p-4 bg-green-50 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-green-900">Messages</h4>
                          <p className="text-2xl font-bold text-green-600">{systemStats?.conversations?.totalMessages || 0}</p>
                        </div>
                        <FileText className="h-8 w-8 text-green-500" />
                      </div>
                    </div>
                    <div className="p-4 bg-purple-50 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-purple-900">RAG Conversations</h4>
                          <p className="text-2xl font-bold text-purple-600">{systemStats?.conversations?.ragConversations || 0}</p>
                        </div>
                        <Zap className="h-8 w-8 text-purple-500" />
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <h4 className="font-medium text-gray-900 mb-2">Backend Health</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Connection Status:</span>
                        <span className={`font-medium ${systemHealth?.checks?.backend?.status === 'healthy' ? 'text-green-600' : 'text-red-600'}`}>
                          {systemHealth?.checks?.backend?.status || 'Unknown'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Response Time:</span>
                        <span className="font-medium">{systemHealth?.checks?.backend?.responseTime || 'Unknown'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Last Check:</span>
                        <span className="font-medium">{systemHealth?.lastCheck ? new Date(systemHealth.lastCheck).toLocaleString() : 'Never'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* RAG System Tab */}
          {activeTab === 'rag' && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">RAG System Status</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <h4 className="font-medium text-gray-900 mb-3">System Health</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span>Health Score:</span>
                          <span className="font-bold text-lg">{ragStats?.health?.score || 0}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Status:</span>
                          <span className={`font-medium ${
                            ragStats?.health?.status === 'healthy' ? 'text-green-600' : 
                            ragStats?.health?.status === 'partial' ? 'text-yellow-600' : 'text-red-600'
                          }`}>
                            {ragStats?.health?.status || 'Unknown'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Mode:</span>
                          <span className="font-medium">{ragStats?.mode || 'Unknown'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Backend:</span>
                          <span className="font-medium">{ragBackendLabel}</span>
                        </div>
                        {neonBackendEnabled && (
                          <div className="flex justify-between">
                            <span>Storage:</span>
                            <span className="font-medium">Neon PostgreSQL</span>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <h4 className="font-medium text-gray-900 mb-3">Features</h4>
                      <div className="space-y-1 text-sm">
                        {ragStats?.health?.features ? Object.entries(ragStats.health.features).map(([feature, enabled]) => (
                          <div key={feature} className="flex items-center justify-between">
                            <span className="capitalize">{feature.replace(/([A-Z])/g, ' $1').toLowerCase()}:</span>
                            <span className={`font-medium ${enabled ? 'text-green-600' : 'text-gray-400'}`}>
                              {enabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                        )) : (
                          <div className="text-gray-500">Feature information unavailable</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {ragStats?.health?.recommendations && ragStats.health.recommendations.length > 0 && (
                    <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <h4 className="font-medium text-yellow-900 mb-2">Recommendations</h4>
                      <ul className="space-y-1 text-sm text-yellow-800">
                        {ragStats.health.recommendations.map((rec, index) => (
                          <li key={index}>• {rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* My Resources Tab */}
          {activeTab === 'ragConfig' && (
            <div className="space-y-6">
              <RAGConfigurationPage user={user} onClose={() => setActiveTab('overview')} />
            </div>
          )}

          {/* AI Model Tab */}
          {activeTab === 'aiModel' && (
            <div className="space-y-6">
              <AIModelConfiguration user={user} />
            </div>
          )}

          {/* Netlify Blob Storage Tab */}
          {activeTab === 'blobStorage' && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                      <Cloud className="h-5 w-5 text-blue-600 mr-2" />
                      Netlify Blob Storage
                    </h3>
                    <p className="text-sm text-gray-600">
                      Store <span className="font-medium text-gray-900">{blobStoreName}</span>
                      {blobPrefixDisplay && (
                        <>
                          {' '}• Prefix{' '}
                          <code className="text-xs bg-gray-100 border border-gray-200 px-1 py-0.5 rounded">
                            {blobPrefixDisplay}
                          </code>
                        </>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Last refreshed {formatDateTime(blobLastUpdated)} • Showing {displayedBlobCount}
                      {blobTotalCount != null && ` of ${blobTotalCount}`} files
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => loadBlobInventory(appliedBlobPrefix)}
                      disabled={isBlobLoading}
                      className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      <RefreshCw className={`h-4 w-4 ${isBlobLoading ? 'animate-spin' : ''}`} />
                      <span>Refresh</span>
                    </button>
                  </div>
                </div>

                {blobError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                    <div className="flex items-start space-x-3">
                      <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-medium text-red-800">Unable to load Netlify blobs</h4>
                        <p className="text-sm text-red-700 mt-1">{blobError}</p>
                      </div>
                    </div>
                  </div>
                )}

                <form
                  onSubmit={handleBlobPrefixSubmit}
                  className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6"
                >
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Prefix filter
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={blobPrefixInput}
                        onChange={(event) => setBlobPrefixInput(event.target.value)}
                        placeholder="rag-documents/user-id"
                        className="flex-1 rounded border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                      <button
                        type="submit"
                        className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        onClick={handleBlobPrefixReset}
                        className="px-3 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                        disabled={!blobPrefixInput && !appliedBlobPrefix}
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Search
                    </label>
                    <input
                      type="text"
                      value={blobSearchTerm}
                      onChange={(event) => setBlobSearchTerm(event.target.value)}
                      placeholder="Filter by key, user, metadata..."
                      className="w-full rounded border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Sort by
                    </label>
                    <select
                      value={blobSort}
                      onChange={(event) => setBlobSort(event.target.value)}
                      className="w-full rounded border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                      <option value="largest">Largest size</option>
                      <option value="smallest">Smallest size</option>
                      <option value="alphabetical">Alphabetical</option>
                    </select>
                  </div>
                </form>

                <div className="flex flex-wrap gap-4 text-sm text-gray-600 mb-4">
                  <span>
                    <span className="font-semibold text-gray-900">{blobFiles.length}</span> files loaded
                  </span>
                  <span>
                    <span className="font-semibold text-gray-900">{formatBytes(totalBlobSize)}</span> total size
                  </span>
                  <span>
                    <span className="font-semibold text-gray-900">{uniqueBlobUsers}</span> unique users
                  </span>
                  <span>
                    <span className="font-semibold text-gray-900">{uniqueBlobDocuments}</span> unique documents
                  </span>
                  {blobInventoryTruncated && (
                    <span className="text-yellow-600">
                      Displaying first {displayedBlobCount} entries. Narrow the prefix to load more.
                    </span>
                  )}
                </div>

                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left font-semibold text-gray-600">Blob Key</th>
                          <th className="px-4 py-2 text-left font-semibold text-gray-600">Size</th>
                          <th className="px-4 py-2 text-left font-semibold text-gray-600">Content Type</th>
                          <th className="px-4 py-2 text-left font-semibold text-gray-600">Uploaded</th>
                          <th className="px-4 py-2 text-left font-semibold text-gray-600">Metadata</th>
                          <th className="px-4 py-2 text-left font-semibold text-gray-600">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {isBlobLoading && filteredBlobFiles.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                              <RefreshCw className="h-5 w-5 inline-block animate-spin mr-2" />
                              Loading Netlify blob inventory…
                            </td>
                          </tr>
                        ) : filteredBlobFiles.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                              No blob files found for the selected filters.
                            </td>
                          </tr>
                        ) : (
                          filteredBlobFiles.map((file) => (
                            <tr key={file.key} className="hover:bg-gray-50">
                              <td className="px-4 py-3 align-top">
                                <div className="font-medium text-gray-900 break-all">
                                  {file.relativeKey || file.key}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                                  {file.userId && (
                                    <span className="px-2 py-0.5 bg-gray-100 border border-gray-200 rounded">
                                      User: {file.userId}
                                    </span>
                                  )}
                                  {file.documentId && (
                                    <span className="px-2 py-0.5 bg-gray-100 border border-gray-200 rounded">
                                      Doc: {file.documentId}
                                    </span>
                                  )}
                                  {file.filename && (
                                    <span className="px-2 py-0.5 bg-gray-100 border border-gray-200 rounded">
                                      File: {file.filename}
                                    </span>
                                  )}
                                  {file.etag && (
                                    <span className="px-2 py-0.5 bg-gray-100 border border-gray-200 rounded">
                                      ETag: {file.etag.slice(0, 10)}{file.etag.length > 10 ? '…' : ''}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 align-top text-gray-900">{formatBytes(file.size)}</td>
                              <td className="px-4 py-3 align-top text-gray-600">{file.contentType || '—'}</td>
                              <td className="px-4 py-3 align-top text-gray-600">{formatDateTime(file.uploadedAt)}</td>
                              <td className="px-4 py-3 align-top text-xs text-gray-600">
                                {renderMetadataPreview(file.metadata)}
                              </td>
                              <td className="px-4 py-3 align-top">
                                <button
                                  type="button"
                                  onClick={() => handleBlobView(file)}
                                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 border border-blue-200 rounded hover:bg-blue-50 disabled:opacity-60 disabled:cursor-not-allowed"
                                  disabled={downloadingBlobKeys.has(file.key)}
                                >
                                  {downloadingBlobKeys.has(file.key) ? (
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Eye className="h-4 w-4" />
                                  )}
                                  <span>{downloadingBlobKeys.has(file.key) ? 'Loading…' : 'View'}</span>
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* System Health Tab */}
          {activeTab === 'system' && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">AI Model Configuration</h3>
                <p className="text-sm text-gray-700">
                  Active chat model: <span className="font-semibold text-gray-900">{chatModel}</span>
                </p>
                <p className="mt-2 text-xs text-gray-500">
                  Model selection is centrally managed and cannot be changed from this dashboard.
                </p>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">System Health Overview</h3>
                <div className="space-y-6">
                  {systemHealth?.checks && Object.entries(systemHealth.checks).map(([component, health]) => (
                    <div key={component} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-gray-900 capitalize">{component}</h4>
                        <StatusBadge status={health.status} />
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{health.message}</p>
                      <div className="text-xs text-gray-500 space-y-1">
                        {health.responseTime && <div>Response Time: {health.responseTime}</div>}
                        {health.expiresIn && <div>Expires In: {health.expiresIn}</div>}
                        {health.quota && <div>Storage Quota: {health.quota}</div>}
                        {health.features && <div>Features: {health.features}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Token Usage Tab */}
          {activeTab === 'usage' && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Token Usage</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-medium mb-2">Last 30 Days</h4>
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr>
                          <th className="text-left">Date</th>
                          <th className="text-right">Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tokenUsage.daily.map(day => (
                          <tr key={day.date}>
                            <td>{day.date}</td>
                            <td className="text-right">{day.tokens}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Last 12 Months</h4>
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr>
                          <th className="text-left">Month</th>
                          <th className="text-right">Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tokenUsage.monthly.map(month => (
                          <tr key={month.month}>
                            <td>{month.month}</td>
                            <td className="text-right">{month.tokens}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* External Resources Tab */}
          {activeTab === 'training' && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">External Resources</h3>
                <TrainingResourcesAdmin />
              </div>
            </div>
          )}

          {/* Admin Tools Tab */}
          {activeTab === 'tools' && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Administrative Tools</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  
                  <AdminToolCard
                    title="Run System Tests"
                    description="Execute comprehensive system tests"
                    icon={Bug}
                    onClick={runSystemTests}
                    loading={isLoading}
                    color="blue"
                  />
                  
                  <AdminToolCard
                    title="Refresh All Data"
                    description="Reload all admin dashboard data"
                    icon={RefreshCw}
                    onClick={handleRefresh}
                    loading={isLoading}
                    color="green"
                  />
                  
                  <AdminToolCard
                    title="Export System Data"
                    description="Download complete system information"
                    icon={Download}
                    onClick={handleExportData}
                    color="purple"
                  />
                  
                  <AdminToolCard
                    title="View System Logs"
                    description="Access detailed system logs"
                    icon={Eye}
                    onClick={() => window.open('/.netlify/functions/admin-logs', '_blank')}
                    color="orange"
                  />
                  
                  <AdminToolCard
                    title="Backend Console"
                    description="Access backend management tools"
                    icon={Database}
                    onClick={() => window.open('/.netlify/functions/admin-db', '_blank')}
                    color="indigo"
                  />
                  
                  <AdminToolCard
                    title="System Monitor"
                    description="Real-time system monitoring"
                    icon={Monitor}
                    onClick={() => alert('System monitoring dashboard - Feature coming soon')}
                    color="teal"
                    disabled
                  />
                  
                </div>
              </div>

              {/* Danger Zone */}
              <div className="bg-white rounded-lg shadow p-6 border-l-4 border-red-500">
                <h3 className="text-lg font-semibold text-red-900 mb-4 flex items-center">
                  <AlertTriangle className="h-5 w-5 mr-2" />
                  Danger Zone
                </h3>
                <p className="text-sm text-red-700 mb-4">
                  These actions are irreversible and can affect all users. Use with extreme caution.
                </p>
                <div className="space-y-3">
                  <button
                    onClick={() => {
                      if (window.confirm('Are you sure you want to clear all system caches? This may temporarily impact performance.')) {
                        alert('Cache clearing functionality would be implemented here');
                      }
                    }}
                    className="flex items-center space-x-2 px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>Clear System Caches</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {blobPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="blob-preview-dialog-title"
        >
          <div
            className="absolute inset-0 bg-gray-900/70"
            onClick={closeBlobPreview}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-5xl max-h-full bg-white rounded-lg shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-200">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                  <FileText className="h-5 w-5 text-blue-600" />
                  <span
                    id="blob-preview-dialog-title"
                    className="truncate"
                    title={blobPreview.filename}
                  >
                    {blobPreview.filename}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {blobPreview.contentType || 'application/octet-stream'} • {formatBytes(blobPreview.size)}
                  {blobPreview.downloadedAt && ` • Retrieved ${formatDateTime(blobPreview.downloadedAt)}`}
                </p>
                {blobPreview.key && (
                  <p className="text-[11px] text-gray-400 mt-1 break-all">Blob key: {blobPreview.key}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={openBlobPreviewInNewTab}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
                >
                  <Eye className="h-4 w-4" />
                  <span>Open in new tab</span>
                </button>
                <a
                  href={blobPreview.objectUrl}
                  download={blobPreview.filename}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-green-600 border border-green-200 rounded hover:bg-green-50"
                >
                  <Download className="h-4 w-4" />
                  <span>Download</span>
                </a>
                <button
                  type="button"
                  onClick={closeBlobPreview}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded hover:bg-gray-50"
                >
                  <X className="h-4 w-4" />
                  <span>Close</span>
                </button>
              </div>
            </div>
            <div className="flex-1 bg-gray-100">
              <iframe
                title={`Preview of ${blobPreview.filename}`}
                src={blobPreview.objectUrl}
                className="w-full h-full min-h-[420px] bg-white"
                onLoad={() => console.log('Iframe loaded successfully')}
                onError={(e) => console.error('Iframe load error:', e)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Helper Components
const SystemHealthCard = ({ title, status, message, icon: Icon }) => {
  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy': return 'text-green-600 bg-green-50 border-green-200';
      case 'warning': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'error': 
      case 'unhealthy': return 'text-red-600 bg-red-50 border-red-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy': return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'warning': return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'error':
      case 'unhealthy': return <AlertTriangle className="h-5 w-5 text-red-500" />;
      default: return <Clock className="h-5 w-5 text-gray-500" />;
    }
  };

  return (
    <div className={`border rounded-lg p-4 ${getStatusColor(status)}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <Icon className="h-5 w-5" />
          <h3 className="font-medium">{title}</h3>
        </div>
        {getStatusIcon(status)}
      </div>
      <p className="text-sm">{message}</p>
    </div>
  );
};

const StatItem = ({ label, value, description, status }) => {
  const getStatusColor = (status) => {
    switch (status) {
      case 'good': return 'text-green-600';
      case 'warning': return 'text-yellow-600';
      case 'error': return 'text-red-600';
      default: return 'text-gray-900';
    }
  };

  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0">
      <div>
        <div className="font-medium text-gray-900">{label}</div>
        <div className="text-sm text-gray-500">{description}</div>
      </div>
      <div className={`text-lg font-bold ${getStatusColor(status)}`}>
        {value}
      </div>
    </div>
  );
};

const StatusBadge = ({ status }) => {
  const getStatusStyle = (status) => {
    switch (status) {
      case 'healthy': return 'bg-green-100 text-green-800 border-green-200';
      case 'warning': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'error':
      case 'unhealthy': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusStyle(status)}`}>
      {status || 'unknown'}
    </span>
  );
};

const AdminToolCard = ({ title, description, icon: Icon, onClick, loading, color = 'blue', disabled = false }) => {
  const getColorClasses = (color) => {
    const colors = {
      blue: 'bg-blue-50 border-blue-200 hover:bg-blue-100 text-blue-900',
      green: 'bg-green-50 border-green-200 hover:bg-green-100 text-green-900',
      purple: 'bg-purple-50 border-purple-200 hover:bg-purple-100 text-purple-900',
      orange: 'bg-orange-50 border-orange-200 hover:bg-orange-100 text-orange-900',
      indigo: 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100 text-indigo-900',
      teal: 'bg-teal-50 border-teal-200 hover:bg-teal-100 text-teal-900',
      red: 'bg-red-50 border-red-200 hover:bg-red-100 text-red-900'
    };
    return colors[color] || colors.blue;
  };

  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={`p-4 border rounded-lg text-left transition-colors ${
        disabled 
          ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
          : getColorClasses(color)
      } ${loading ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center space-x-3 mb-2">
        {loading ? (
          <RefreshCw className="h-5 w-5 animate-spin" />
        ) : (
          <Icon className="h-5 w-5" />
        )}
        <h4 className="font-medium">{title}</h4>
      </div>
      <p className="text-sm opacity-75">{description}</p>
      {disabled && (
        <div className="mt-2">
          <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded">
            Coming Soon
          </span>
        </div>
      )}
    </button>
  );
};

// AI Model Configuration Component
const AIModelConfiguration = ({ user }) => {
  const [currentProvider, setCurrentProvider] = useState(getModelProvider());
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [useCustomPrompt, setUseCustomPrompt] = useState(!!getSystemPromptOverride());
  const [customPrompt, setCustomPrompt] = useState(getSystemPromptOverride() || '');
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  const handleProviderChange = async (provider) => {
    setIsLoading(true);
    setMessage('');
    
    try {
      const success = setModelProvider(provider);
      
      if (success) {
        setCurrentProvider(provider);
        setMessage(`Model provider successfully changed to ${provider === 'openai' ? 'OpenAI GPT-4o' : 'Groq GPT OSS 20b'}`);
        setMessageType('success');
      } else {
        setMessage('Failed to change model provider. Please try again.');
        setMessageType('error');
      }
    } catch (error) {
      console.error('Error changing provider:', error);
      setMessage('An error occurred while changing the model provider.');
      setMessageType('error');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePromptOverrideToggle = async (enabled) => {
    setUseCustomPrompt(enabled);
    
    if (!enabled) {
      // Disable override - clear it
      const success = clearSystemPromptOverride();
      if (success) {
        setCustomPrompt('');
        setShowPromptEditor(false);
        setMessage('System prompt override disabled. Using default prompt.');
        setMessageType('success');
      }
    } else {
      // Enable override - show editor
      setShowPromptEditor(true);
      if (!customPrompt) {
        setCustomPrompt(OPENAI_CONFIG.SYSTEM_PROMPT);
      }
    }
  };

  const handleSaveCustomPrompt = () => {
    const success = setSystemPromptOverride(customPrompt);
    if (success) {
      setMessage('Custom system prompt saved successfully.');
      setMessageType('success');
    } else {
      setMessage('Failed to save custom prompt.');
      setMessageType('error');
    }
  };

  const providers = [
    {
      id: 'openai',
      name: 'OpenAI GPT-4o',
      description: 'Advanced AI model with excellent reasoning and code generation capabilities',
      features: ['High accuracy', 'Code generation', 'File processing', 'Vector search'],
      color: 'blue'
    },
    {
      id: 'groq',
      name: 'Groq GPT-OSS-120B',
      description: 'Fast open-source model optimized for speed and efficiency',
      features: ['Very fast responses', 'Open source', 'Cost effective', 'High throughput'],
      color: 'green'
    }
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <Zap className="h-5 w-5 mr-2 text-blue-600" />
          AI Model Configuration
        </h3>
        
        <p className="text-sm text-gray-600 mb-6">
          Select the AI model provider for all chat functionality. This setting applies system-wide to all users.
        </p>

        {message && (
          <div className={`mb-6 p-4 rounded-lg ${
            messageType === 'success' 
              ? 'bg-green-50 border border-green-200 text-green-800' 
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}>
            <div className="flex items-center">
              {messageType === 'success' ? (
                <CheckCircle className="h-5 w-5 mr-2" />
              ) : (
                <AlertTriangle className="h-5 w-5 mr-2" />
              )}
              <span className="font-medium">{message}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className={`relative border-2 rounded-lg p-6 cursor-pointer transition-all ${
                currentProvider === provider.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              onClick={() => !isLoading && handleProviderChange(provider.id)}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center">
                  <div className={`w-4 h-4 rounded-full border-2 mr-3 ${
                    currentProvider === provider.id
                      ? 'border-blue-500 bg-blue-500'
                      : 'border-gray-300'
                  }`}>
                    {currentProvider === provider.id && (
                      <div className="w-2 h-2 bg-white rounded-full m-0.5"></div>
                    )}
                  </div>
                  <h4 className="text-lg font-semibold text-gray-900">{provider.name}</h4>
                </div>
                {currentProvider === provider.id && (
                  <div className="flex items-center text-blue-600">
                    <CheckCircle className="h-5 w-5 mr-1" />
                    <span className="text-sm font-medium">Active</span>
                  </div>
                )}
              </div>

              <p className="text-sm text-gray-600 mb-4">{provider.description}</p>

              <div className="space-y-2">
                <h5 className="text-sm font-medium text-gray-700">Key Features:</h5>
                <ul className="text-sm text-gray-600 space-y-1">
                  {provider.features.map((feature, index) => (
                    <li key={index} className="flex items-center">
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full mr-2"></div>
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>

              {isLoading && currentProvider === provider.id && (
                <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center rounded-lg">
                  <RefreshCw className="h-6 w-6 animate-spin text-blue-600" />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <h5 className="text-sm font-medium text-gray-700 mb-2">Current Configuration:</h5>
          <div className="text-sm text-gray-600">
            <p><strong>Provider:</strong> {currentProvider === 'openai' ? 'OpenAI' : 'Groq'}</p>
            <p><strong>Model:</strong> {currentProvider === 'openai' ? 'GPT-4o' : 'GPT-OSS-120B'}</p>
            <p><strong>Scope:</strong> All chat functionality (main chat, document chat, study notes)</p>
          </div>
        </div>

        {/* System Prompt Override Section */}
        <div className="mt-6 p-6 bg-white rounded-lg border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h5 className="text-sm font-semibold text-gray-900">System Prompt Override</h5>
              <p className="text-xs text-gray-500 mt-1">
                Customize the system prompt used for AI responses (applies to both providers)
              </p>
            </div>
            <button
              onClick={() => handlePromptOverrideToggle(!useCustomPrompt)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                useCustomPrompt ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  useCustomPrompt ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {showPromptEditor && useCustomPrompt && (
            <div className="mt-4 space-y-3">
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                className="w-full h-64 p-3 border border-gray-300 rounded-lg text-sm font-mono resize-y focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter custom system prompt..."
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  {customPrompt.length} characters
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setCustomPrompt(OPENAI_CONFIG.SYSTEM_PROMPT);
                    }}
                    className="px-3 py-1.5 text-sm text-gray-700 bg-gray-100 rounded hover:bg-gray-200"
                  >
                    Reset to Default
                  </button>
                  <button
                    onClick={handleSaveCustomPrompt}
                    className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded hover:bg-blue-700"
                  >
                    Save Prompt
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminScreen;
