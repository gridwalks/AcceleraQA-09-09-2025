# Enhanced Document Chat System

This document describes the comprehensive document chat system that recreates Veeva document chat functionality with AI integration, manual summary management, and intelligent document discovery.

## System Overview

The Enhanced Document Chat System provides:

- **AI-Powered Document Chat**: Intelligent conversations about indexed documents using GPT-4
- **Manual Summary Management**: Users can add, edit, and manage custom document summaries
- **Smart Document Discovery**: Automatic document selection based on chat context
- **Inline Document Viewing**: View documents directly within the chat interface
- **Comprehensive Metadata**: Document versioning, types, and status tracking
- **Pharmaceutical Focus**: Specialized for regulatory compliance and clinical trial documents

## Architecture

### Backend Components

#### Enhanced Database Schema

The system uses an enhanced PostgreSQL schema with the following key tables:

```sql
-- Enhanced documents table with comprehensive metadata
CREATE TABLE rag_documents (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  original_filename TEXT,
  file_type TEXT,
  file_size BIGINT,
  text_content TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  title TEXT,
  summary TEXT,                    -- AI-generated summary
  manual_summary TEXT,             -- User-added manual summary
  version TEXT,
  document_number TEXT,            -- Extracted document number (e.g., SOP-001)
  major_version INTEGER DEFAULT 1,
  minor_version INTEGER DEFAULT 0,
  document_type TEXT,              -- sop, protocol, regulatory, etc.
  status TEXT DEFAULT 'active',    -- active, archived, draft
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Document chunks for search
CREATE TABLE rag_document_chunks (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  word_count INTEGER,
  character_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Conversation history for chat context
CREATE TABLE rag_conversations (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_role TEXT NOT NULL CHECK (message_role IN ('user', 'assistant', 'system')),
  message_content TEXT NOT NULL,
  document_ids TEXT[],
  sources JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

#### API Endpoints

**1. Chat with Documents** (`/.netlify/functions/chat-with-documents`)
- Handles AI chat interactions with document context
- Supports both specific document selection and automatic discovery
- Prioritizes manual summaries over AI summaries
- Maintains conversation history for context

**2. Document Indexing** (`/.netlify/functions/index-documents`)
- Processes and summarizes uploaded documents
- Generates specialized summaries for pharmaceutical documents
- Extracts document metadata (numbers, versions, types)
- Creates searchable text chunks

**3. Get Indexed Documents** (`/.netlify/functions/get-indexed-documents`)
- Retrieves indexed documents with advanced search and filtering
- Supports full-text search across titles, summaries, and content
- Provides document statistics and metadata

**4. Manual Summary Management** (`/.netlify/functions/update-manual-summary`)
- Adds, updates, and deletes manual summaries
- Supports bulk operations
- Maintains audit trail of changes

### Frontend Components

#### Enhanced DocumentChatArea
- **Smart Document Selection**: Users can select specific documents or let the system auto-discover relevant ones
- **Inline Document References**: Click to view referenced documents without leaving chat
- **Manual Summary Editing**: Edit summaries directly within the chat interface
- **Conversation History**: Persistent chat history with document context

#### Enhanced DocumentManager
- **Advanced Search**: Full-text search across document content and summaries
- **Metadata Display**: Shows document numbers, versions, types, and status
- **Summary Management**: Visual distinction between AI and manual summaries
- **Bulk Operations**: Select and manage multiple documents

#### Enhanced DocumentViewer
- **PDF Support**: Full PDF viewing with zoom, rotation, and navigation
- **Text File Support**: Syntax highlighting for code and structured text
- **Metadata Panel**: Comprehensive document information display
- **Summary Comparison**: Side-by-side view of AI and manual summaries

## Key Features

### 1. Smart Document Discovery

The system automatically finds relevant documents based on:
- **Content Similarity**: Full-text search across document chunks
- **Summary Matching**: Search through both AI and manual summaries
- **Metadata Filtering**: Document type, status, and version filtering
- **User Selection**: Manual document selection for targeted conversations

### 2. AI Chat Integration

**Enhanced System Prompt**:
```
You are AcceleraQA, an AI assistant specialized in pharmaceutical quality, 
compliance, and clinical trial integrity. You help users understand and work 
with documents from a document management system, with access to both 
AI-generated summaries and user-added manual summaries.

CORE CAPABILITIES:
- Analyze regulatory texts, laws, and SOPs with accuracy and inspection readiness
- Provide actionable insights based on document content
- Reference specific documents by name, number, and version when relevant
- Maintain professional tone appropriate for pharmaceutical/clinical environments

DOCUMENT CONTEXT RULES:
1. ALWAYS prioritize manual summaries over AI summaries when both exist
2. When manual summaries provide corrections or additional context to AI summaries, note the differences
3. Reference documents by their full identifiers (name, number, version)
4. If information isn't in the provided documents, state this clearly
5. Focus on what the documents actually say, not assumptions
```

### 3. Manual Summary Management

**Features**:
- **Priority System**: Manual summaries always take precedence over AI summaries
- **Inline Editing**: Edit summaries directly in the document manager
- **Bulk Operations**: Update multiple document summaries at once
- **Version Tracking**: Track changes to manual summaries over time
- **Audit Trail**: Maintain history of summary modifications

### 4. Document Metadata Enhancement

**Extracted Information**:
- **Document Numbers**: Automatically extracted from filenames (e.g., SOP-001, PROTOCOL-456)
- **Version Information**: Major and minor version tracking
- **Document Types**: Classification as SOP, protocol, regulatory, etc.
- **Status Tracking**: Active, archived, draft status management
- **File Information**: Size, type, upload date, and user tracking

### 5. Inline Document Access

**Features**:
- **One-Click Viewing**: Open documents directly from chat messages
- **Context Preservation**: Maintain chat context while viewing documents
- **Metadata Display**: Show document information alongside content
- **Download Options**: Download documents for offline review
- **Multi-Format Support**: PDF, text, and code file viewing

## Usage Examples

### 1. Document Upload and Indexing

```javascript
// Upload a document with metadata
const formData = new FormData();
formData.append('file', documentFile);
formData.append('metadata', JSON.stringify({
  documentType: 'sop',
  documentNumber: 'SOP-001',
  version: '2.1',
  status: 'active'
}));

