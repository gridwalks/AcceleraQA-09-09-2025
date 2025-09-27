// Enhanced with Learning Suggestions
import React, { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  MessageSquare,
  FileText,
  Loader2,
  X,
  Download,
  AlertCircle,
} from 'lucide-react';
import learningSuggestionsService from '../services/learningSuggestionsService';
import { FEATURE_FLAGS } from '../config/featureFlags';
import ConversationList from './ConversationList';
import { combineMessagesIntoConversations, mergeCurrentAndStoredMessages } from '../utils/messageUtils';
import ragService from '../services/ragService';

const createInitialViewerState = () => ({
  isOpen: false,
  title: '',
  filename: '',
  contentType: '',
  allowDownload: false,
  url: '',
});

const ResourcesView = memo(({ currentResources = [], user, onSuggestionsUpdate, onAddResource, messages = [], thirtyDayMessages = [], onConversationSelect }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredResources, setFilteredResources] = useState(currentResources);
  const [conversationSearchTerm, setConversationSearchTerm] = useState('');
  const [learningSuggestions, setLearningSuggestions] = useState([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [openSections, setOpenSections] = useState({
    suggestions: false,
    resources: true,
    conversations: false
  });
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [addedResources, setAddedResources] = useState(new Set());
  const [showToast, setShowToast] = useState(false);
  const [downloadingResourceId, setDownloadingResourceId] = useState(null);
  const toastTimeoutRef = useRef(null);

  const [viewerState, setViewerState] = useState(() => createInitialViewerState());
  const [isViewerLoading, setIsViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState(null);
  const activeObjectUrlRef = useRef(null);
  const viewerRequestRef = useRef(0);
  const userId = user?.sub || null;

  const conversations = useMemo(() => {
    const merged = mergeCurrentAndStoredMessages(messages, thirtyDayMessages);
    return combineMessagesIntoConversations(merged).slice(-20).reverse();
  }, [messages, thirtyDayMessages]);

  const filteredConversations = useMemo(() => {
    if (!conversationSearchTerm.trim()) return conversations;
    const term = conversationSearchTerm.trim().toLowerCase();
    return conversations.filter(conv =>
      (typeof conv.userContent === 'string' && conv.userContent.toLowerCase().includes(term)) ||
      (typeof conv.aiContent === 'string' && conv.aiContent.toLowerCase().includes(term))
    );
  }, [conversations, conversationSearchTerm]);

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

  const decodeBase64ToUint8Array = useCallback((base64) => {
    if (!base64) return null;

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
      const byteCharacters = atobFn(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i += 1) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      return new Uint8Array(byteNumbers);
    } catch (error) {
      console.error('Failed to decode base64 document content:', error);
      return null;
    }
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

  const closeDocumentViewer = useCallback(() => {
    viewerRequestRef.current += 1;
    revokeActiveObjectUrl();
    setViewerState(createInitialViewerState());
    setViewerError(null);
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

  const handleSearchChange = (e) => setSearchTerm(e.target.value);
  const toggleSection = (section) => setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));

  const handleResourceClick = useCallback(async (resource, index = 0) => {
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
    setViewerError(null);

    if (resolvedUrl) {
      setViewerState({
        isOpen: true,
        title: fallbackTitle,
        filename: fallbackFilename,
        contentType,
        allowDownload: true,
        url: resolvedUrl,
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
      });
      setViewerError('This resource does not include a downloadable document.');
      setIsViewerLoading(false);
      return;
    }

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
    });

    try {
      const response = await ragService.downloadDocument({ documentId, fileId }, userId);
      if (viewerRequestRef.current !== requestId) return;
      if (!response) throw new Error('No response received from download request');

      const responseUrl = typeof response.downloadUrl === 'string' ? response.downloadUrl.trim() : '';

      if (responseUrl) {
        setViewerState({
          isOpen: true,
          title: fallbackTitle,
          url: responseUrl,
          filename: response.filename || fallbackFilename,
          contentType: response.contentType || contentType,
          allowDownload: true,
        });
        logDocumentUrl(responseUrl, 'backend download URL');
        setIsViewerLoading(false);
        return;
      }

      // Fallback: backend returned base64 content; build a blob URL
      const base64Content = typeof response.content === 'string' ? response.content.trim() : '';
      const byteArray = decodeBase64ToUint8Array(base64Content);
      if (!byteArray) throw new Error('Unable to decode document content');

      const blob = new Blob([byteArray], { type: response.contentType || contentType || 'application/octet-stream' });
      const objectUrlResult = createObjectUrlFromBlob(blob);
      if (!objectUrlResult) throw new Error('Unable to create object URL for document');

      if (viewerRequestRef.current !== requestId) {
        objectUrlResult.revoke();
        return;
      }

      activeObjectUrlRef.current = objectUrlResult;

      setViewerState({
        isOpen: true,
        title: fallbackTitle,
        url: objectUrlResult.url,
        filename: response.filename || fallbackFilename,
        contentType: response.contentType || contentType,
        allowDownload: true,
      });
      logDocumentUrl(objectUrlResult.url, 'generated object URL');
      setIsViewerLoading(false);
    } catch (error) {
      console.error('Failed to open resource document:', error);
      if (viewerRequestRef.current === requestId) {
        setViewerError('We were unable to load this document in the viewer. If a download option is available, please try that instead.');
        setIsViewerLoading(false);
      }
    } finally {
      setDownloadingResourceId((current) => (current === resourceKey ? null : current));
    }
  }, [createObjectUrlFromBlob, decodeBase64ToUint8Array, getResourceKey, revokeActiveObjectUrl, userId]);

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

        <div className="border border-gray-200 rounded-lg">
          <button
            type="button"
            onClick={() => toggleSection('conversations')}
            className="w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-left hover:bg-gray-50 rounded-t-lg"
          >
            <div className="flex items-center space-x-2">
              <MessageSquare className="h-4 w-4" />
              <span>Conversations</span>
              {conversations.length > 0 && (
                <span className="bg-green-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                  {conversations.length}
                </span>
              )}
            </div>
            <ChevronRight className={`h-4 w-4 transform transition-transform ${openSections.conversations ? 'rotate-90' : ''}`} />
          </button>
          {openSections.conversations && (
            <div className="p-4 space-y-4 border-t border-gray-200">
              {conversations.length > 0 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search conversations..."
                    value={conversationSearchTerm}
                    onChange={(e) => setConversationSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
              )}

              {conversations.length === 0 ? (
                <div className="text-center py-8 text-gray-600">
                  <div className="w-12 h-12 bg-green-100 rounded-lg mx-auto mb-3 flex items-center justify-center">
                    <MessageSquare className="h-6 w-6 text-green-600" />
                  </div>
                  <h4 className="text-lg font-medium text-gray-900 mb-2">No conversations yet</h4>
                  <p className="text-sm">Start chatting to see your learning history here.</p>
                </div>
              ) : filteredConversations.length > 0 ? (
                <ConversationList conversations={filteredConversations} onSelect={onConversationSelect} />
              ) : (
                <div className="text-center py-8">
                  <Search className="w-8 h-8 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-600 text-sm">
                    No conversations match "{conversationSearchTerm}"
                  </p>
                  <button
                    onClick={() => setConversationSearchTerm('')}
                    className="mt-2 text-sm text-green-600 hover:text-green-800"
                  >
                    Clear search
                  </button>
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
        contentType={viewerState.contentType}
        filename={viewerState.filename}
        isLoading={isViewerLoading}
        error={viewerError}
        allowDownload={viewerState.allowDownload}
        onClose={closeDocumentViewer}
      />
    </div>
  );
});

const isBlobLikeUrl = (candidate) => typeof candidate === 'string' && (candidate.startsWith('blob:') || candidate.startsWith('data:'));

export const PdfBlobViewer = memo(({ url, title }) => {
  const containerRef = useRef(null);
  const [{ isRendering, error }, setRenderState] = useState({ isRendering: true, error: null });

  useEffect(() => {
    let isCancelled = false;
    let cleanupTasks = [];
    const container = containerRef.current;

    if (!container || !url) {
      setRenderState((prev) => ({ ...prev, isRendering: false, error: 'PDF preview is unavailable.' }));
      return () => {};
    }

    container.innerHTML = '';
    setRenderState({ isRendering: true, error: null });

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

        const loadingTask = getDocument({ url });
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
          setRenderState({ isRendering: false, error: null });
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
        if (!isCancelled) {
          setRenderState({
            isRendering: false,
            error: 'Unable to display this PDF document in the preview.',
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
  }, [url]);

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
  contentType,
  isLoading,
  onClose,
  filename,
  error,
  allowDownload,
}) => {
  if (!isOpen) return null;

  const safeTitle = title || 'Document';
  const normalizedContentType = (contentType || '').toLowerCase();
  const normalizedFilename = (filename || '').toLowerCase();
  const hasUrl = typeof url === 'string' && url.length > 0;
  const blobUrl = hasUrl && isBlobLikeUrl(url);
  const isPdfDocument =
    normalizedContentType.includes('pdf') ||
    normalizedFilename.endsWith('.pdf');
  const isImageDocument =
    normalizedContentType.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(normalizedFilename);

  let viewerContent = null;

  if (hasUrl) {
    if (isImageDocument) {
      viewerContent = (
        <div className="flex h-full items-center justify-center bg-white">
          <img
            src={url}
            alt={safeTitle}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      );
    } else if (isPdfDocument && blobUrl) {
      viewerContent = (
        <PdfBlobViewer url={url} title={safeTitle} />
      );
    } else if (isPdfDocument) {
      viewerContent = (
        <iframe title={safeTitle} src={url} className="h-full w-full border-0 bg-white" />
      );
    } else if (!blobUrl) {
      viewerContent = (
        <iframe title={safeTitle} src={url} className="h-full w-full border-0 bg-white" />
      );
    } else {
      viewerContent = (
        <div className="flex h-full flex-col items-center justify-center space-y-3 text-gray-500">
          <FileText className="h-10 w-10 text-gray-300" />
          <p className="text-sm">This document format cannot be previewed securely.</p>
          {allowDownload ? (
            <p className="text-xs text-gray-400">Use the download button to view it in a new tab.</p>
          ) : null}
        </div>
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/70 backdrop-blur-sm px-4 sm:px-6 py-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative flex h-full max-h:[85vh] max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${safeTitle} viewer`}
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
          <div className="pr-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Document Viewer</p>
            <h2 className="text-lg font-semibold text-gray-900">{safeTitle}</h2>
            {contentType ? <p className="mt-1 text-xs text-gray-500">{contentType}</p> : null}
          </div>
          <div className="flex items-center space-x-3">
            {allowDownload && url && !isLoading && (
              <a
                href={url}
                download={filename || true}
                className="inline-flex items-center space-x-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
              >
                <Download className="h-4 w-4" />
                <span>Download</span>
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
              aria-label="Close document viewer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden bg-gray-50">
          {isLoading ? (
            <div className="flex h-full flex-col items-center justify-center space-y-3 text-gray-500">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm font-medium">Loading document...</p>
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center space-y-3 px-6 text-center text-gray-600">
              <AlertCircle className="h-10 w-10 text-amber-500" />
              <p className="text-sm">{error}</p>
              {allowDownload && url && (
                <a
                  href={url}
                  download={filename || true}
                  className="inline-flex items-center space-x-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
                >
                  <Download className="h-4 w-4" />
                  <span>Download document</span>
                </a>
              )}
            </div>
          ) : viewerContent ? (
            viewerContent
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

SuggestionCard.displayName = 'SuggestionCard';
ResourceCard.displayName = 'ResourceCard';
ResourcesView.displayName = 'ResourcesView';
PdfBlobViewer.displayName = 'PdfBlobViewer';
DocumentViewer.displayName = 'DocumentViewer';

export default ResourcesView;
