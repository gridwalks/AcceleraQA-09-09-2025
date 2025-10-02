// Chat History Service Tests
import chatHistoryService from './chatHistoryService';

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
global.localStorage = localStorageMock;

describe('ChatHistoryService', () => {
  const mockUser = { sub: 'test-user-123' };
  const mockMessages = [
    {
      id: 'msg1',
      type: 'user',
      role: 'user',
      content: 'What is quality assurance?',
      timestamp: '2024-01-01T10:00:00Z',
      isCurrent: true,
      isStored: false
    },
    {
      id: 'msg2',
      type: 'ai',
      role: 'assistant',
      content: 'Quality assurance is a systematic process...',
      timestamp: '2024-01-01T10:00:30Z',
      isCurrent: true,
      isStored: false
    }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  describe('captureCurrentChat', () => {
    it('should capture chat messages successfully', () => {
      const result = chatHistoryService.captureCurrentChat(mockMessages, mockUser);
      
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('capturedAt');
      expect(result.userId).toBe(mockUser.sub);
      expect(result.messageCount).toBe(2);
      expect(result.conversationCount).toBe(1);
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });

    it('should throw error when no messages provided', () => {
      expect(() => {
        chatHistoryService.captureCurrentChat([], mockUser);
      }).toThrow('No messages to capture');
    });

    it('should throw error when no user provided', () => {
      expect(() => {
        chatHistoryService.captureCurrentChat(mockMessages, null);
      }).toThrow('User authentication required');
    });
  });

  describe('generateTitle', () => {
    it('should generate title from user content', () => {
      const conversation = {
        userContent: 'What is quality assurance in pharmaceuticals?',
        aiContent: 'Quality assurance in pharmaceuticals...'
      };
      
      const title = chatHistoryService.generateTitle(conversation);
      expect(title).toBe('What is quality assurance in pharmaceuticals?');
    });

    it('should truncate long user content', () => {
      const conversation = {
        userContent: 'This is a very long question about quality assurance that exceeds the normal length limit and should be truncated',
        aiContent: 'Response...'
      };
      
      const title = chatHistoryService.generateTitle(conversation);
      expect(title).toContain('...');
      expect(title.length).toBeLessThanOrEqual(50);
    });

    it('should use AI content as fallback', () => {
      const conversation = {
        userContent: '',
        aiContent: 'Here is some information about quality assurance'
      };
      
      const title = chatHistoryService.generateTitle(conversation);
      expect(title).toContain('Response:');
    });

    it('should return default title for empty conversation', () => {
      const title = chatHistoryService.generateTitle(null);
      expect(title).toBe('Untitled Chat');
    });
  });

  describe('getAllHistories', () => {
    it('should return empty array when no histories exist', () => {
      localStorageMock.getItem.mockReturnValue(null);
      
      const histories = chatHistoryService.getAllHistories();
      expect(histories).toEqual([]);
    });

    it('should return filtered histories for specific user', () => {
      const mockHistories = [
        { id: 'hist1', userId: 'user1', title: 'History 1' },
        { id: 'hist2', userId: 'user2', title: 'History 2' },
        { id: 'hist3', userId: 'user1', title: 'History 3' }
      ];
      
      localStorageMock.getItem.mockReturnValue(JSON.stringify(mockHistories));
      
      const userHistories = chatHistoryService.getAllHistories('user1');
      expect(userHistories).toHaveLength(2);
      expect(userHistories.every(h => h.userId === 'user1')).toBe(true);
    });
  });

  describe('deleteHistory', () => {
    it('should delete history successfully', () => {
      const mockHistories = [
        { id: 'hist1', title: 'History 1' },
        { id: 'hist2', title: 'History 2' }
      ];
      
      localStorageMock.getItem.mockReturnValue(JSON.stringify(mockHistories));
      
      const result = chatHistoryService.deleteHistory('hist1');
      expect(result).toBe(true);
      
      // Check that setItem was called with filtered histories
      const setItemCall = localStorageMock.setItem.mock.calls[0];
      const updatedHistories = JSON.parse(setItemCall[1]);
      expect(updatedHistories).toHaveLength(1);
      expect(updatedHistories[0].id).toBe('hist2');
    });
  });

  describe('historyToResource', () => {
    it('should convert history to resource format', () => {
      const mockHistory = {
        id: 'hist1',
        title: 'Test History',
        capturedAt: '2024-01-01T10:00:00Z',
        messageCount: 5,
        conversationCount: 2,
        conversations: [
          { userContent: 'Question 1', aiContent: 'Answer 1' }
        ],
        metadata: { captureSource: 'manual' }
      };
      
      const resource = chatHistoryService.historyToResource(mockHistory);
      
      expect(resource.id).toBe('hist1');
      expect(resource.title).toBe('Test History');
      expect(resource.type).toBe('Chat History');
      expect(resource.metadata.messageCount).toBe(5);
      expect(resource.metadata.conversationCount).toBe(2);
      expect(resource.tag).toBe('history');
    });
  });

  describe('getConversationSummary', () => {
    it('should generate summary from conversations', () => {
      const conversations = [
        {
          userContent: 'What is GMP?',
          aiContent: 'Good Manufacturing Practice (GMP) is a system...'
        }
      ];
      
      const summary = chatHistoryService.getConversationSummary(conversations);
      expect(summary).toContain('Q: What is GMP?');
      expect(summary).toContain('A: Good Manufacturing Practice');
    });

    it('should handle multiple conversations', () => {
      const conversations = [
        { userContent: 'Question 1', aiContent: 'Answer 1' },
        { userContent: 'Question 2', aiContent: 'Answer 2' }
      ];
      
      const summary = chatHistoryService.getConversationSummary(conversations);
      expect(summary).toContain('+1 more exchanges');
    });

    it('should return default for empty conversations', () => {
      const summary = chatHistoryService.getConversationSummary([]);
      expect(summary).toBe('Empty conversation');
    });
  });

  describe('getStorageInfo', () => {
    it('should return storage information', () => {
      const mockHistories = [
        { id: 'hist1', title: 'History 1' },
        { id: 'hist2', title: 'History 2' }
      ];
      
      localStorageMock.getItem.mockReturnValue(JSON.stringify(mockHistories));
      
      const info = chatHistoryService.getStorageInfo();
      expect(info.count).toBe(2);
      expect(info.maxCount).toBe(50);
      expect(info).toHaveProperty('storageSize');
      expect(info).toHaveProperty('storageSizeFormatted');
    });
  });
});
