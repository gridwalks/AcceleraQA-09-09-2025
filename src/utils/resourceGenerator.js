import { UI_CONFIG } from '../config/constants';
import trainingResourceService from '../services/trainingResourceService';
import {
  matchAdminResourcesToContext,
  getAdminResourceCatalog,
} from './internalResourceUtils';

function loadAdminResources() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return [];
  }

  try {
    return trainingResourceService.getTrainingResourcesSync();
  } catch (error) {
    console.error('Failed to load admin resources:', error);
    return [];
  }
}

export function generateResources(query, response) {
  try {
    const adminResources = loadAdminResources();
    if (!adminResources || adminResources.length === 0) {
      return [];
    }

    const context = `${query || ''} ${response || ''}`.trim();
    if (!context) {
      return getAdminResourceCatalog(adminResources).slice(0, UI_CONFIG.MAX_RESOURCES_PER_RESPONSE);
    }

    return matchAdminResourcesToContext(context, adminResources, UI_CONFIG.MAX_RESOURCES_PER_RESPONSE);
  } catch (error) {
    console.error('Error generating resources:', error);
    return [];
  }
}

export function findBestResourceMatch(text, preferredType) {
  try {
    const adminResources = loadAdminResources();
    if (!adminResources || adminResources.length === 0 || !text) {
      return null;
    }

    const matches = matchAdminResourcesToContext(text, adminResources, adminResources.length);
    if (!matches || matches.length === 0) {
      return null;
    }

    if (preferredType) {
      const normalizedType = preferredType.toLowerCase();
      const preferred = matches.find(resource => (resource.type || '').toLowerCase() === normalizedType);
      if (preferred) {
        return preferred;
      }
    }

    return matches[0] || null;
  } catch (error) {
    console.error('Error finding best resource match:', error);
    return null;
  }
}

export function getResourcesByTopic() {
  return [];
}

export function getAvailableTopics() {
  return [];
}

export function searchResources() {
  return [];
}
