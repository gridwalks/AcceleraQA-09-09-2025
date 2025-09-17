// src/components/ChatArea.js - DEPLOYMENT READY (fixes DatabaseOff issue)

import React from 'react';
import { Send, Loader2, Database, Paperclip, X } from 'lucide-react';

const isPdfAttachment = (file) => {
  if (!file) return false;
  const name = typeof file.name === 'string' ? file.name.toLowerCase() : '';
  const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  return name.endsWith('.pdf') || type === 'application/pdf';
};

const AttachmentPreview = ({ file, onRemove }) => {
  const needsConversion = file ? !isPdfAttachment(file) : false;

  return (
    <div className="mt-2 flex items-center justify-between gap-3 rounded border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
      <div className="min-w-0">
        <div className="truncate font-medium text-gray-700" title={file?.name}>
          {file?.name || 'Attached document'}
        </div>
        <div className="text-[11px] text-gray-500">
          {needsConversion ? 'Will convert to PDF before sending' : 'Ready to send to assistant'}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="flex items-center gap-1 rounded-full border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 transition hover:border-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
      >
        <X className="h-3 w-3" aria-hidden="true" />
        <span>Remove</span>
      </button>
    </div>
  );
};

const ChatArea = ({
  messages,
  inputMessage,
  setInputMessage,
  isLoading,
  handleSendMessage,
  handleKeyPress,
  messagesEndRef,
  ragEnabled,
  setRAGEnabled,
  isSaving,
  uploadedFile,
  setUploadedFile,
  cooldown, // rate-limit cooldown (seconds)
}) => {
  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Chat Header with RAG Toggle */}
      <div className="flex-shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900">
              AcceleraQA Assistant
            </h2>
            {isSaving && (
              <div className="flex items-center space-x-2 text-sm text-blue-600">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent"></div>
                <span className="hidden sm:inline">Saving...</span>
              </div>
            )}
          </div>

          {/* RAG Toggle Switch */}
          <label
            className="flex items-center space-x-2 cursor-pointer"
            title={ragEnabled ? 'RAG enabled - searching uploaded documents' : 'RAG disabled - AI knowledge only'}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={ragEnabled}
              onChange={() => setRAGEnabled(!ragEnabled)}
            />
            <span
              className={`relative inline-block h-5 w-10 rounded-full transition-colors ${
                ragEnabled ? 'bg-purple-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`absolute left-1 top-1 h-3 w-3 rounded-full bg-white transition-transform ${
                  ragEnabled ? 'translate-x-5' : ''
                }`}
              />
            </span>
            <span className="hidden sm:inline text-sm">
              {ragEnabled ? 'Document Search' : 'AI Knowledge'}
            </span>
          </label>
        </div>

        {/* RAG Status Description */}
        {ragEnabled && (
          <div className="mt-2 text-sm text-purple-600 bg-purple-50 px-3 py-1 rounded-md flex items-center space-x-2">
            <Database className="h-3 w-3" />
            <span>Searching uploaded documents for relevant context</span>
          </div>
        )}
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 min-h-0">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <div className="text-4xl sm:text-6xl mb-4">🚀</div>
              <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">
                What can I help you with today?
              </h3>
            </div>
          </div>
        ) : (
          <>
            {messages
              .filter(message => !message.isResource)
              .map((message, index) => (
                <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] lg:max-w-[75%] p-3 sm:p-4 rounded-lg ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-900 border border-gray-200'
                    }`}
                  >
                    {/* Message Content */}
                    <div className="whitespace-pre-wrap text-sm sm:text-base leading-relaxed">
                      {message.content}
                    </div>

                    {/* RAG Sources Display */}
                    {message.sources && message.sources.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-300">
                        <div className="text-xs font-medium text-gray-600 mb-2 flex items-center space-x-1">
                          <Database className="h-3 w-3" />
                          <span>Sources from uploaded documents:</span>
                        </div>
                        <div className="space-y-1">
                          {message.sources.slice(0, 3).map((source, idx) => (
                            <div key={idx} className="text-xs bg-white bg-opacity-50 p-2 rounded border">
                              <div className="font-medium truncate" title={source.filename}>
                                {source.filename}
                              </div>
                              <div className="text-gray-600 line-clamp-2">
                                {source.text.substring(0, 150)}...
                              </div>
                            </div>
                          ))}
                          {message.sources.length > 3 && (
                            <div className="text-xs text-gray-500 italic">
                              ...and {message.sources.length - 3} more sources
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Timestamp */}
                    <div
                      className={`text-xs mt-2 ${
                        message.role === 'user' ? 'text-blue-200' : 'text-gray-500'
                      }`}
                    >
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 p-4 sm:p-6 border-t border-gray-200 bg-gray-50 rounded-b-lg mt-auto">
        {cooldown > 0 && (
          <div className="mb-2 text-sm text-yellow-700 bg-yellow-100 px-3 py-2 rounded">
            You're sending messages too quickly. Please wait {cooldown}s before trying again.
          </div>
        )}
        <div className="flex space-x-3">
          <div className="flex-shrink-0">
            <input
              type="file"
              id="chat-file-upload"
              accept=".pdf,.txt,.md,.docx"
              className="hidden"
              onChange={(e) => setUploadedFile(e.target.files[0] || null)}
            />
            <label
              htmlFor="chat-file-upload"
              className="flex min-w-[44px] cursor-pointer items-center justify-center rounded-lg bg-gray-200 px-3 py-3 text-gray-700 transition hover:bg-gray-300 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:px-4 sm:py-4"
              title="Attach a PDF, Word (.docx), Markdown (.md), or Text (.txt) document. Non-PDF files will be converted automatically."
            >
              <Paperclip className="h-4 w-4 sm:h-5 sm:w-5" />
            </label>
          </div>
          <div className="flex-1 relative">
            <textarea
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask about quality, compliance, or upload documents for specific guidance..."
              className="w-full p-3 sm:p-4 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm sm:text-base min-h-[44px] max-h-32"
              rows={1}
              style={{
                height: 'auto',
                overflowY: inputMessage.split('\n').length > 3 ? 'auto' : 'hidden',
              }}
              onInput={(e) => {
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px';
              }}
              disabled={isLoading}
            />
          </div>
          <button
            type="button"
            onClick={handleSendMessage}
            disabled={isLoading || cooldown > 0 || (!inputMessage.trim() && !uploadedFile)}
            className="flex min-w-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:px-6 sm:py-4"
            title={cooldown > 0 ? `Please wait ${cooldown}s` : 'Send message'}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
            ) : (
              <Send className="h-4 w-4 sm:h-5 sm:w-5" />
            )}
          </button>
        </div>

        {uploadedFile && (
          <AttachmentPreview file={uploadedFile} onRemove={() => setUploadedFile(null)} />
        )}

        {/* Character/Line Count for longer messages */}
        {inputMessage.length > 100 && (
          <div className="text-xs text-gray-500 mt-2 text-right">
            {inputMessage.length} characters
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatArea;
