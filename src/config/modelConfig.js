import { isStorageAvailable } from '../utils/storageUtils';

export const MODEL_STORAGE_KEY = 'acceleraqa_ai_model';
export const MODEL_OPTIONS = ['gpt-5o', 'gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'];
export const DEFAULT_MODEL = 'gpt-4o-mini';

export function getCurrentModel() {
  try {
    if (typeof localStorage !== 'undefined' && isStorageAvailable()) {
      return localStorage.getItem(MODEL_STORAGE_KEY) || DEFAULT_MODEL;
    }
  } catch (error) {
    console.warn('Model config read failed:', error);
  }
  return DEFAULT_MODEL;
}

export function setCurrentModel(model) {
  if (!MODEL_OPTIONS.includes(model)) return;
  try {
    if (typeof localStorage !== 'undefined' && isStorageAvailable()) {
      localStorage.setItem(MODEL_STORAGE_KEY, model);
    }
  } catch (error) {
    console.warn('Model config write failed:', error);
  }
}
