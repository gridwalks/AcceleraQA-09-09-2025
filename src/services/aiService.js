import openaiService from './openaiService';
import groqService from './groqService';
import { getModelProvider, getCurrentModelForProvider } from '../config/modelConfig';

class AIService {
  constructor() {
    this.providers = {
      openai: openaiService,
      groq: groqService
    };
  }

  getCurrentProvider() {
    const provider = getModelProvider();
    return this.providers[provider] || this.providers.openai;
  }

  async getChatResponse(message, documentFile = null, history = [], model = null, existingVectorStoreId = null) {
    const provider = this.getCurrentProvider();
    const currentModel = model || getCurrentModelForProvider();
    
    console.log(`Using AI provider: ${getModelProvider()}, model: ${currentModel}`);
    
    return await provider.getChatResponse(
      message,
      documentFile,
      history,
      currentModel,
      existingVectorStoreId
    );
  }

  async generateStudyNotes(selectedMessages) {
    const provider = this.getCurrentProvider();
    return await provider.generateStudyNotes(selectedMessages);
  }

  // Convenience method to get current provider info
  getProviderInfo() {
    const provider = getModelProvider();
    const model = getCurrentModelForProvider();
    
    return {
      provider,
      model,
      providerName: provider === 'openai' ? 'OpenAI' : 'Groq',
      modelName: provider === 'openai' ? 'GPT-4o' : 'GPT OSS 20b (Llama 3.3 70B)'
    };
  }

  // Method to test provider connection
  async testConnection() {
    const provider = this.getCurrentProvider();
    const providerName = getModelProvider();
    
    try {
      // Test with a simple message
      const response = await provider.getChatResponse('Hello, this is a test message.');
      return {
        success: true,
        provider: providerName,
        response: response.answer?.substring(0, 100) + '...'
      };
    } catch (error) {
      return {
        success: false,
        provider: providerName,
        error: error.message
      };
    }
  }
}

// Create singleton instance
const aiService = new AIService();

export default aiService;

// Export convenience functions for backward compatibility
export const getChatGPTResponse = async (message, documentContent = '') => {
  return await aiService.getChatResponse(message, documentContent, []);
};

export const getAIChatResponse = async (message, documentFile = null, history = [], model = null, existingVectorStoreId = null) => {
  return await aiService.getChatResponse(message, documentFile, history, model, existingVectorStoreId);
};
