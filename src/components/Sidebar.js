// src/components/Sidebar.js - Enhanced with learning suggestions integration

import React from 'react';
import ResourcesView from './ResourcesView';
import { FEATURE_FLAGS } from '../config/featureFlags';

const Sidebar = ({
  messages,
  thirtyDayMessages,
  user,
  learningSuggestions = [],
  isLoadingSuggestions = false,
  onSuggestionsUpdate,
  onAddResource,
  onConversationSelect
}) => {
  return (
    <div className="h-full flex flex-col bg-white rounded-lg shadow-sm border border-gray-200 lg:min-h-0">
      {/* Sidebar Header */}
        <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900">Resource Center</h3>
        </div>

      {/* Sidebar Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ResourcesView
          currentResources={extractResourcesFromMessages(messages)}
          user={user}
          messages={messages}
          thirtyDayMessages={thirtyDayMessages}
          onSuggestionsUpdate={onSuggestionsUpdate}
          onAddResource={onAddResource}

          onConversationSelect={onConversationSelect}

        />
      </div>

      {/* Enhanced Footer with Learning Status */}
      {FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS && (
        <div className="flex-shrink-0 px-4 py-3 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{`${learningSuggestions.length} AI suggestions`}</span>

            <div className="flex items-center space-x-2">
              {FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS && (
                <>
                  {isLoadingSuggestions ? (
                    <div className="flex items-center space-x-1 text-purple-600">
                      <div className="animate-spin rounded-full h-3 w-3 border border-purple-600 border-t-transparent"></div>
                      <span>Learning...</span>
                    </div>
                  ) : learningSuggestions.length > 0 ? (
                    <div className="flex items-center space-x-1 text-green-600">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span>Personalized</span>
                    </div>
                  ) : (
                    <span className="text-gray-400">Start chatting</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Helper function to extract resources from messages for the current resources prop
 * @param {Array} messages - Array of messages
 * @returns {Array} - Array of unique resources
 */
const getTimestampValue = (timestamp, fallback) => {
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return timestamp;
  }

  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return fallback;
};

const ensureResourceTitle = (resource) => {
  if (!resource || typeof resource !== 'object') {
    return null;
  }

  const metadata =
    resource.metadata && typeof resource.metadata === 'object'
      ? resource.metadata
      : {};

  const titleCandidates = [
    resource.title,
    metadata.documentTitle,
    metadata.document_title,
    metadata.filename,
    metadata.documentName,
    metadata.document_name,
    metadata.title,
    resource.url,
    resource.id,
  ];

  const resolvedTitle = titleCandidates.find(
    (value) => typeof value === 'string' && value.trim()
  );

  if (!resolvedTitle) {
    return null;
  }

  if (resource.title && resource.title.trim()) {
    return {
      ...resource,
      title: resource.title.trim(),
      metadata,
    };
  }

  const normalizedTitle = resolvedTitle.trim();
  const normalizedMetadata = { ...metadata };

  if (!normalizedMetadata.documentTitle) {
    normalizedMetadata.documentTitle = normalizedTitle;
  }

  return {
    ...resource,
    title: normalizedTitle,
    metadata: normalizedMetadata,
  };
};

const buildResourceKey = (resource, messageIndex, resourceIndex) => {
  if (!resource) {
    return `resource-${messageIndex}-${resourceIndex}`;
  }

  const metadata =
    resource.metadata && typeof resource.metadata === 'object'
      ? resource.metadata
      : {};

  const keyCandidates = [
    resource.id,
    metadata.documentId,
    metadata.document_id,
    metadata.fileId,
    metadata.file_id,
    metadata.documentTitle,
    metadata.document_title,
    resource.url,
    resource.title ? `${resource.title}-${resource.type || ''}` : null,
  ];

  for (const candidate of keyCandidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return `resource-${messageIndex}-${resourceIndex}`;
};

const extractResourcesFromMessages = (messages) => {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const resourcesMap = new Map();

  messages.forEach((message, messageIndex) => {
    const messageResources = Array.isArray(message?.resources)
      ? message.resources
      : [];

    const timestampValue = getTimestampValue(message?.timestamp, messageIndex);

    messageResources.forEach((resource, resourceIndex) => {
      const normalizedResource = ensureResourceTitle(resource);
      if (!normalizedResource) {
        return;
      }

      const key = buildResourceKey(normalizedResource, messageIndex, resourceIndex);

      const existing = resourcesMap.get(key);
      const entry = {
        resource: normalizedResource,
        order: timestampValue,
        messageIndex,
        resourceIndex,
      };

      if (!existing) {
        resourcesMap.set(key, entry);
        return;
      }

      if (
        entry.order > existing.order ||
        (entry.order === existing.order && entry.messageIndex > existing.messageIndex) ||
        (entry.order === existing.order &&
          entry.messageIndex === existing.messageIndex &&
          entry.resourceIndex >= existing.resourceIndex)
      ) {
        resourcesMap.set(key, entry);
      }
    });
  });

  return Array.from(resourcesMap.values())
    .sort((a, b) => {
      if (b.order !== a.order) {
        return b.order - a.order;
      }
      if (b.messageIndex !== a.messageIndex) {
        return b.messageIndex - a.messageIndex;
      }
      return b.resourceIndex - a.resourceIndex;
    })
    .map((entry) => entry.resource);
};

export default Sidebar;
