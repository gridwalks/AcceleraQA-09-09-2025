# Document Chat System

This document describes the new Document Chat functionality that has been added to the AcceleraQA application, recreating Veeva document chat capabilities.

## Overview

The Document Chat system allows users to:
- Upload and index documents with AI-generated summaries
- Chat with AI about their documents using natural language
- View and manage their document library
- Edit manual summaries for documents
- Download and view documents inline

## Architecture

### Backend Components

#### API Endpoints
- **`/.netlify/functions/chat-with-documents`** - Handles AI chat interactions with document context
- **`/.netlify/functions/index-documents`** - Processes and summarizes uploaded documents
- **`/.netlify/functions/get-indexed-documents`** - Retrieves indexed documents with search and filtering
- **`/.netlify/functions/update-manual-summary`** - Updates manual summaries for documents

#### Database Schema
The system uses the existing `rag_documents` and `rag_document_chunks` tables in PostgreSQL:
- `rag_documents` - Stores document metadata and summaries
- `rag_document_chunks` - Stores document text chunks for search

### Frontend Components

#### Main Components
- **`DocumentChatPage`** - Main page component with routing and state management
- **`DocumentChatArea`** - Enhanced chat interface with document integration
- **`DocumentManager`** - Document library with search, filtering, and management
- **`DocumentViewer`** - Inline document viewer supporting PDFs and text files

#### Key Features
- **Document Selection** - Users can select specific documents to chat with
- **Inline Document Viewing** - Click to view documents without leaving the chat
- **Manual Summary Editing** - Edit AI-generated summaries or add custom ones
- **Real-time Chat** - AI responses with document context and sources
- **File Upload** - Support for PDF, DOCX, TXT, and other formats

## Usage

### Accessing Document Chat
1. Log into the AcceleraQA application
2. Click the menu button in the header
3. Select "Document Chat" from the dropdown menu
4. Or navigate directly to `/document-chat`

### Using the Chat Interface
1. **Select Documents**: Click "Select Documents" to choose which documents to chat with
2. **Ask Questions**: Type questions about your documents in the chat input
3. **Upload Files**: Use the paperclip icon to upload new documents
4. **View Sources**: Click on document references in AI responses to view the source

### Managing Documents
1. **View Library**: Switch to the "Documents" tab to see all indexed documents
2. **Search & Filter**: Use the search bar and filters to find specific documents
3. **Edit Summaries**: Click the edit icon on any document to modify its summary
4. **Download**: Use the download icon to save documents locally
5. **Delete**: Remove documents you no longer need

## Technical Details

### AI Integration
- **OpenAI GPT-4** for chat responses with document context
- **OpenAI GPT-3.5-turbo** for document summarization
- **Document Search** using PostgreSQL full-text search and vector similarity

### File Processing
- **PDF Support** - Native PDF viewing with PDF.js
- **Text Files** - Support for TXT, MD, CSV, and code files
- **Word Documents** - DOCX files are processed and converted
- **File Size Limits** - Configurable limits for uploads

### Security
- **Auth0 Integration** - User authentication and authorization
- **User Isolation** - Documents are scoped to individual users
- **API Key Management** - Secure handling of OpenAI API keys
- **Input Sanitization** - Protection against malicious inputs

## Configuration

### Environment Variables
- `OPENAI_API_KEY` - OpenAI API key for AI functionality
- `NEON_DATABASE_URL` - PostgreSQL connection string
- `AUTH0_DOMAIN` - Auth0 domain for authentication
- `AUTH0_CLIENT_ID` - Auth0 client ID

### Feature Flags
The system respects existing feature flags and can be extended with new ones for document chat specific features.

## Future Enhancements

### Planned Features
- **Document Collaboration** - Share documents with team members
- **Advanced Search** - Semantic search across document content
- **Document Analytics** - Usage statistics and insights
- **Bulk Operations** - Mass upload and processing of documents
- **Document Versioning** - Track changes and maintain history

### Integration Opportunities
- **External Document Sources** - Connect to SharePoint, Google Drive, etc.
- **Workflow Integration** - Connect with existing business processes
- **API Access** - REST API for third-party integrations
- **Webhook Support** - Real-time notifications for document events

## Troubleshooting

### Common Issues
1. **Documents not appearing** - Check if documents are fully processed (status should be "Ready")
2. **Chat not responding** - Verify OpenAI API key is configured correctly
3. **File upload fails** - Check file size limits and supported formats
4. **PDF viewing issues** - Ensure PDF.js is loaded correctly

### Debug Information
- Check browser console for JavaScript errors
- Verify network requests in browser dev tools
- Check server logs for backend errors
- Ensure all environment variables are set correctly

## Support

For technical support or feature requests, please contact the development team or use the in-app support system.
