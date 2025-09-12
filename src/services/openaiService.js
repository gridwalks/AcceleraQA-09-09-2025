import { OPENAI_CONFIG, ERROR_MESSAGES } from '../config/constants';
import { generateResources } from '../utils/resourceGenerator';
import { getCurrentModel } from '../config/modelConfig';

class OpenAIService {
  constructor() {
    this.apiKey = process.env.REACT_APP_OPENAI_API_KEY;
    this.baseUrl = 'https://api.openai.com/v1';
  }

  validateApiKey() {
    if (!this.apiKey) {
      throw new Error(ERROR_MESSAGES.API_KEY_NOT_CONFIGURED);
    }
  }

  async makeRequest(endpoint, options = {}, tokenCount = 0) {
    this.validateApiKey();

    const defaultOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      ...options,
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
        throw new Error(ERROR_MESSAGES.INVALID_API_KEY);
      case 402:
        throw new Error(ERROR_MESSAGES.QUOTA_EXCEEDED);
      case 429: {
        const msg = typeof ERROR_MESSAGES.RATE_LIMIT_EXCEEDED === 'function'
          ? ERROR_MESSAGES.RATE_LIMIT_EXCEEDED(tokenCount)
          : ERROR_MESSAGES.RATE_LIMIT_EXCEEDED;
        throw new Error(msg);
      }
      default:
        throw new Error(`OpenAI API error: ${response.status} ${errorMessage}`);
    }
  }

  createChatPayload(message, model = getCurrentModel()) {
    return {
      model,
      messages: [
        { role: 'system', content: OPENAI_CONFIG.SYSTEM_PROMPT },
        { role: 'user', content: message },
      ],
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

  async getChatResponse(message, documentContent = '', model = getCurrentModel()) {
    if ((!message || typeof message !== 'string' || message.trim().length === 0) && !documentContent) {
      throw new Error('Invalid message provided');
    }

    const combinedMessage = documentContent
      ? `${message}\n\nDocument Content:\n${documentContent}`
      : message;

    const payload = this.createChatPayload(combinedMessage, model);
    const tokenCount = this.estimateTokens(payload);

    try {
      const data = await this.makeRequest(
        '/chat/completions',
        { body: JSON.stringify(payload) },
        tokenCount
      );

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response generated');
      }

      const aiResponse = data.choices[0].message?.content;
      if (!aiResponse) {
        throw new Error('Empty response generated');
      }

      // Generate relevant resources based on the response content
      const resources = generateResources(message, aiResponse);

      return {
        answer: aiResponse,
        resources,
        usage: data.usage || null,
      };
    } catch (error) {
      console.error('OpenAI API Error:', error);
      throw error;
    }
  }

  async generateStudyNotes(selectedMessages) {
    if (!selectedMessages || selectedMessages.length === 0) {
      throw new Error('No messages selected for study notes generation');
    }

    console.log('Generating study notes for messages:', selectedMessages);

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
      throw new Error('No valid conversation pairs found for study notes generation');
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

    const studyPrompt = `Create comprehensive study notes for pharmaceutical quality and compliance based on the following conversation topics. 

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

    return await this.getChatResponse(studyPrompt);
  }
}

// Create singleton instance
const openAIService = new OpenAIService();

export default openAIService;

// Export convenience function for backward compatibility
export const getChatGPTResponse = async (message, documentContent = '') => {
  return await openAIService.getChatResponse(message, documentContent);
};
