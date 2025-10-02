# Chat History Feature

## Overview

The Chat History feature allows users to capture and save their chat conversations for later reference. These saved chat histories appear in the Resource Center alongside other learning resources, making them easily accessible for review and study.

## Features

### 1. Chat Capture
- **Manual Capture**: Users can manually save their current chat session using the "Save Current Chat" button in the Resource Center
- **Automatic Title Generation**: The system automatically generates meaningful titles from the conversation content
- **Custom Titles**: Users can provide custom titles when saving chats
- **Conversation Processing**: Messages are automatically combined into logical conversation pairs (user question + AI response)

### 2. Storage and Management
- **Local Storage**: Chat histories are stored in the browser's localStorage for persistence
- **User-Specific**: Each user's chat histories are kept separate using their user ID
- **Storage Limits**: Maximum of 50 chat histories per user to prevent storage bloat
- **Automatic Cleanup**: Oldest histories are removed when the limit is reached

### 3. Resource Center Integration
- **Dedicated Section**: Chat histories have their own collapsible section in the Resource Center
- **Search Functionality**: Users can search through their chat histories by title or content
- **Resource Format**: Chat histories are displayed as resource cards with metadata (capture date, message count, etc.)
- **Add to Notebook**: Chat histories can be added to the notebook like other resources

### 4. History Management
- **View Details**: Click on any chat history to view its full content
- **Delete Histories**: Remove unwanted chat histories with confirmation
- **Edit Titles**: Update chat history titles (future enhancement)
- **Export Options**: Export chat histories for offline use (future enhancement)

## Implementation Details

### Core Components

#### ChatHistoryService (`src/services/chatHistoryService.js`)
- Main service class handling all chat history operations
- Methods for capturing, storing, retrieving, and managing chat histories
- Automatic title generation and conversation summarization
- Storage management with size limits and cleanup

#### ResourcesView Integration (`src/components/ResourcesView.js`)
- Added chat history section to the Resource Center
- Chat history loading and filtering
- Integration with existing resource management system
- Custom ChatHistoryCard component for display

#### Storage Structure
```javascript
{
  id: 'history_timestamp_randomId',
  title: 'Generated or custom title',
  capturedAt: '2024-01-01T10:00:00Z',
  userId: 'user-sub-id',
  messageCount: 4,
  conversationCount: 2,
  conversations: [
    {
      id: 'combined-id',
      userContent: 'User question',
      aiContent: 'AI response',
      timestamp: '2024-01-01T10:00:00Z',
      resources: [...] // Any attached resources
    }
  ],
  metadata: {
    captureSource: 'manual',
    userAgent: 'browser-info',
    version: '1.0.0'
  }
}
```

### User Interface

#### Chat History Section in Resource Center
- **Header**: Shows "Chat Histories" with count badge
- **Capture Button**: "Save Current Chat" button (only visible when there are messages)
- **Search Bar**: Filter chat histories by title or content
- **History Cards**: Display each saved chat with:
  - Title and description/summary
  - Capture date and time
  - Message and conversation counts
  - Action buttons (view, add to notebook, delete)

#### Chat History Card Features
- **Visual Design**: Green-themed to distinguish from other resources
- **Metadata Display**: Shows capture date, message count, conversation count
- **Interactive Elements**: Hover effects, click to view, action buttons
- **Accessibility**: Proper ARIA labels and keyboard navigation

## Usage Instructions

### For Users

1. **Saving a Chat**:
   - Have an active conversation in the chat area
   - Open the Resource Center sidebar
   - Expand the "Chat Histories" section
   - Click "Save Current Chat"
   - Optionally provide a custom title
   - The chat is now saved and appears in the list

2. **Viewing Saved Chats**:
   - Open the Resource Center
   - Expand "Chat Histories" section
   - Click on any chat history card to view details
   - Use the search bar to find specific chats

3. **Managing Chat Histories**:
   - Delete unwanted chats using the trash icon
   - Add important chats to your notebook using the bookmark icon
   - Search through your chat collection

### For Developers

1. **Service Usage**:
```javascript
import chatHistoryService from '../services/chatHistoryService';

// Capture current chat
const historyEntry = chatHistoryService.captureCurrentChat(messages, user, customTitle);

// Get all histories for user
const histories = chatHistoryService.getAllHistories(userId);

// Convert to resource format
const resource = chatHistoryService.historyToResource(historyEntry);
```

2. **Component Integration**:
```javascript
// Pass messages to ResourcesView
<ResourcesView
  currentResources={resources}
  user={user}
  messages={messages} // Required for chat history functionality
  onSuggestionsUpdate={handleSuggestionsUpdate}
  onAddResource={handleAddResource}
/>
```

## Technical Considerations

### Performance
- **Lazy Loading**: Chat histories are only loaded when the user expands the section
- **Efficient Storage**: Only essential conversation data is stored
- **Memory Management**: Automatic cleanup of old histories to prevent storage bloat

### Security
- **User Isolation**: Each user's chat histories are completely separate
- **No Server Storage**: All data is stored locally in the browser
- **Data Validation**: Input validation and sanitization for all stored data

### Browser Compatibility
- **localStorage Support**: Requires modern browsers with localStorage support
- **Graceful Degradation**: Feature is disabled if localStorage is not available
- **Error Handling**: Comprehensive error handling for storage operations

## Future Enhancements

1. **Cloud Sync**: Sync chat histories across devices using backend storage
2. **Export Features**: Export chat histories to PDF, Word, or other formats
3. **Advanced Search**: Full-text search with filters and sorting options
4. **Chat Organization**: Folders, tags, and categories for better organization
5. **Sharing**: Share chat histories with other users or teams
6. **Analytics**: Usage statistics and insights about chat patterns
7. **Integration**: Integration with external note-taking or documentation systems

## Testing

The feature includes comprehensive unit tests covering:
- Chat capture functionality
- Title generation algorithms
- Storage operations (save, load, delete)
- Resource format conversion
- Error handling scenarios

Run tests with:
```bash
npm test -- --testPathPattern=chatHistoryService.test.js
```

## Troubleshooting

### Common Issues

1. **Chat Not Saving**:
   - Check if localStorage is available and not full
   - Ensure user is authenticated
   - Verify there are messages in the current chat

2. **Histories Not Loading**:
   - Check browser console for errors
   - Verify localStorage permissions
   - Clear browser cache if necessary

3. **Storage Full**:
   - Delete old chat histories
   - Check storage usage in browser settings
   - Consider exporting important chats before deletion

### Debug Information

The service provides storage information:
```javascript
const info = chatHistoryService.getStorageInfo();
console.log('Storage usage:', info);
```

## Conclusion

The Chat History feature enhances the AcceleraQA application by providing users with a way to preserve and revisit their valuable conversations. By integrating seamlessly with the existing Resource Center, it maintains consistency with the application's design while adding powerful new functionality for learning and reference.
