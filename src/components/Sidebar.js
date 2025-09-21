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

const normalizeRole = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const isUserMessage = (message) => {
  const role = normalizeRole(message?.role);
  const type = normalizeRole(message?.type);

  return role === 'user' || type === 'user';
};

const isAssistantMessage = (message) => {
  const role = normalizeRole(message?.role);
  const type = normalizeRole(message?.type);

  return role === 'assistant' || role === 'ai' || type === 'assistant' || type === 'ai';
};

const collectStrings = (value, results = []) => {
  if (value == null) {
    return results;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      results.push(trimmed);
    }
    return results;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    results.push(String(value));
    return results;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, results));
    return results;
  }

  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectStrings(item, results));
  }

  return results;
};

const getMessageText = (message) => {
  const fragments = [];

  collectStrings(message?.content, fragments);
  collectStrings(message?.text, fragments);
  collectStrings(message?.message, fragments);

  if (Array.isArray(message?.parts)) {
    message.parts.forEach((part) => {
      if (typeof part === 'string' || typeof part === 'number' || typeof part === 'boolean') {
        collectStrings(part, fragments);
      } else if (part && typeof part === 'object') {
        collectStrings(part.text, fragments);
        collectStrings(part.content, fragments);
      }
    });
  }

  return fragments.join(' ');
};

const tokenize = (value) => {
  if (typeof value !== 'string') {
    return [];
  }

  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);
};

const getResourceTokens = (resource) => {
  const fragments = [];

  collectStrings(resource?.title, fragments);
  collectStrings(resource?.description, fragments);
  collectStrings(resource?.type, fragments);
  collectStrings(resource?.tags, fragments);
  collectStrings(resource?.metadata, fragments);

  return tokenize(fragments.join(' '));
};

const QUESTION_ATTACHMENT_BONUS = 100;
const ASSISTANT_FOLLOWUP_BONUS = 50;

const extractResourcesFromMessages = (messages) => {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const resourcesMap = new Map();
  const questionIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => isUserMessage(message))?.index ?? -1;

  const questionTokens = questionIndex >= 0
    ? new Set(tokenize(getMessageText(messages[questionIndex])))
    : new Set();

  messages.forEach((message, messageIndex) => {
    const messageResources = Array.isArray(message?.resources)
      ? message.resources
      : [];

    const timestampValue = getTimestampValue(message?.timestamp, messageIndex);
    const isQuestionMessage = messageIndex === questionIndex;
    const isFollowupAssistantMessage =
      questionIndex >= 0 &&
      messageIndex > questionIndex &&
      isAssistantMessage(message);

    messageResources.forEach((resource, resourceIndex) => {
      const normalizedResource = ensureResourceTitle(resource);
      if (!normalizedResource) {
        return;
      }

      const key = buildResourceKey(normalizedResource, messageIndex, resourceIndex);

      const resourceTokens = getResourceTokens(normalizedResource);
      let overlapScore = 0;
      if (questionTokens.size > 0 && resourceTokens.length > 0) {
        const resourceTokenSet = new Set(resourceTokens);
        questionTokens.forEach((token) => {
          if (resourceTokenSet.has(token)) {
            overlapScore += 1;
          }
        });
      }

      let score = overlapScore;
      if (isQuestionMessage) {
        score += QUESTION_ATTACHMENT_BONUS;
      } else if (isFollowupAssistantMessage) {
        score += ASSISTANT_FOLLOWUP_BONUS;
      }

      const existing = resourcesMap.get(key);
      const entry = {
        resource: normalizedResource,
        order: timestampValue,
        messageIndex,
        resourceIndex,
        score,
      };

      if (!existing) {
        resourcesMap.set(key, entry);
        return;
      }

      if (
        entry.score > existing.score ||
        (entry.score === existing.score &&
          (entry.order > existing.order ||
            (entry.order === existing.order && entry.messageIndex > existing.messageIndex) ||
            (entry.order === existing.order &&
              entry.messageIndex === existing.messageIndex &&
              entry.resourceIndex >= existing.resourceIndex)))
      ) {
        resourcesMap.set(key, entry);
      }
    });
  });

  return Array.from(resourcesMap.values())
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
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
