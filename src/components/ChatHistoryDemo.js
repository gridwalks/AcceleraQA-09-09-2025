// Chat History Demo Component - Shows how the chat history feature works
import React, { useState, useEffect } from 'react';
import { MessageSquare, Save, Trash2, Eye } from 'lucide-react';
import chatHistoryService from '../services/chatHistoryService';

const ChatHistoryDemo = () => {
  const [histories, setHistories] = useState([]);
  const [selectedHistory, setSelectedHistory] = useState(null);
  
  // Mock user and messages for demo
  const mockUser = { sub: 'demo-user-123' };
  const mockMessages = [
    {
      id: 'msg1',
      type: 'user',
      role: 'user',
      content: 'What are the key principles of Good Manufacturing Practice (GMP)?',
      timestamp: new Date().toISOString(),
      isCurrent: true,
      isStored: false
    },
    {
      id: 'msg2',
      type: 'ai',
      role: 'assistant',
      content: 'Good Manufacturing Practice (GMP) is a system for ensuring that products are consistently produced and controlled according to quality standards. Key principles include: 1) Quality management systems, 2) Personnel qualifications and training, 3) Premises and equipment standards, 4) Documentation and records, 5) Production controls, and 6) Quality control testing.',
      timestamp: new Date(Date.now() + 30000).toISOString(),
      isCurrent: true,
      isStored: false,
      resources: [
        {
          title: 'FDA GMP Guidelines',
          type: 'Guideline',
          url: 'https://www.fda.gov/drugs/pharmaceutical-quality-resources/current-good-manufacturing-practice-cgmp-regulations'
        }
      ]
    }
  ];

  useEffect(() => {
    loadHistories();
  }, []);

  const loadHistories = () => {
    const allHistories = chatHistoryService.getAllHistories(mockUser.sub);
    setHistories(allHistories);
  };

  const handleCaptureChat = () => {
    try {
      const customTitle = prompt('Enter a title for this chat history (optional):');
      const historyEntry = chatHistoryService.captureCurrentChat(mockMessages, mockUser, customTitle);
      loadHistories();
      alert('Chat history captured successfully!');
    } catch (error) {
      alert('Error capturing chat: ' + error.message);
    }
  };

  const handleDeleteHistory = (historyId) => {
    if (confirm('Are you sure you want to delete this chat history?')) {
      const success = chatHistoryService.deleteHistory(historyId);
      if (success) {
        loadHistories();
        setSelectedHistory(null);
        alert('Chat history deleted successfully!');
      } else {
        alert('Failed to delete chat history');
      }
    }
  };

  const handleViewHistory = (historyId) => {
    const history = chatHistoryService.getHistoryById(historyId);
    setSelectedHistory(history);
  };

  const storageInfo = chatHistoryService.getStorageInfo();

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Chat History Demo</h2>
        <p className="text-gray-600">
          This demo shows how the chat history feature works. You can capture the current mock conversation 
          and view saved chat histories.
        </p>
      </div>

      {/* Storage Info */}
      <div className="bg-blue-50 p-4 rounded-lg mb-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-2">Storage Information</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="font-medium">Saved Histories:</span> {storageInfo.count} / {storageInfo.maxCount}
          </div>
          <div>
            <span className="font-medium">Storage Used:</span> {storageInfo.storageSizeFormatted}
          </div>
        </div>
      </div>

      {/* Mock Current Chat */}
      <div className="bg-gray-50 p-4 rounded-lg mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Current Chat (Mock)</h3>
          <button
            onClick={handleCaptureChat}
            className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Save className="h-4 w-4" />
            <span>Save This Chat</span>
          </button>
        </div>
        
        <div className="space-y-3">
          {mockMessages.map((message, index) => (
            <div key={message.id} className={`p-3 rounded-lg ${
              message.type === 'user' ? 'bg-blue-100 ml-8' : 'bg-white mr-8 border'
            }`}>
              <div className="text-sm font-medium text-gray-700 mb-1">
                {message.type === 'user' ? 'You' : 'AcceleraQA'}:
              </div>
              <div className="text-gray-900">{message.content}</div>
              {message.resources && message.resources.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-200">
                  <div className="text-xs font-medium text-gray-600 mb-1">Resources:</div>
                  {message.resources.map((resource, idx) => (
                    <div key={idx} className="text-xs text-blue-600">
                      • {resource.title} ({resource.type})
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Saved Histories */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Saved Chat Histories ({histories.length})
          </h3>
          
          {histories.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <MessageSquare className="h-12 w-12 mx-auto mb-2 text-gray-300" />
              <p>No chat histories saved yet.</p>
              <p className="text-sm">Capture the mock chat above to see how it works!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {histories.map((history) => (
                <div key={history.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-medium text-gray-900 truncate flex-1">{history.title}</h4>
                    <div className="flex items-center space-x-1 ml-2">
                      <button
                        onClick={() => handleViewHistory(history.id)}
                        className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                        title="View details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteHistory(history.id)}
                        className="p-1 text-red-600 hover:bg-red-50 rounded"
                        title="Delete history"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="text-sm text-gray-600 mb-2">
                    Captured: {new Date(history.capturedAt).toLocaleString()}
                  </div>
                  
                  <div className="flex items-center space-x-4 text-xs text-gray-500">
                    <span>{history.conversationCount} conversation{history.conversationCount !== 1 ? 's' : ''}</span>
                    <span>{history.messageCount} message{history.messageCount !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* History Details */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">History Details</h3>
          
          {selectedHistory ? (
            <div className="border rounded-lg p-4">
              <h4 className="font-medium text-gray-900 mb-2">{selectedHistory.title}</h4>
              
              <div className="text-sm text-gray-600 mb-4">
                <div>Captured: {new Date(selectedHistory.capturedAt).toLocaleString()}</div>
                <div>Conversations: {selectedHistory.conversationCount}</div>
                <div>Messages: {selectedHistory.messageCount}</div>
              </div>
              
              <div className="space-y-3">
                <h5 className="font-medium text-gray-800">Conversations:</h5>
                {selectedHistory.conversations.map((conv, index) => (
                  <div key={index} className="bg-gray-50 p-3 rounded">
                    {conv.userContent && (
                      <div className="mb-2">
                        <span className="font-medium text-blue-700">Q:</span>
                        <span className="ml-2 text-gray-900">{conv.userContent}</span>
                      </div>
                    )}
                    {conv.aiContent && (
                      <div>
                        <span className="font-medium text-green-700">A:</span>
                        <span className="ml-2 text-gray-900">{conv.aiContent}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="border rounded-lg p-8 text-center text-gray-500">
              <Eye className="h-12 w-12 mx-auto mb-2 text-gray-300" />
              <p>Select a chat history to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatHistoryDemo;
