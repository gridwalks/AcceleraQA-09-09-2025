// src/services/trainingResourceService.js - Lightweight helper replacing Neon-based storage

const FORM_FIELDS = ['name', 'title', 'url', 'description', 'tag'];

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const resolveResourceId = (resource, fallbackId = null) => {
  if (!resource || typeof resource !== 'object') {
    return fallbackId;
  }

  return (
    resource.id ||
    resource.resourceId ||
    resource.externalId ||
    resource.trainingResourceId ||
    fallbackId
  );
};

class TrainingResourceService {
  constructor() {
    this.storageKey = 'trainingResources';
  }

  normalizeLoadedResources(resources) {
    if (!Array.isArray(resources) || resources.length === 0) {
      return [];
    }

    const normalized = [];
    let shouldPersist = false;
    const timestampBase = Date.now();

    resources.forEach((rawResource, index) => {
      if (!rawResource || typeof rawResource !== 'object') {
        shouldPersist = true;
        return;
      }

      const resource = { ...rawResource };

      const resolvedId = resolveResourceId(resource, `${timestampBase}-${index}`);
      if (resolvedId !== resource.id) {
        resource.id = resolvedId;
        shouldPersist = true;
      }

      const nameCandidate = normalizeString(resource.name) || normalizeString(resource.title);
      if (nameCandidate && nameCandidate !== resource.name) {
        resource.name = nameCandidate;
        shouldPersist = true;
      }

      if (nameCandidate && nameCandidate !== resource.title) {
        resource.title = nameCandidate;
        shouldPersist = true;
      }

      const normalizedUrl = normalizeString(resource.url);
      if (normalizedUrl !== resource.url) {
        resource.url = normalizedUrl;
        shouldPersist = true;
      }

      const normalizedDescription = normalizeString(resource.description);
      if (normalizedDescription !== resource.description) {
        if (normalizedDescription) {
          resource.description = normalizedDescription;
        } else {
          delete resource.description;
        }
        shouldPersist = true;
      }

      const normalizedTag = normalizeString(resource.tag);
      if (normalizedTag !== resource.tag) {
        if (normalizedTag) {
          resource.tag = normalizedTag;
        } else {
          delete resource.tag;
        }
        shouldPersist = true;
      }

      if (!resource.createdAt) {
        resource.createdAt = timestampBase;
        shouldPersist = true;
      }

      if (!resource.updatedAt) {
        resource.updatedAt = resource.createdAt;
        shouldPersist = true;
      }

      normalized.push(resource);
    });

    if (shouldPersist && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(normalized));
      } catch (persistError) {
        console.error('Failed to persist normalized external resources:', persistError);
      }
    }

    return normalized;
  }

  sanitizePayload(resource = {}, { includeEmpty = false } = {}) {
    const payload = {};

    if (!resource || typeof resource !== 'object') {
      return payload;
    }

    FORM_FIELDS.forEach((field) => {
      if (field in resource) {
        const normalizedValue = normalizeString(resource[field]);
        if (normalizedValue || includeEmpty) {
          payload[field] = normalizedValue;
        }
      }
    });

    if (!payload.name && payload.title) {
      payload.name = payload.title;
    }

    if (payload.name && !payload.title) {
      payload.title = payload.name;
    }

    return payload;
  }

  /**
   * Load external resources from localStorage
   * @returns {Promise<Array>} array of resources
   */
  async getTrainingResources() {
    try {
      if (typeof localStorage === 'undefined') {
        return [];
      }

      const raw = localStorage.getItem(this.storageKey);
      const storedResources = raw ? JSON.parse(raw) : [];
      return this.normalizeLoadedResources(storedResources);
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
      if (typeof localStorage === 'undefined') {
        return [];
      }

      const raw = localStorage.getItem(this.storageKey);
      const storedResources = raw ? JSON.parse(raw) : [];
      return this.normalizeLoadedResources(storedResources);
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
      const payload = this.sanitizePayload(resource);
      const name = normalizeString(payload.name);
      const url = normalizeString(payload.url);

      if (!name || !url) {
        throw new Error('Name and URL are required to add an external resource.');
      }

      const resources = await this.getTrainingResources();
      const timestamp = Date.now();

      const newResource = {
        id: `${timestamp}`,
        name,
        title: name,
        url,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      if (payload.description) {
        newResource.description = payload.description;
      }

      if (payload.tag) {
        newResource.tag = payload.tag;
      }

      resources.unshift(newResource);

      if (typeof localStorage === 'undefined') {
        throw new Error('localStorage is not available.');
      }

      localStorage.setItem(this.storageKey, JSON.stringify(resources));
      return newResource;
    } catch (error) {
      console.error('Failed to save external resource:', error);
      throw error;
    }
  }

  /**
   * Update an existing external resource in localStorage
   * @param {string} resourceId identifier of the resource to update
   * @param {Object} updates fields to update
   * @returns {Promise<Object>} updated resource
   */
  async updateTrainingResource(resourceId, updates = {}) {
    if (!resourceId) {
      throw new Error('Resource identifier is required to update an external resource.');
    }

    try {
      const resources = await this.getTrainingResources();

      if (!Array.isArray(resources) || resources.length === 0) {
        throw new Error('No external resources available to update.');
      }

      const normalizedId = String(resourceId);
      const resourceIndex = resources.findIndex((item) => {
        if (!item) {
          return false;
        }

        const currentId = resolveResourceId(item);
        if (currentId && String(currentId) === normalizedId) {
          return true;
        }

        return item.url && String(item.url) === normalizedId;
      });

      if (resourceIndex === -1) {
        throw new Error('External resource could not be located for update.');
      }

      const existingResource = resources[resourceIndex] || {};
      const payload = this.sanitizePayload(updates, { includeEmpty: true });

      const providedName = normalizeString(payload.name || payload.title);
      const finalName = providedName || normalizeString(existingResource.name) || normalizeString(existingResource.title);
      const providedUrl = normalizeString(payload.url);
      const finalUrl = providedUrl || normalizeString(existingResource.url);

      if (!finalName || !finalUrl) {
        throw new Error('Name and URL are required to update an external resource.');
      }

      const updatedAt = Date.now();
      const updatedResource = {
        ...existingResource,
        id: resolveResourceId(existingResource, normalizedId),
        name: finalName,
        title: finalName,
        url: finalUrl,
        updatedAt,
      };

      if ('description' in payload) {
        if (payload.description) {
          updatedResource.description = payload.description;
        } else {
          delete updatedResource.description;
        }
      }

      if ('tag' in payload) {
        if (payload.tag) {
          updatedResource.tag = payload.tag;
        } else {
          delete updatedResource.tag;
        }
      }

      resources[resourceIndex] = updatedResource;

      if (typeof localStorage === 'undefined') {
        throw new Error('localStorage is not available.');
      }

      localStorage.setItem(this.storageKey, JSON.stringify(resources));
      return updatedResource;
    } catch (error) {
      console.error('Failed to update external resource:', error);
      throw error;
    }
  }
}

const trainingResourceService = new TrainingResourceService();
export default trainingResourceService;
