import React, { useState, useEffect, useCallback, useRef } from 'react';
import DocumentChatArea from '../components/DocumentChatArea';
import DocumentManager from '../components/DocumentManager';
import DocumentViewer from '../components/DocumentViewer';
import Header from '../components/Header';
import authService, { initializeAuth, getUserId, handleLogout } from '../services/authService';
import { hasAdminRole } from '../utils/auth';
import { getModelProvider } from '../config/modelConfig';
import { 
  MessageSquare, 
  Database, 
  FileText, 
  Settings,
  Upload,
  Search,
  BookOpen
} from 'lucide-react';

const DocumentChatPage = () => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('chat');
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const [documents, setDocuments] = useState([]);
  const [selectedDocuments, setSelectedDocuments] = useState([]);
  const [viewerDocument, setViewerDocument] = useState(null);
  const [showViewer, setShowViewer] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showRAGConfig, setShowRAGConfig] = useState(false);
  const [showNotebook, setShowNotebook] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [lastSaveTime, setLastSaveTime] = useState(null);
  
  const messagesEndRef = useRef(null);
  const cooldownRef = useRef(null);

  // Initialize auth on mount
  useEffect(() => {
    const initAuth = async () => {
      try {
        const user = await initializeAuth(
          (user) => {
            setUser(user);
            setIsAuthenticated(!!user);
          },
          (loading) => setAuthLoading(loading)
        );
        if (user) {
          setUser(user);
          setIsAuthenticated(true);
        }
      } catch (error) {
        console.error('Auth initialization failed:', error);
        setAuthLoading(false);
      }
    };
    
    initAuth();
  }, []);

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load documents on mount
  useEffect(() => {
    if (isAuthenticated) {
      loadDocuments();
    }
  }, [isAuthenticated]);

  // Load documents function
  const loadDocuments = useCallback(async () => {
    try {
      const userId = await getUserId();
      if (!userId) {
        console.error('No user ID available');
        return;
      }

      const response = await fetch('/.netlify/functions/get-indexed-documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'x-user-id': userId
        },
        body: JSON.stringify({
          action: 'list'
        })
      });

      if (response.ok) {
        const data = await response.json();
        setDocuments(data.documents || []);
      }
    } catch (error) {
      console.error('Error loading documents:', error);
    }
  }, []);

  // Handle sending messages
  const handleSendMessage = useCallback(async () => {
    const trimmedMessage = inputMessage.trim();
    const hasFiles = Array.isArray(uploadedFile) ? uploadedFile.length > 0 : Boolean(uploadedFile);
    if (!trimmedMessage && !hasFiles) return;
    if (isLoading || cooldown > 0) return;

    setIsLoading(true);
    setIsSaving(true);

    try {
      // Add user message to UI immediately
      const files = Array.isArray(uploadedFile) ? uploadedFile : (uploadedFile ? [uploadedFile] : []);
      const userMessage = {
        role: 'user',
        content: trimmedMessage,
        timestamp: new Date().toISOString(),
        attachments: files.map(file => ({
          originalFileName: file.name,
          finalFileName: file.name,
          converted: false
        }))
      };

      setMessages(prev => [...prev, userMessage]);
      setInputMessage('');
      setUploadedFile(null);

      // Prepare request body
      const requestBody = {
        message: trimmedMessage,
        conversationId: conversationId,
        documentIds: selectedDocuments,
        conversationHistory: messages.slice(-10), // Last 10 messages for context
        provider: getModelProvider() // Add current model provider
      };

      // If files are uploaded, index them first
      if (hasFiles) {
        const userId = await getUserId();
        if (!userId) {
          throw new Error('No user ID available');
        }

        const newDocumentIds = [];
        
        // Process each file
        for (const file of files) {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('action', 'upload');

          const indexResponse = await fetch('/.netlify/functions/index-documents', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
              'x-user-id': userId
            },
            body: formData
          });

          if (indexResponse.ok) {
            const indexData = await indexResponse.json();
            if (indexData.documentId) {
              newDocumentIds.push(indexData.documentId);
            }
          }
        }
        
        if (newDocumentIds.length > 0) {
          requestBody.documentIds = [...selectedDocuments, ...newDocumentIds];
          // Reload documents to include the new ones
          loadDocuments();
        }
      }

      // Send chat message
      const userId = await getUserId();
      if (!userId) {
        throw new Error('No user ID available');
      }

      const chatResponse = await fetch('/.netlify/functions/chat-with-documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'x-user-id': userId
        },
        body: JSON.stringify(requestBody)
      });

      if (chatResponse.ok) {
        const chatData = await chatResponse.json();
        
        // Add AI response to messages
        const aiMessage = {
          role: 'assistant',
          content: chatData.response,
          timestamp: new Date().toISOString(),
          sources: chatData.sources || [],
          documentsUsed: chatData.documentsUsed || []
        };

        setMessages(prev => [...prev, aiMessage]);
        setConversationId(chatData.conversationId);

        // Set cooldown
        setCooldown(2);
        cooldownRef.current = setInterval(() => {
          setCooldown(prev => {
            if (prev <= 1) {
              clearInterval(cooldownRef.current);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        throw new Error('Failed to get AI response');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Add error message
      const errorMessage = {
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request. Please try again.',
        timestamp: new Date().toISOString(),
        isError: true
      };
      
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      setIsSaving(false);
    }
  }, [inputMessage, uploadedFile, isLoading, cooldown, messages, selectedDocuments, conversationId, loadDocuments]);

  // Handle key press
  const handleKeyPress = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  // Handle clear chat
  const handleClearChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setSelectedDocuments([]);
    setUploadedFile(null);
    setInputMessage('');
  }, []);

  // Handle document selection change
  const handleDocumentSelectionChange = useCallback((newSelection) => {
    setSelectedDocuments(newSelection);
  }, []);

  // Handle document click
  const handleDocumentClick = useCallback((document) => {
    setViewerDocument(document);
    setShowViewer(true);
  }, []);

  // Handle open document viewer
  const handleOpenDocumentViewer = useCallback((source) => {
    // Find the document by title or filename
    const document = documents.find(doc => 
      doc.title === source.title || doc.filename === source.filename
    );
    if (document) {
      setViewerDocument(document);
      setShowViewer(true);
    }
  }, [documents]);

  // Handle close viewer
  const handleCloseViewer = useCallback(() => {
    setShowViewer(false);
    setViewerDocument(null);
  }, []);

  // Handle document select (for selection mode)
  const handleDocumentSelect = useCallback((document) => {
    if (selectedDocuments.includes(document.id)) {
      setSelectedDocuments(prev => prev.filter(id => id !== document.id));
    } else {
      setSelectedDocuments(prev => [...prev, document.id]);
    }
  }, [selectedDocuments]);

  // Header handler functions
  const handleShowAdmin = useCallback(() => {
    setShowAdmin(true);
  }, []);

  const handleShowProfile = useCallback(() => {
    setShowProfile(true);
  }, []);

  const handleShowRAGConfig = useCallback(() => {
    setShowRAGConfig(true);
  }, []);

  const handleLogoutComplete = useCallback(() => {
    // Handle logout completion if needed
    console.log('Logout completed');
  }, []);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Please log in to access Document Chat</h1>
          <p className="text-gray-600">You need to be authenticated to use this feature.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Consistent Header with hamburger menu */}
      <Header
        user={user}
        isSaving={isSaving}
        lastSaveTime={lastSaveTime}
        onShowAdmin={handleShowAdmin}
        onShowProfile={handleShowProfile}
        onShowRAGConfig={handleShowRAGConfig}
        onOpenNotebook={() => setShowNotebook(true)}
        onOpenSupport={() => setShowSupport(true)}
        onLogout={handleLogoutComplete}
      />

      {/* Navigation Tabs */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('chat')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'chat'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <MessageSquare className="h-4 w-4" />
                <span>Chat</span>
              </div>
            </button>
            
            <button
              onClick={() => setActiveTab('documents')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'documents'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Database className="h-4 w-4" />
                <span>Documents</span>
              </div>
            </button>
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden h-[calc(100vh-64px)]">
        <div className="h-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {activeTab === 'chat' ? (
            <DocumentChatArea
              messages={messages}
              inputMessage={inputMessage}
              setInputMessage={setInputMessage}
              isLoading={isLoading}
              handleSendMessage={handleSendMessage}
              handleKeyPress={handleKeyPress}
              messagesEndRef={messagesEndRef}
              isSaving={isSaving}
              uploadedFile={uploadedFile}
              setUploadedFile={setUploadedFile}
              cooldown={cooldown}
              onClearChat={handleClearChat}
              documents={documents}
              selectedDocuments={selectedDocuments}
              onDocumentSelectionChange={handleDocumentSelectionChange}
              onDocumentClick={handleDocumentClick}
              onOpenDocumentViewer={handleOpenDocumentViewer}
            />
          ) : (
            <DocumentManager
              userId={user?.sub}
              onDocumentView={handleDocumentClick}
              onDocumentSelect={handleDocumentSelect}
              selectedDocuments={selectedDocuments}
              showSelectionMode={false}
            />
          )}
        </div>
      </div>

      {/* Document Viewer Modal */}
      <DocumentViewer
        document={viewerDocument}
        onClose={handleCloseViewer}
        isOpen={showViewer}
      />

      {/* Header Modal Components */}
      {showAdmin && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-semibold mb-4">Admin Panel</h2>
            <p className="text-gray-600 mb-4">Admin functionality would be implemented here.</p>
            <button
              onClick={() => setShowAdmin(false)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showProfile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-semibold mb-4">User Profile</h2>
            <div className="space-y-2 mb-4">
              <p><strong>Name:</strong> {user?.name || 'N/A'}</p>
              <p><strong>Email:</strong> {user?.email || 'N/A'}</p>
              <p><strong>Roles:</strong> {user?.roles?.join(', ') || 'N/A'}</p>
              <p><strong>Organization:</strong> {user?.organization || 'N/A'}</p>
            </div>
            <button
              onClick={() => setShowProfile(false)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showRAGConfig && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-semibold mb-4">My Resources</h2>
            <p className="text-gray-600 mb-4">Resource management functionality would be implemented here.</p>
            <button
              onClick={() => setShowRAGConfig(false)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showNotebook && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-semibold mb-4">Notebook</h2>
            <p className="text-gray-600 mb-4">Notebook functionality would be implemented here.</p>
            <button
              onClick={() => setShowNotebook(false)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showSupport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-semibold mb-4">Support Request</h2>
            <p className="text-gray-600 mb-4">Support request functionality would be implemented here.</p>
            <button
              onClick={() => setShowSupport(false)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentChatPage;
