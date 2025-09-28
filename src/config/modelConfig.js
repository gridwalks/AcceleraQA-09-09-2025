import { isStorageAvailable } from '../utils/storageUtils';

export const MODEL_STORAGE_KEY = 'acceleraqa_ai_model';

export const MODEL_OPTIONS = ['gpt-4o'];

export const DEFAULT_MODEL = 'gpt-4o';

export function getCurrentModel() {
  try {
    if (typeof localStorage !== 'undefined' && isStorageAvailable()) {
      const storedModel = localStorage.getItem(MODEL_STORAGE_KEY);
      if (storedModel && MODEL_OPTIONS.includes(storedModel)) {
        return storedModel;
      }
      if (storedModel) {
        localStorage.removeItem(MODEL_STORAGE_KEY);
      }
      return DEFAULT_MODEL;
    }
  } catch (error) {
    console.warn('Model config read failed:', error);
  }
  return DEFAULT_MODEL;
}

export function setCurrentModel() {
  console.warn('setCurrentModel is deprecated. Model selection is fixed to the default.');
}
