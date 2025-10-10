import { OPENAI_CONFIG, ERROR_MESSAGES } from '../config/constants';
import { generateResources } from '../utils/resourceGenerator';
import { recordTokenUsage } from '../utils/tokenUsage';
import { convertDocxToPdfIfNeeded } from '../utils/fileConversion';
import ragService from './ragService';

class GroqService {
  constructor() {
    this.apiKey = process.env.REACT_APP_GROQ_API_KEY || process.env.GROQ_API_KEY;
    this.baseUrl = 'https://api.groq.com/openai/v1';
    this.model = 'llama-3.3-70b-versatile';
  }

  validateApiKey() {
    if (!this.apiKey) {
      throw new Error(ERROR_MESSAGES.GROQ_API_KEY_NOT_CONFIGURED);
    }
  }

  async makeRequest(endpoint, options = {}, tokenCount = 0) {
    this.validateApiKey();

    const defaultOptions = {
      method: 'POST',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...(options.headers || {}),
      },
    };

    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}${endpoint}`, { ...defaultOptions });

        // Handle rate limit with retries (exponential backoff)
        if (response.status === 429 && attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        if (!response.ok) {
          await this.handleApiError(response, tokenCount);
        }

        return await response.json();
      } catch (error) {
        // Network-level fetch failures (e.g., CORS or connectivity)
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
          throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
        }
        throw error;
      }
    }

    // Final failure after retries
    const finalMsg = typeof ERROR_MESSAGES.RATE_LIMIT_EXCEEDED === 'function'
      ? ERROR_MESSAGES.RATE_LIMIT_EXCEEDED(tokenCount)
      : ERROR_MESSAGES.RATE_LIMIT_EXCEEDED;

    throw new Error(finalMsg);
  }

  async handleApiError(response, tokenCount = 0) {
    let errorData = {};
    try {
      errorData = await response.json();
    } catch {
      // ignore parse errors; fall back to generic message
    }

    const errorMessage = errorData.error?.message || 'Unknown error';

    switch (response.status) {
      case 401:
        throw new Error(ERROR_MESSAGES.GROQ_INVALID_API_KEY);
      case 402:
        throw new Error(ERROR_MESSAGES.QUOTA_EXCEEDED);
      case 429: {
        const msg = typeof ERROR_MESSAGES.RATE_LIMIT_EXCEEDED === 'function'
          ? ERROR_MESSAGES.RATE_LIMIT_EXCEEDED(tokenCount)
          : ERROR_MESSAGES.RATE_LIMIT_EXCEEDED;
        throw new Error(msg);
      }
      default:
        throw new Error(`Groq API error: ${response.status} ${errorMessage}`);
    }
  }

  normalizeHistory(history) {
    if (!Array.isArray(history)) {
      return [];
    }

    return history
      .map(item => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        if (item.isResource || item.isStudyNotes || item.isLocalOnly) {
          return null;
        }

        const role = item.role || (item.type === 'ai' ? 'assistant' : item.type === 'user' ? 'user' : null);
        if (role !== 'user' && role !== 'assistant') {
          return null;
        }

        let content = item.content;
        if (Array.isArray(content)) {
          content = content.join(' ');
        } else if (content == null) {
          content = '';
        } else if (typeof content !== 'string') {
          content = String(content);
        }

        if (typeof content !== 'string' || content.trim().length === 0) {
          return null;
        }

        return { role, content };
      })
      .filter(Boolean);
  }

  createChatPayload(message, history = []) {
    const normalizedHistory = this.normalizeHistory(history);

    const messages = [
      { role: 'system', content: OPENAI_CONFIG.SYSTEM_PROMPT },
      ...normalizedHistory.map(item => ({ role: item.role, content: item.content })),
    ];

    if (typeof message === 'string' && message.trim().length > 0) {
      messages.push({ role: 'user', content: message });
    }

    return {
      model: this.model,
      messages,
      max_tokens: OPENAI_CONFIG.MAX_TOKENS,
      temperature: OPENAI_CONFIG.TEMPERATURE,
    };
  }

  estimateTokens(payload) {
    const messageTokens = payload.messages.reduce((sum, msg) => {
      return sum + msg.content.split(/\s+/).filter(Boolean).length;
    }, 0);
    return messageTokens + (payload.max_tokens || 0);
  }

  async extractTextFromFile(file) {
    // Use ragService to extract text from files
    return await ragService.extractTextFromFile(file);
  }

  async extractTextFromMultipleFiles(files) {
    if (!Array.isArray(files) || files.length === 0) {
      return null;
    }
    
    const fileContents = [];
    
    for (const file of files) {
      try {
        const text = await this.extractTextFromFile(file);
        if (text && text.trim().length > 0) {
          fileContents.push({
            filename: file.name,
            content: text.trim()
          });
        }
      } catch (error) {
        console.error(`Failed to extract text from ${file.name}:`, error);
        fileContents.push({
          filename: file.name,
          content: `[Unable to extract text from this file: ${error.message}]`
        });
      }
    }
    
    if (fileContents.length === 0) {
      return null;
    }
    
    // Format multiple files with clear separators
    return fileContents.map(fc => 
      `\n\n=== FILE: ${fc.filename} ===\n${fc.content}\n=== END OF FILE: ${fc.filename} ===`
    ).join('\n');
  }

  async getChatResponse(
    message,
    documentFile = null,
    history = [],
    model = this.model,
    existingVectorStoreId = null
  ) {
    if ((!message || typeof message !== 'string' || message.trim().length === 0) && !documentFile) {
      throw new Error('Invalid message provided');
    }

    const normalizedHistory = this.normalizeHistory(history);
    const hasDocumentString = typeof documentFile === 'string' && documentFile.trim().length > 0;
    const userPrompt = hasDocumentString
      ? `${message}\n\nDocument Content:\n${documentFile}`
      : message;

    const baseInput = [
      {
        role: 'system',
        content: OPENAI_CONFIG.SYSTEM_PROMPT,
      },
      ...normalizedHistory.map(item => ({
        role: item.role,
        content: item.content,
      })),
    ];

    let requestBody = {
      model: this.model,
      messages: [
        ...baseInput,
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      max_tokens: OPENAI_CONFIG.MAX_TOKENS,
      temperature: OPENAI_CONFIG.TEMPERATURE,
    };

    // Note: Groq doesn't support file uploads or vector stores like OpenAI
    // For document files, we'll extract text and include it in the message
    const isFile = documentFile && typeof documentFile === 'object' && 'name' in documentFile;
    const isMultipleFiles = Array.isArray(documentFile) && documentFile.length > 0;
    
    let documentContent = null;
    
    if (isMultipleFiles) {
      // Handle array of files
      documentContent = await this.extractTextFromMultipleFiles(documentFile);
    } else if (isFile) {
      // Handle single file
      try {
        const text = await this.extractTextFromFile(documentFile);
        if (text && text.trim().length > 0) {
          documentContent = `\n\n=== FILE: ${documentFile.name} ===\n${text.trim()}\n=== END OF FILE: ${documentFile.name} ===`;
        }
      } catch (error) {
        console.error('Failed to extract text from file:', error);
        documentContent = `\n\n[Note: Unable to extract text from ${documentFile.name}: ${error.message}]`;
      }
    }
    
    // Update the message content with document content
    if (documentContent) {
      requestBody.messages[requestBody.messages.length - 1].content = 
        `${userPrompt}${documentContent}`;
    }

    const payloadForTokens = this.createChatPayload(userPrompt, normalizedHistory);
    const tokenCount = this.estimateTokens(payloadForTokens);

    try {
      console.info('Sending Groq request payload:', {
        endpoint: '/chat/completions',
        tokenCount,
        body: requestBody,
      });

      const data = await this.makeRequest(
        '/chat/completions',
        {
          body: JSON.stringify(requestBody),
        },
        tokenCount
      );

      const aiResponse = data.choices?.[0]?.message?.content || 'I apologize, but I was unable to generate a response.';

      if (!aiResponse || aiResponse.trim().length === 0) {
        const rawData = typeof data === 'object' ? JSON.stringify(data) : String(data);
        throw new Error(`No response generated. Raw response: ${rawData}`);
      }

      const resources = generateResources(userPrompt, aiResponse);

      if (data.usage?.total_tokens || tokenCount) {
        recordTokenUsage(data.usage?.total_tokens || tokenCount);
      }

      return {
        answer: aiResponse,
        resources,
        usage: data.usage || null,
        vectorStoreId: null, // Groq doesn't support vector stores
      };
    } catch (error) {
      console.error('Groq API Error. Payload sent to Groq:', {
        endpoint: '/chat/completions',
        tokenCount,
        body: requestBody,
        error,
      });
      throw error;
    }
  }

  async generateStudyNotes(selectedMessages) {
    if (!selectedMessages || selectedMessages.length === 0) {
      throw new Error('No messages selected for notes generation');
    }

    console.log('Generating notes for messages:', selectedMessages);

    // Group messages by conversation pairs (user question + AI response)
    const conversationPairs = [];
    let currentPair = {};

    selectedMessages
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .forEach(msg => {
        if (msg.type === 'user') {
          if (currentPair.question || currentPair.answer) {
            conversationPairs.push(currentPair);
          }
          currentPair = { question: msg.content };
        } else if (msg.type === 'ai' && !msg.isStudyNotes) {
          currentPair.answer = msg.content;
          currentPair.resources = msg.resources || [];
        }
      });

    if (currentPair.question || currentPair.answer) {
      conversationPairs.push(currentPair);
    }

    if (conversationPairs.length === 0) {
      throw new Error('No valid conversation pairs found for notes generation');
    }

    const studyContent = conversationPairs
      .map((pair, index) => {
        let content = `\n=== CONVERSATION ${index + 1} ===\n`;
        if (pair.question) content += `QUESTION: ${pair.question}\n\n`;
        if (pair.answer) content += `ANSWER: ${pair.answer}\n`;
        if (pair.resources && pair.resources.length > 0) {
          content += `\nRELATED RESOURCES:\n`;
          content += pair.resources.map(r => `• ${r.title} (${r.type}): ${r.url}`).join('\n');
          content += '\n';
        }
        return content;
      })
      .join('\n');

    const notesPrompt = `Create comprehensive notes for pharmaceutical quality and compliance based on the following conversation topics.

Format as organized study material with:
1. **Executive Summary** - Key takeaways from all conversations
2. **Core Topics Covered** - Main pharmaceutical quality areas discussed
3. **Key Concepts and Definitions** - Important terms and their meanings
4. **Regulatory Requirements** - Specific FDA, ICH, or other regulatory guidance mentioned
5. **Implementation Best Practices** - Practical recommendations from the discussions
6. **Common Pitfalls to Avoid** - Warnings and cautions identified
7. **Study Questions for Review** - Questions to test understanding

Include specific references to FDA, ICH, and other regulatory guidelines where applicable.
Make this comprehensive but well-organized for study purposes.

Number of conversations analyzed: ${conversationPairs.length}

Conversation content:
${studyContent}`;

    return await this.getChatResponse(notesPrompt);
  }
}

// Create singleton instance
const groqService = new GroqService();

export default groqService;

// Export convenience function for backward compatibility
export const getGroqResponse = async (message, documentContent = '') => {
  return await groqService.getChatResponse(message, documentContent, []);
};
