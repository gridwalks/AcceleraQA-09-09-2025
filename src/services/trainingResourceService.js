// src/services/trainingResourceService.js
// External resource persistence has been disabled. All resources exist only in-memory
// for the current session so that nothing is written to localStorage or remote services.

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

let inMemoryResources = [];

class TrainingResourceService {
  constructor() {
    this.storageKey = 'trainingResources';
  }

  normalizeLoadedResources(resources) {
    if (!Array.isArray(resources) || resources.length === 0) {
      return [];
    }

    return resources
      .filter((resource) => resource && typeof resource === 'object')
      .map((resource, index) => {
        const normalized = { ...resource };
        const resolvedId = resolveResourceId(normalized, `${Date.now()}-${index}`);
        normalized.id = String(resolvedId);

        const nameCandidate = normalizeString(normalized.name) || normalizeString(normalized.title);
        if (nameCandidate) {
          normalized.name = nameCandidate;
          normalized.title = nameCandidate;
        }

        const normalizedUrl = normalizeString(normalized.url);
        normalized.url = normalizedUrl;

        if (normalized.description) {
          normalized.description = normalizeString(normalized.description);
        }

        if (normalized.tag) {
          normalized.tag = normalizeString(normalized.tag);
        }

        if (!normalized.createdAt) {
          normalized.createdAt = Date.now();
        }

        if (!normalized.updatedAt) {
          normalized.updatedAt = normalized.createdAt;
        }

        return normalized;
      });
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

  async getTrainingResources() {
    return this.normalizeLoadedResources(inMemoryResources);
  }

  getTrainingResourcesSync() {
    return this.normalizeLoadedResources(inMemoryResources);
  }

  async addTrainingResource(resource) {
    const payload = this.sanitizePayload(resource);
    const name = normalizeString(payload.name);
    const url = normalizeString(payload.url);

    if (!name || !url) {
      throw new Error('Name and URL are required to add an external resource.');
    }

    const timestamp = Date.now();
    const newResource = {
      id: `${timestamp}-${Math.random().toString(36).slice(2)}`,
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

    inMemoryResources = [newResource, ...inMemoryResources];
    return newResource;
  }

  async updateTrainingResource(resourceId, updates = {}) {
    if (!resourceId) {
      throw new Error('Resource identifier is required to update an external resource.');
    }

    const resources = [...inMemoryResources];
    if (resources.length === 0) {
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
    inMemoryResources = resources;
    return updatedResource;
  }
}

const trainingResourceService = new TrainingResourceService();
export default trainingResourceService;
