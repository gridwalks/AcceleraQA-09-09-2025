import { OPENAI_CONFIG, ERROR_MESSAGES } from '../config/constants';
import { generateResources } from '../utils/resourceGenerator';
import { getCurrentModel } from '../config/modelConfig';
import { recordTokenUsage } from '../utils/tokenUsage';
import { convertDocxToPdfIfNeeded } from '../utils/fileConversion';

class OpenAIService {
  constructor() {
    this.apiKey = process.env.REACT_APP_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
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
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...(options.headers || {}),
      },
    };

    if (
      endpoint === '/responses' &&
      defaultOptions.body &&
      typeof defaultOptions.body !== 'undefined'
    ) {
      defaultOptions.body = this.sanitizeResponsesRequestBody(defaultOptions.body);
    }

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

  sanitizeResponsesRequestBody(body) {
    if (!body) {
      return body;
    }

    if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        const sanitized = this.sanitizeResponsesPayload(parsed);
        return JSON.stringify(sanitized);
      } catch {
        return body;
      }
    }

    if (typeof body === 'object') {
      // Avoid mutating shared references
      const cloned = Array.isArray(body) ? [...body] : { ...body };
      const sanitized = this.sanitizeResponsesPayload(cloned);
      return JSON.stringify(sanitized);
    }

    return body;
  }

  sanitizeResponsesPayload(payload) {
    if (payload == null) {
      return payload;
    }

    if (Array.isArray(payload)) {
      return payload.map(item => this.sanitizeResponsesPayload(item));
    }

    if (typeof payload !== 'object') {
      return payload;
    }

    const sanitized = { ...payload };

    if ('tool_resources' in sanitized) {
      delete sanitized.tool_resources;
    }

    if ('attachments' in sanitized) {
      delete sanitized.attachments;
    }

    if (Array.isArray(sanitized.content)) {
      sanitized.content = sanitized.content.map(item => this.sanitizeResponsesPayload(item));
    }

    if (Array.isArray(sanitized.input)) {
      sanitized.input = sanitized.input.map(message => this.normalizeResponseMessage(message));
    }

    return sanitized;
  }

  normalizeResponseMessage(message) {
    if (!message || typeof message !== 'object') {
      return message;
    }

    const normalized = { ...message };

    if ('tool_resources' in normalized) {
      delete normalized.tool_resources;
    }

    if ('attachments' in normalized) {
      delete normalized.attachments;
    }

    const normalizePart = (part) => this.normalizeMessageContentPart(part);

    if (Array.isArray(normalized.content)) {
      normalized.content = normalized.content.map(part => normalizePart(part));
    } else if (normalized.content && typeof normalized.content === 'object') {
      normalized.content = [normalizePart(normalized.content)];
    } else if (normalized.content != null) {
      normalized.content = [normalized.content];
    } else {
      normalized.content = [];
    }

    return normalized;
  }

  normalizeMessageContentPart(part) {
    if (!part || typeof part !== 'object') {
      return part;
    }

    const sanitizedPart = { ...part };

    if ('tool_resources' in sanitizedPart) {
      delete sanitizedPart.tool_resources;
    }

    if ('attachments' in sanitizedPart) {
      delete sanitizedPart.attachments;
    }

    if (Array.isArray(sanitizedPart.content)) {
      sanitizedPart.content = sanitizedPart.content.map(item => this.sanitizeResponsesPayload(item));
    }

    if (Array.isArray(sanitizedPart.input)) {
      sanitizedPart.input = sanitizedPart.input.map(item => this.normalizeResponseMessage(item));
    }

    return sanitizedPart;
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

  createContentForRole(role, text) {
    let normalizedText = '';

    if (typeof text === 'string') {
      normalizedText = text;
    } else if (Array.isArray(text)) {
      normalizedText = text.filter(part => typeof part === 'string').join(' ');
    } else if (text != null) {
      normalizedText = String(text);
    }

    const contentType = role === 'assistant' ? 'output_text' : 'input_text';

    if (contentType === 'output_text') {
      return [
        {
          type: 'output_text',
          text: normalizedText,
        },
      ];
    }

    return [
      {
        type: 'input_text',
        text: normalizedText,
      },
    ];
  }

  createChatPayload(message, history = [], model = getCurrentModel()) {
    const normalizedHistory = this.normalizeHistory(history);

    const messages = [
      { role: 'system', content: OPENAI_CONFIG.SYSTEM_PROMPT },
      ...normalizedHistory.map(item => ({ role: item.role, content: item.content })),
    ];

    if (typeof message === 'string' && message.trim().length > 0) {
      messages.push({ role: 'user', content: message });
    }

    return {
      model,
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

  extractTextFromContentItem(item) {
    if (!item) {
      return null;
    }

    if (typeof item === 'string') {
      const trimmed = item.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    if (typeof item.text === 'string') {
      const trimmed = item.text.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }

    if (item?.text?.value && typeof item.text.value === 'string') {
      const trimmed = item.text.value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }

    if (typeof item.value === 'string') {
      const trimmed = item.value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }

    if (typeof item.content === 'string') {
      const trimmed = item.content.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }

    if (Array.isArray(item.text)) {
      const combined = item.text
        .map(part => this.extractTextFromContentItem(part))
        .filter(Boolean)
        .join('\n')
        .trim();

      if (combined.length > 0) {
        return combined;
      }
    }

    if (Array.isArray(item.content)) {
      const combined = item.content
        .map(part => this.extractTextFromContentItem(part))
        .filter(Boolean)
        .join('\n')
        .trim();

      if (combined.length > 0) {
        return combined;
      }
    }

    return null;
  }

  extractTextFromOutput(outputArray) {
    if (!Array.isArray(outputArray)) {
      return null;
    }

    for (const output of outputArray) {
      if (!Array.isArray(output?.content)) {
        continue;
      }

      for (const item of output.content) {
        const text = this.extractTextFromContentItem(item);
        if (text) {
          return text;
        }
      }
    }

    return null;
  }

  extractTextFromChoices(choices) {
    if (!Array.isArray(choices)) {
      return null;
    }

    for (const choice of choices) {
      const messageContent = choice?.message?.content;

      if (typeof messageContent === 'string') {
        const trimmed = messageContent.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }

      if (Array.isArray(messageContent)) {
        const combined = messageContent
          .map(part => this.extractTextFromContentItem(part))
          .filter(Boolean)
          .join('\n')
          .trim();

        if (combined.length > 0) {
          return combined;
        }
      }
    }

    return null;
  }

  async uploadFile(file) {
    const { file: preparedFile, converted } = await convertDocxToPdfIfNeeded(file);

    if (!preparedFile) {
      throw new Error('No file provided for upload.');
    }

    const fileName = preparedFile?.name?.toLowerCase() || '';
    const fileType = preparedFile?.type?.toLowerCase() || '';
    const isPdf = fileName.endsWith('.pdf') || fileType === 'application/pdf';
    const supportedDescription = 'PDF, Word (.docx), Markdown (.md), plain text (.txt), CSV (.csv), or Excel (.xlsx) file.';

    if (!isPdf) {
      if (converted) {
        throw new Error(`Converted file is not a valid PDF. Please upload a ${supportedDescription}`);
      }
      throw new Error(`Unsupported file type; please upload a ${supportedDescription}`);
    }

    const formData = new FormData();
    formData.append('file', preparedFile);
    formData.append('purpose', 'assistants');

    const response = await fetch(`${this.baseUrl}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'OpenAI-Beta': 'assistants=v2',
      },
      body: formData,
    });

    if (!response.ok) {
      await this.handleApiError(response);
    }

    const data = await response.json();
    return data.id;
  }

  async createVectorStore() {
    const response = await fetch(`${this.baseUrl}/vector_stores`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'OpenAI-Beta': 'assistants=v2',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      await this.handleApiError(response);
    }

    const data = await response.json();
    return data.id;
  }

  async attachFileToVectorStore(vectorStoreId, fileId) {
    const response = await fetch(`${this.baseUrl}/vector_stores/${vectorStoreId}/files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'OpenAI-Beta': 'assistants=v2',
      },
      body: JSON.stringify({ file_id: fileId }),
    });

    if (!response.ok) {
      await this.handleApiError(response);
    }

    return await response.json();
  }

  async getChatResponse(
    message,
    documentFile = null,
    history = [],
    model = getCurrentModel(),
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
        content: this.createContentForRole('system', OPENAI_CONFIG.SYSTEM_PROMPT),
      },
      ...normalizedHistory.map(item => ({
        role: item.role,
        content: this.createContentForRole(item.role, item.content),
      })),
    ];

    let requestBody = {
      model,
      input: [
        ...baseInput,
        {
          role: 'user',
          content: this.createContentForRole('user', userPrompt),
        },
      ],
    };

    const isFile = documentFile && typeof documentFile === 'object' && 'name' in documentFile;
    let vectorStoreId = existingVectorStoreId || null;
    let shouldUseVectorStore = false;

    if (isFile) {
      try {
        const fileId = await this.uploadFile(documentFile);
        try {
          if (!vectorStoreId) {
            vectorStoreId = await this.createVectorStore();
          }
          await this.attachFileToVectorStore(vectorStoreId, fileId);
          shouldUseVectorStore = true;
        } catch (vsError) {
          console.error('Vector store setup failed:', vsError);
          throw vsError;
        }
      } catch (error) {
        console.error('File upload failed:', error);
        throw error;
      }
    } else if (vectorStoreId) {
      shouldUseVectorStore = true;
    }

    if (shouldUseVectorStore && vectorStoreId) {
      const fileSearchTool = {
        type: 'file_search',
        vector_store_ids: [vectorStoreId],
      };

      requestBody = {
        model,
        input: [
          ...baseInput,
          {
            role: 'user',
            content: this.createContentForRole('user', message || ''),
          },
        ],
        tools: [fileSearchTool],
      };
    }

    const payloadForTokens = this.createChatPayload(userPrompt, normalizedHistory, model);
    const tokenCount = this.estimateTokens(payloadForTokens);

    const sanitizedRequestBody = this.sanitizeResponsesPayload(requestBody);

    try {
      console.info('Sending ChatGPT request payload:', {
        endpoint: '/responses',
        tokenCount,
        body: sanitizedRequestBody,
      });

      const data = await this.makeRequest(
        '/responses',
        {
          body: JSON.stringify(sanitizedRequestBody),
        },
        tokenCount
      );

      const outputArrayText = this.extractTextFromOutput(data.output);
      const choicesText = this.extractTextFromChoices(data.choices);

      const candidateTexts = [];

      if (typeof data.output_text === 'string' && data.output_text.trim().length > 0) {
        candidateTexts.push(data.output_text.trim());
      }

      if (outputArrayText) {
        candidateTexts.push(outputArrayText);
      }

      if (choicesText) {
        candidateTexts.push(choicesText);
      }

      const aiResponse = candidateTexts.find(text => typeof text === 'string' && text.trim().length > 0) || null;

      if (!aiResponse) {
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
        vectorStoreId: shouldUseVectorStore && vectorStoreId ? vectorStoreId : null,
      };
    } catch (error) {
      console.error('OpenAI API Error. Payload sent to ChatGPT:', {
        endpoint: '/responses',
        tokenCount,
        body: sanitizedRequestBody,
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
const openAIService = new OpenAIService();

export default openAIService;

// Export convenience function for backward compatibility
export const getChatGPTResponse = async (message, documentContent = '') => {
  return await openAIService.getChatResponse(message, documentContent, []);
};
