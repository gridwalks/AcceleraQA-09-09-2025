import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DocumentChatArea from './DocumentChatArea';

// Mock the DocumentViewer component
jest.mock('./DocumentViewer', () => {
  return function MockDocumentViewer({ document, isOpen, onClose }) {
    return isOpen ? (
      <div data-testid="document-viewer">
        <div>Document: {document?.title || document?.filename}</div>
        <button onClick={onClose}>Close</button>
      </div>
    ) : null;
  };
});

// Mock the export utility
jest.mock('../utils/exportUtils', () => ({
  exportToWord: jest.fn(),
}));

describe('DocumentChatArea - Multiple File Upload', () => {
  const defaultProps = {
    messages: [],
    inputMessage: '',
    setInputMessage: jest.fn(),
    isLoading: false,
    handleSendMessage: jest.fn(),
    handleKeyPress: jest.fn(),
    messagesEndRef: { current: null },
    isSaving: false,
    uploadedFile: null,
    setUploadedFile: jest.fn(),
    cooldown: 0,
    onClearChat: jest.fn(),
    documents: [],
    selectedDocuments: [],
    onDocumentSelectionChange: jest.fn(),
    onDocumentClick: jest.fn(),
    onOpenDocumentViewer: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders file input with multiple attribute', () => {
    render(<DocumentChatArea {...defaultProps} />);
    
    const fileInput = screen.getByLabelText(/attach multiple/i);
    expect(fileInput).toHaveAttribute('multiple');
    expect(fileInput).toHaveAttribute('accept', '.pdf,.txt,.md,.docx,.csv,.xlsx');
  });

  it('handles multiple file selection', () => {
    const setUploadedFile = jest.fn();
    render(<DocumentChatArea {...defaultProps} setUploadedFile={setUploadedFile} />);
    
    const fileInput = screen.getByLabelText(/attach multiple/i);
    const file1 = new File(['content1'], 'test1.pdf', { type: 'application/pdf' });
    const file2 = new File(['content2'], 'test2.txt', { type: 'text/plain' });
    
    fireEvent.change(fileInput, { target: { files: [file1, file2] } });
    
    expect(setUploadedFile).toHaveBeenCalledWith([file1, file2]);
  });

  it('displays multiple attached files', () => {
    const file1 = new File(['content1'], 'test1.pdf', { type: 'application/pdf' });
    const file2 = new File(['content2'], 'test2.txt', { type: 'text/plain' });
    
    render(<DocumentChatArea {...defaultProps} uploadedFile={[file1, file2]} />);
    
    expect(screen.getByText('2 files attached')).toBeInTheDocument();
    expect(screen.getByText('test1.pdf')).toBeInTheDocument();
    expect(screen.getByText('test2.txt')).toBeInTheDocument();
  });

  it('allows removing individual files', () => {
    const setUploadedFile = jest.fn();
    const file1 = new File(['content1'], 'test1.pdf', { type: 'application/pdf' });
    const file2 = new File(['content2'], 'test2.txt', { type: 'text/plain' });
    
    render(<DocumentChatArea {...defaultProps} uploadedFile={[file1, file2]} setUploadedFile={setUploadedFile} />);
    
    const removeButtons = screen.getAllByText('Remove');
    fireEvent.click(removeButtons[0]); // Remove first file
    
    expect(setUploadedFile).toHaveBeenCalledWith([file2]);
  });

  it('allows removing all files', () => {
    const setUploadedFile = jest.fn();
    const file1 = new File(['content1'], 'test1.pdf', { type: 'application/pdf' });
    const file2 = new File(['content2'], 'test2.txt', { type: 'text/plain' });
    
    render(<DocumentChatArea {...defaultProps} uploadedFile={[file1, file2]} setUploadedFile={setUploadedFile} />);
    
    const removeAllButton = screen.getByText('Remove all files');
    fireEvent.click(removeAllButton);
    
    expect(setUploadedFile).toHaveBeenCalledWith(null);
  });

  it('enables send button when files are attached', () => {
    const file1 = new File(['content1'], 'test1.pdf', { type: 'application/pdf' });
    
    render(<DocumentChatArea {...defaultProps} uploadedFile={[file1]} />);
    
    const sendButton = screen.getByRole('button', { name: /send message/i });
    expect(sendButton).not.toBeDisabled();
  });

  it('disables send button when no files and no message', () => {
    render(<DocumentChatArea {...defaultProps} uploadedFile={null} inputMessage="" />);
    
    const sendButton = screen.getByRole('button', { name: /send message/i });
    expect(sendButton).toBeDisabled();
  });

  it('shows correct tooltip for multiple file upload', () => {
    render(<DocumentChatArea {...defaultProps} />);
    
    const fileInput = screen.getByLabelText(/attach multiple/i);
    expect(fileInput).toHaveAttribute('title', 'Attach multiple PDF, Word (.docx), Markdown (.md), Text (.txt), CSV (.csv), or Excel (.xlsx) documents. Non-PDF files will be converted automatically.');
  });
});