const response = await fetch('/.netlify/functions/index-documents', {
  method: 'POST',
  body: formData
});
```

### 2. Chat with Specific Documents

```javascript
// Chat with selected documents
const chatResponse = await fetch('/.netlify/functions/chat-with-documents', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: "What are the key requirements in these SOPs?",
    documentIds: ['123', '456', '789'],
    conversationHistory: previousMessages
  })
});
```

### 3. Update Manual Summary

```javascript
// Add or update manual summary
const summaryResponse = await fetch('/.netlify/functions/update-manual-summary', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'update',
    documentId: '123',
    manualSummary: 'This SOP outlines the procedure for...'
  })
});
```

### 4. Search and Filter Documents

```javascript
// Advanced document search
const searchResponse = await fetch('/.netlify/functions/get-indexed-documents', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'list',
    search: 'validation procedures',
    documentType: 'sop',
    status: 'active',
    hasManualSummary: true
  })
});
```

## Integration Points

### Document Management Systems

The system can integrate with various document management systems:

- **Veeva Vault**: Direct integration with Veeva's document management
- **SharePoint**: Connect to SharePoint document libraries
- **File Systems**: Local and network file system integration
- **Cloud Storage**: AWS S3, Google Drive, Dropbox integration

### AI Services

- **OpenAI GPT-4**: Primary AI model for chat and summarization
- **GPT-3.5-turbo**: Cost-effective option for document summarization
- **Custom Models**: Support for specialized pharmaceutical AI models

### Database Options

- **PostgreSQL**: Primary database with full-text search
- **Neon**: Serverless PostgreSQL for easy deployment
- **Supabase**: Alternative with built-in real-time features

## Security Considerations

### Authentication and Authorization
- **User Authentication**: Auth0 integration for secure user management
- **Document Access Control**: User-based document access restrictions
- **API Security**: JWT token validation and rate limiting

### Data Protection
- **Input Sanitization**: All user inputs are sanitized and validated
- **API Key Management**: Secure storage of OpenAI API keys
- **Document Encryption**: Optional document encryption at rest

### Compliance
- **Audit Trails**: Complete audit logs for document access and modifications
- **Data Retention**: Configurable data retention policies
- **GDPR Compliance**: User data deletion and export capabilities

## Deployment

### Environment Variables

```bash
# Database
NEON_DATABASE_URL=postgresql://...

# OpenAI
OPENAI_API_KEY=sk-...

# Authentication
AUTH0_DOMAIN=your-domain.auth0.com
AUTH0_CLIENT_ID=your-client-id
AUTH0_CLIENT_SECRET=your-client-secret

# Application
NODE_ENV=production
NETLIFY_DEV=false
```

### Deployment Steps

1. **Database Setup**: Create PostgreSQL database and run schema migrations
2. **Environment Configuration**: Set up environment variables
3. **API Deployment**: Deploy Netlify functions
4. **Frontend Deployment**: Deploy React application
5. **Testing**: Run integration tests and user acceptance testing

## Performance Optimization

### Database Optimization
- **Indexing**: Full-text search indexes on document content and summaries
- **Connection Pooling**: Efficient database connection management
- **Query Optimization**: Optimized queries for document search and retrieval

### Caching Strategy
- **Document Caching**: Cache frequently accessed documents
- **Summary Caching**: Cache AI-generated summaries
- **Search Results**: Cache search results for common queries

### API Optimization
- **Rate Limiting**: Prevent API abuse and ensure fair usage
- **Response Compression**: Compress large responses
- **Async Processing**: Background processing for document indexing

## Monitoring and Analytics

### Usage Analytics
- **Document Access**: Track which documents are accessed most frequently
- **Chat Patterns**: Analyze common questions and document usage
- **User Behavior**: Understand how users interact with the system

### Performance Monitoring
- **Response Times**: Monitor API response times
- **Error Rates**: Track and alert on error rates
- **Resource Usage**: Monitor database and API usage

### Business Intelligence
- **Document Utilization**: Identify underutilized documents
- **Summary Effectiveness**: Compare AI vs manual summary usage
- **User Engagement**: Track user engagement and feature adoption

## Future Enhancements

### Planned Features
- **Multi-Language Support**: Support for documents in multiple languages
- **Advanced Analytics**: Machine learning insights on document usage
- **Collaborative Features**: Team-based document management
- **Mobile App**: Native mobile application for document access

### Integration Opportunities
- **Regulatory Databases**: Integration with FDA, EMA, and other regulatory databases
- **Clinical Trial Systems**: Integration with CTMS and EDC systems
- **Quality Management**: Integration with QMS and CAPA systems
- **Training Systems**: Integration with learning management systems

## Support and Maintenance

### Documentation
- **API Documentation**: Comprehensive API reference
- **User Guides**: Step-by-step user documentation
- **Developer Guides**: Technical documentation for developers
- **Troubleshooting**: Common issues and solutions

### Support Channels
- **Technical Support**: Email and ticketing system
- **User Training**: Video tutorials and training materials
- **Community Forum**: User community for questions and sharing
- **Regular Updates**: Monthly feature updates and improvements

This enhanced document chat system provides a comprehensive solution for pharmaceutical document management with AI-powered insights, manual summary capabilities, and seamless document access within the chat interface.

