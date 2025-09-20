// src/services/trainingResourceService.js - Lightweight helper replacing Neon-based storage

class TrainingResourceService {
  constructor() {
    this.storageKey = 'trainingResources';
  }

  /**
   * Load external resources from localStorage
   * @returns {Promise<Array>} array of resources
   */
  async getTrainingResources() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      console.error('Failed to load external resources from storage:', error);
      return [];
    }
  }

  /**
   * Synchronously load external resources from localStorage
   * @returns {Array} array of resources
   */
  getTrainingResourcesSync() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      console.error('Failed to load external resources from storage:', error);
      return [];
    }
  }

  /**
   * Add an external resource to localStorage
   * @param {Object} resource resource data
   * @returns {Promise<Object>} newly stored resource with id
   */
  async addTrainingResource(resource) {
    try {
      const resources = await this.getTrainingResources();
      const newResource = { id: Date.now().toString(), ...resource };
      resources.unshift(newResource);
      localStorage.setItem(this.storageKey, JSON.stringify(resources));
      return newResource;
    } catch (error) {
      console.error('Failed to save external resource:', error);
      throw error;
    }
  }
}

const trainingResourceService = new TrainingResourceService();
export default trainingResourceService;
