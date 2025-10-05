import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Send, Loader2, Database, Paperclip, X, ExternalLink, BookOpen, FileDown, Trash2, FileText, Edit3, Save, XCircle } from 'lucide-react';
import { exportToWord } from '../utils/exportUtils';
import { parseMarkdown } from '../utils/messageUtils';

// Enhanced markdown text component with document references
const MarkdownText = ({ text, onDocumentClick }) => {
  const segments = parseMarkdown(text);
  
  // Group consecutive list items, table rows, and handle paragraph breaks
  const groupedSegments = [];
  let currentList = null;
  let currentTable = null;
  let currentCodeBlock = null;
  
  segments.forEach((segment, index) => {
    if (segment.type === 'numbered-list-item') {
      if (currentTable) {
        groupedSegments.push(currentTable);
        currentTable = null;
      }
      if (currentCodeBlock) {
        groupedSegments.push(currentCodeBlock);
        currentCodeBlock = null;
      }
      if (!currentList || currentList.type !== 'numbered-list') {
        if (currentList) groupedSegments.push(currentList);
        currentList = { type: 'numbered-list', items: [] };
      }
      currentList.items.push(segment);
    } else if (segment.type === 'bulleted-list-item') {
      if (currentTable) {
        groupedSegments.push(currentTable);
        currentTable = null;
      }
      if (currentCodeBlock) {
        groupedSegments.push(currentCodeBlock);
        currentCodeBlock = null;
      }
      if (!currentList || currentList.type !== 'bulleted-list') {
        if (currentList) groupedSegments.push(currentList);
        currentList = { type: 'bulleted-list', items: [] };
      }
      currentList.items.push(segment);
    } else if (segment.type === 'table-row') {
      if (currentList) {
        groupedSegments.push(currentList);
        currentList = null;
      }
      if (currentCodeBlock) {
        groupedSegments.push(currentCodeBlock);
        currentCodeBlock = null;
      }
      if (!currentTable) {
        currentTable = { type: 'table', rows: [] };
      }
      currentTable.rows.push(segment);
    } else if (segment.type === 'table-separator') {
      // Skip separator rows, they're just for formatting
    } else if (segment.type === 'code-block-start') {
      if (currentList) {
        groupedSegments.push(currentList);
        currentList = null;
      }
      if (currentTable) {
        groupedSegments.push(currentTable);
        currentTable = null;
      }
      currentCodeBlock = { type: 'code-block', language: segment.language, content: '' };
    } else {
      if (currentList) {
        groupedSegments.push(currentList);
        currentList = null;
      }
      if (currentTable) {
        groupedSegments.push(currentTable);
        currentTable = null;
      }
      if (currentCodeBlock) {
        if (segment.content !== '```') {
          currentCodeBlock.content += segment.content + '\n';
        } else {
          groupedSegments.push(currentCodeBlock);
          currentCodeBlock = null;
        }
      } else {
        groupedSegments.push(segment);
      }
    }
  });
  
  if (currentList) {
    groupedSegments.push(currentList);
  }
  if (currentTable) {
    groupedSegments.push(currentTable);
  }
  if (currentCodeBlock) {
    groupedSegments.push(currentCodeBlock);
  }
  
  return (
    <>
      {groupedSegments.map((segment, index) => {
        switch (segment.type) {
          case 'bold':
            return <strong key={index} className="font-semibold">{segment.content}</strong>;
          case 'italic':
            return <em key={index} className="italic">{segment.content}</em>;
          case 'code':
            return (
              <code 
                key={index} 
                className="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono"
              >
                {segment.content}
              </code>
            );
          case 'heading':
            const HeadingTag = `h${Math.min(segment.level + 1, 6)}`;
            const headingClasses = {
              1: 'text-2xl font-bold mt-6 mb-3',
              2: 'text-xl font-bold mt-5 mb-2',
              3: 'text-lg font-semibold mt-4 mb-2',
              4: 'text-base font-semibold mt-3 mb-1',
              5: 'text-sm font-semibold mt-2 mb-1',
              6: 'text-xs font-semibold mt-2 mb-1'
            };
            return (
              <HeadingTag 
                key={index} 
                className={`${headingClasses[segment.level] || headingClasses[2]} text-gray-900`}
              >
                {segment.content}
              </HeadingTag>
            );
          case 'code-block':
            return (
              <pre 
                key={index} 
                className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm font-mono my-4"
              >
                <code>{segment.content.trim()}</code>
              </pre>
            );
          case 'table':
            return (
              <div key={index} className="overflow-x-auto my-4">
                <table className="min-w-full border-collapse border border-gray-300">
                  <tbody>
                    {segment.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className={rowIndex === 0 ? 'bg-gray-50' : ''}>
                        {row.cells.map((cell, cellIndex) => (
                          <td 
                            key={cellIndex} 
                            className={`border border-gray-300 px-3 py-2 text-sm ${rowIndex === 0 ? 'font-semibold' : ''}`}
                          >
                            <MarkdownText text={cell} onDocumentClick={onDocumentClick} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'break':
            return <br key={index} />;
          case 'paragraph-break':
            return <div key={index} className="h-2" />;
          case 'numbered-list':
            return (
              <ol key={index} className="list-decimal list-inside my-3 space-y-1">
                {segment.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="ml-4" value={item.number}>
                    <MarkdownText text={item.content} onDocumentClick={onDocumentClick} />
                  </li>
                ))}
              </ol>
            );
          case 'bulleted-list':
            return (
              <ul key={index} className="list-disc list-inside my-3">
                {segment.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="ml-4 leading-tight">
                    <MarkdownText text={item.content} onDocumentClick={onDocumentClick} />
                  </li>
                ))}
              </ul>
            );
          case 'text':
          default:
            return segment.content;
        }
      })}
    </>
  );
};

// Document reference component
const DocumentReference = ({ document, onClick }) => {
  return (
    <button
      onClick={() => onClick?.(document)}
      className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
    >
      <FileText className="h-3 w-3" />
      <span>{document.title || document.filename}</span>
    </button>
  );
};

// Document selection panel
const DocumentSelectionPanel = ({ documents, selectedDocuments, onSelectionChange, onClose }) => {
  const [searchTerm, setSearchTerm] = useState('');
  
  const filteredDocuments = documents.filter(doc => 
    doc.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    doc.filename?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleDocumentToggle = (documentId) => {
    const isSelected = selectedDocuments.includes(documentId);
    if (isSelected) {
      onSelectionChange(selectedDocuments.filter(id => id !== documentId));
    } else {
      onSelectionChange([...selectedDocuments, documentId]);
    }
  };

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 bg-white border border-gray-200 rounded-lg shadow-lg p-4 max-h-64 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-900">Select Documents to Chat With</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      
      <div className="mb-3">
        <input
          type="text"
          placeholder="Search documents..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
      
      <div className="space-y-2">
        {filteredDocuments.map((doc) => (
          <label key={doc.id} className="flex items-center space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedDocuments.includes(doc.id)}
              onChange={() => handleDocumentToggle(doc.id)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">
                {doc.title || doc.filename}
              </div>
              {doc.displaySummary && (
                <div className="text-xs text-gray-500 line-clamp-2">
                  {doc.displaySummary}
                </div>
              )}
            </div>
          </label>
        ))}
      </div>
      
      {selectedDocuments.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="text-xs text-gray-600">
            {selectedDocuments.length} document{selectedDocuments.length !== 1 ? 's' : ''} selected
          </div>
        </div>
      )}
    </div>
  );
};

// Main Document Chat Area component
const DocumentChatArea = ({
  messages,
  inputMessage,
  setInputMessage,
  isLoading,
  handleSendMessage,
  handleKeyPress,
  messagesEndRef,
  isSaving,
  uploadedFile,
  setUploadedFile,
  cooldown,
  onClearChat,
  documents = [],
  selectedDocuments = [],
  onDocumentSelectionChange,
  onDocumentClick,
  onOpenDocumentViewer
}) => {
  const [showDocumentSelection, setShowDocumentSelection] = useState(false);
  const [editingSummary, setEditingSummary] = useState(null);
  const [editingSummaryText, setEditingSummaryText] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);

  const inputLength = typeof inputMessage === 'string' ? inputMessage.length : 0;
  const trimmedInputMessage = typeof inputMessage === 'string' ? inputMessage.trim() : '';
  const hasMessages = Array.isArray(messages) && messages.length > 0;
  const hasAttachment = Boolean(uploadedFile);
  const canClearChat = Boolean(onClearChat) && (hasMessages || hasAttachment || trimmedInputMessage.length > 0);
  const clearButtonDisabled = isLoading || !canClearChat;

  const handleExportStudyNotes = useCallback((studyNotesMessage) => {
    if (!studyNotesMessage) {
      return;
    }

    try {
      exportToWord(studyNotesMessage);
    } catch (error) {
      console.error('Failed to export notes to Word:', error);
    }
  }, []);

  const handleDocumentSelectionToggle = () => {
    setShowDocumentSelection(!showDocumentSelection);
  };

  const handleEditSummary = (document) => {
    setEditingSummary(document);
    setEditingSummaryText(document.manualSummary || document.summary || '');
  };

  const handleSaveSummary = async () => {
    if (!editingSummary || !editingSummaryText.trim()) return;
    
    setSavingSummary(true);
    try {
      // Call the update manual summary API
      const response = await fetch('/.netlify/functions/update-manual-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'x-user-id': localStorage.getItem('user_id')
        },
        body: JSON.stringify({
          action: 'update',
          documentId: editingSummary.id,
          manualSummary: editingSummaryText.trim()
        })
      });

      if (response.ok) {
        // Update the document in the local state
        const updatedDoc = await response.json();
        // You might want to update the documents array here
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

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Chat Header */}
      <div className="flex-shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900">
              Document Chat Assistant
            </h2>
            {isSaving && (
              <div className="flex items-center space-x-2 text-sm text-blue-600">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent"></div>
                <span className="hidden sm:inline">Saving...</span>
              </div>
            )}
          </div>
          
          {/* Document Selection Button */}
          <div className="relative">
            <button
              onClick={handleDocumentSelectionToggle}
              className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                selectedDocuments.length > 0
                  ? 'bg-blue-100 text-blue-700 border-blue-200'
                  : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
              }`}
            >
              <Database className="h-4 w-4" />
              <span>
                {selectedDocuments.length > 0 
                  ? `${selectedDocuments.length} document${selectedDocuments.length !== 1 ? 's' : ''} selected`
                  : 'Select Documents'
                }
              </span>
            </button>
            
            {showDocumentSelection && (
              <DocumentSelectionPanel
                documents={documents}
                selectedDocuments={selectedDocuments}
                onSelectionChange={onDocumentSelectionChange}
                onClose={() => setShowDocumentSelection(false)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 min-h-0">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <div className="text-4xl sm:text-6xl mb-4">📚</div>
              <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">
                Chat with Your Documents
              </h3>
              <p className="text-gray-600 text-sm">
                Select documents above or ask questions about your indexed documents
              </p>
            </div>
          </div>
        ) : (
          <>
            {messages
              .filter(message => !message.isResource)
              .map((message, index) => {
                const isUserMessage = message.role === 'user';
                const messageText = typeof message.content === 'string' ? message.content : '';
                const hasMessageText = messageText.trim().length > 0;
                const attachments = Array.isArray(message.attachments) ? message.attachments : [];
                const canExportStudyNotes = Boolean(
                  message.isStudyNotes && (message.studyNotesData?.content || message.content)
                );

                return (
                  <div key={index} className={`flex ${isUserMessage ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] lg:max-w-[75%] p-3 sm:p-4 rounded-lg ${
                        isUserMessage
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-900 border border-gray-200'
                      }`}
                    >
                      {/* Message Content */}
                      {hasMessageText && (
                        <div className="whitespace-pre-wrap text-sm sm:text-base leading-relaxed">
                          <MarkdownText 
                            text={messageText} 
                            onDocumentClick={onDocumentClick}
                          />
                        </div>
                      )}

                      {/* Attachments Display */}
                      {attachments.length > 0 && (
                        <div className={`space-y-2 ${hasMessageText ? 'mt-3' : ''}`}>
                          {attachments.map((attachment, attachmentIndex) => {
                            const hasDifferentNames =
                              attachment.originalFileName &&
                              attachment.finalFileName &&
                              attachment.originalFileName !== attachment.finalFileName;

                            let detailText = null;

                            if (attachment.converted) {
                              detailText = hasDifferentNames
                                ? `Converted from ${attachment.originalFileName}`
                                : 'Converted to PDF';
                            } else if (hasDifferentNames) {
                              detailText = `Uploaded as ${attachment.originalFileName}`;
                            }

                            return (
                              <div
                                key={attachmentIndex}
                                className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
                                  isUserMessage
                                    ? 'border-blue-300/60 bg-blue-500/20 text-blue-50'
                                    : 'border-gray-300 bg-white text-gray-700'
                                }`}
                              >
                                <Paperclip
                                  className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${
                                    isUserMessage ? 'text-blue-100' : 'text-gray-500'
                                  }`}
                                />
                                <div className="min-w-0">
                                  <div
                                    className={`truncate font-medium ${
                                      isUserMessage ? 'text-white' : 'text-gray-900'
                                    }`}
                                    title={attachment.finalFileName || attachment.originalFileName || 'Attachment'}
                                  >
                                    {attachment.finalFileName || attachment.originalFileName || 'Attachment'}
                                  </div>
                                  {detailText && (
                                    <div className={isUserMessage ? 'text-blue-100' : 'text-gray-600'}>
                                      {detailText}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Document Sources Display */}
                      {message.sources && message.sources.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-300">
                          <div className="text-xs font-medium text-gray-600 mb-2 flex items-center space-x-1">
                            <Database className="h-3 w-3" />
                            <span>Sources from documents:</span>
                          </div>
                          <div className="space-y-1">
                            {message.sources.slice(0, 3).map((source, idx) => (
                              <div
                                key={idx}
                                className="text-xs bg-white bg-opacity-50 p-2 rounded border"
                              >
                                <div className="font-medium truncate text-blue-600">
                                  {source.title || source.filename}
                                </div>
                                <div className="text-gray-600 line-clamp-2">
                                  {source.text || 'No excerpt available.'}
                                </div>
                                <button
                                  onClick={() => onOpenDocumentViewer?.(source)}
                                  className="mt-1 flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  <span>Open document</span>
                                </button>
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

                      {/* Document References */}
                      {message.documentsUsed && message.documentsUsed.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-300">
                          <div className="text-xs font-medium text-gray-600 mb-2">
                            Referenced Documents:
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {message.documentsUsed.map((docId, idx) => {
                              const doc = documents.find(d => d.id === docId);
                              if (!doc) return null;
                              return (
                                <DocumentReference
                                  key={idx}
                                  document={doc}
                                  onClick={onDocumentClick}
                                />
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {message.isStudyNotes && (
                        <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
                              <BookOpen className="h-4 w-4" />
                              <span>Notes ready</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleExportStudyNotes(message)}
                              disabled={!canExportStudyNotes}
                              className={`inline-flex items-center gap-2 rounded-md px-3 py-1 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                                canExportStudyNotes
                                  ? 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500'
                                  : 'bg-blue-100 text-blue-300 cursor-not-allowed focus:ring-blue-200'
                              }`}
                              aria-label="Export notes to Word"
                              title={
                                canExportStudyNotes
                                  ? 'Download a Word copy of these notes.'
                                  : 'Notes are not ready to export yet.'
                              }
                            >
                              <FileDown className="h-4 w-4" />
                              <span>Export to Word</span>
                            </button>
                          </div>
                          <p className="mt-2 text-xs text-blue-600">
                            Save these notes in your Notebook or export a Word copy for offline review.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
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
              accept=".pdf,.txt,.md,.docx,.csv,.xlsx"
              className="hidden"
              onChange={(e) => setUploadedFile(e.target.files[0] || null)}
            />
            <label
              htmlFor="chat-file-upload"
              className="flex min-w-[44px] cursor-pointer items-center justify-center rounded-lg bg-gray-200 px-3 py-3 text-gray-700 transition hover:bg-gray-300 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:px-4 sm:py-4"
              title="Attach a PDF, Word (.docx), Markdown (.md), Text (.txt), CSV (.csv), or Excel (.xlsx) document. Non-PDF files will be converted automatically."
            >
              <Paperclip className="h-4 w-4 sm:h-5 sm:w-5" />
            </label>
          </div>
          <div className="flex-1 relative">
            <textarea
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask about your documents or upload new ones..."
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
            disabled={isLoading || cooldown > 0 || (!trimmedInputMessage && !uploadedFile)}
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
          <div className="mt-2 flex items-center justify-between gap-3 rounded border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
            <div className="min-w-0">
              <div className="truncate font-medium text-gray-700" title={uploadedFile?.name}>
                {uploadedFile?.name || 'Attached document'}
              </div>
              <div className="text-[11px] text-gray-500">
                Will be indexed and available for chat
              </div>
            </div>
            <button
              type="button"
              onClick={() => setUploadedFile(null)}
              className="flex items-center gap-1 rounded-full border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 transition hover:border-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              <span>Remove</span>
            </button>
          </div>
        )}

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {inputLength > 100 && (
            <div className="text-xs text-gray-500 text-right sm:text-left">
              {inputLength} characters
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              if (clearButtonDisabled || !onClearChat) {
                return;
              }
              onClearChat();
            }}
            disabled={clearButtonDisabled}
            aria-label="Clear chat history"
            title="Clear the current conversation"
            className="inline-flex items-center gap-2 self-end sm:self-auto sm:ml-auto rounded-md border border-transparent bg-white px-3 py-2 text-xs sm:text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
            <span>Clear chat</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default DocumentChatArea;
