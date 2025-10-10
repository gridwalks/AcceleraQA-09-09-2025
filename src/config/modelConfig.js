import { isStorageAvailable } from '../utils/storageUtils';

export const MODEL_STORAGE_KEY = 'acceleraqa_ai_model';
export const PROVIDER_STORAGE_KEY = 'acceleraqa_model_provider';

export const MODEL_OPTIONS = ['gpt-4o', 'llama-3.3-70b-versatile'];
export const PROVIDER_OPTIONS = ['openai', 'groq'];

export const DEFAULT_MODEL = 'gpt-4o';
export const DEFAULT_PROVIDER = 'openai';

export const OPENAI_MODEL = 'gpt-4o';
export const GROQ_MODEL = 'llama-3.3-70b-versatile';

export function getCurrentModel() {
  // Use provider-based model selection
  return getCurrentModelForProvider();
}

export function getModelProvider() {
  try {
    if (typeof localStorage !== 'undefined' && isStorageAvailable()) {
      const storedProvider = localStorage.getItem(PROVIDER_STORAGE_KEY);
      if (storedProvider && PROVIDER_OPTIONS.includes(storedProvider)) {
        return storedProvider;
      }
      if (storedProvider) {
        localStorage.removeItem(PROVIDER_STORAGE_KEY);
      }
      return DEFAULT_PROVIDER;
    }
  } catch (error) {
    console.warn('Provider config read failed:', error);
  }
  return DEFAULT_PROVIDER;
}

export function setModelProvider(provider) {
  try {
    if (typeof localStorage !== 'undefined' && isStorageAvailable()) {
      if (PROVIDER_OPTIONS.includes(provider)) {
        localStorage.setItem(PROVIDER_STORAGE_KEY, provider);
        
        // Update model based on provider
        const model = provider === 'openai' ? OPENAI_MODEL : GROQ_MODEL;
        localStorage.setItem(MODEL_STORAGE_KEY, model);
        
        console.log(`Model provider set to: ${provider}, model: ${model}`);
        return true;
      } else {
        console.warn('Invalid provider:', provider);
        return false;
      }
    } else {
      console.warn('localStorage not available or storage check failed');
      return false;
    }
  } catch (error) {
    console.warn('Provider config write failed:', error);
    return false;
  }
}

export function getCurrentModelForProvider() {
  const provider = getModelProvider();
  return provider === 'openai' ? OPENAI_MODEL : GROQ_MODEL;
}

export function setCurrentModel() {
  console.warn('setCurrentModel is deprecated. Use setModelProvider() instead.');
}
