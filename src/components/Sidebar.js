// src/components/Sidebar.js - Enhanced with learning suggestions integration

import React from 'react';
import ResourcesView from './ResourcesView';
import { FEATURE_FLAGS } from '../config/featureFlags';

const Sidebar = ({
  messages,
  user,
  learningSuggestions = [],
  isLoadingSuggestions = false,
  onSuggestionsUpdate,
  onAddResource,
  onLoadChatHistory
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
          onSuggestionsUpdate={onSuggestionsUpdate}
          onAddResource={onAddResource}
          messages={messages}
          onLoadChatHistory={onLoadChatHistory}
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

const MIN_TOKEN_LENGTH = 3;

const RELEVANCE_WEIGHTS = {
  QUESTION_ATTACHMENT: 1000,
  ANSWER_RESOURCE: 500,
  TOKEN_MATCH: 5,
};

const isUserMessage = (message) => {

  if (!message || typeof message !== 'object') {
    return false;
  }

  const candidate = typeof message.role === 'string' ? message.role : message.type;
  if (typeof candidate !== 'string') {
    return false;
  }

  const normalized = candidate.toLowerCase();
  return normalized === 'user' || normalized === 'human';
};

const isAssistantMessage = (message) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const candidate = typeof message.role === 'string' ? message.role : message.type;
  if (typeof candidate !== 'string') {
    return false;
  }
  const normalized = candidate.toLowerCase();
  return normalized === 'assistant' || normalized === 'ai' || normalized === 'bot';
};

const collectStrings = (value, collector, depth = 0) => {

  if (depth > 3 || value == null) {
    return;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      collector.push(trimmed);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, collector, depth + 1));
    return;
  }

  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectStrings(item, collector, depth + 1));
  }
};

const tokenizeForRelevance = (text) => {
  if (!text) {
    return [];
  }

  return String(text)
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((token) => token.length >= MIN_TOKEN_LENGTH) || [];
};

const buildTokenSet = (text) => {
  const tokens = new Set();
  tokenizeForRelevance(text).forEach((token) => tokens.add(token));
  return tokens;
};

const extractMessageText = (message) => {
  if (!message || typeof message !== 'object') {
    return '';
  }

  const parts = [];
  const { content } = message;

  if (typeof content === 'string') {
    parts.push(content);
  } else if (Array.isArray(content)) {
    content.forEach((item) => {
      if (typeof item === 'string') {
        parts.push(item);
      } else if (item && typeof item === 'object') {
        if (typeof item.text === 'string') {
          parts.push(item.text);
        } else if (typeof item.content === 'string') {
          parts.push(item.content);
        } else if (typeof item.value === 'string') {
          parts.push(item.value);
        }
      }
    });
  } else if (content && typeof content === 'object') {
    if (typeof content.text === 'string') {
      parts.push(content.text);
    }
    if (typeof content.content === 'string') {
      parts.push(content.content);
    }

    if (Array.isArray(content.parts)) {
      content.parts.forEach((part) => {
        if (typeof part === 'string') {
          parts.push(part);
        } else if (part && typeof part === 'object' && typeof part.text === 'string') {
          parts.push(part.text);
        }
      });
    }
  }

  ['text', 'prompt', 'message', 'question'].forEach((field) => {
    if (typeof message[field] === 'string') {
      parts.push(message[field]);
    }
  });

  return parts.join(' ').trim();
};

const getResourceSearchableTokens = (resource) => {
  if (!resource || typeof resource !== 'object') {
    return new Set();
  }

  const parts = [];
  collectStrings(resource.title, parts);
  collectStrings(resource.description, parts);
  collectStrings(resource.tag, parts);
  collectStrings(resource.metadata, parts);

  const tokens = new Set();
  parts.forEach((part) => {
    tokenizeForRelevance(part).forEach((token) => tokens.add(token));
  });

  return tokens;
};

const mergeContexts = (existingContexts, newContexts) => {
  const merged = new Set();

  if (existingContexts && typeof existingContexts[Symbol.iterator] === 'function') {
    for (const value of existingContexts) {
      merged.add(value);
    }
  }

  if (newContexts && typeof newContexts[Symbol.iterator] === 'function') {
    for (const value of newContexts) {
      merged.add(value);
    }
  }

  return merged;
};

const contextsHas = (contexts, value) => {
  if (!contexts) {
    return false;
  }

  if (contexts instanceof Set) {
    return contexts.has(value);
  }

  if (Array.isArray(contexts)) {
    return contexts.includes(value);
  }
  return false;
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

  let latestQuestionIndex = -1;
  let latestQuestionMessage = null;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isUserMessage(messages[index])) {
      latestQuestionIndex = index;
      latestQuestionMessage = messages[index];
      break;
    }
  }

  const questionText = extractMessageText(latestQuestionMessage);
  const questionTokens = buildTokenSet(questionText);

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
      const contexts = new Set();

      if (latestQuestionIndex !== -1 && messageIndex === latestQuestionIndex) {
        contexts.add('question');
      } else if (
        latestQuestionIndex !== -1 &&
        messageIndex > latestQuestionIndex &&
        isAssistantMessage(message)
      ) {
        contexts.add('answer');
      } else {
        contexts.add('other');
      }

      const mergedContexts = mergeContexts(existing?.contexts, contexts);

      const entry = {
        resource: normalizedResource,
        order: timestampValue,
        messageIndex,
        resourceIndex,
        contexts: mergedContexts,
      };

      if (!existing) {
        resourcesMap.set(key, entry);
        return;
      }

      const shouldReplace =
        entry.order > existing.order ||
        (entry.order === existing.order && entry.messageIndex > existing.messageIndex) ||
        (entry.order === existing.order &&
          entry.messageIndex === existing.messageIndex &&
          entry.resourceIndex >= existing.resourceIndex);

      if (shouldReplace) {
        resourcesMap.set(key, entry);
      } else if (existing) {
        existing.contexts = mergedContexts;
      }
    });
  });

  const scoredEntries = Array.from(resourcesMap.values()).map((entry) => {
    let score = 0;
    const { contexts } = entry;

    if (contextsHas(contexts, 'question')) {
      score += RELEVANCE_WEIGHTS.QUESTION_ATTACHMENT;
    }

    if (contextsHas(contexts, 'answer')) {
      score += RELEVANCE_WEIGHTS.ANSWER_RESOURCE;
    }

    if (questionTokens.size > 0) {
      const resourceTokens = getResourceSearchableTokens(entry.resource);
      resourceTokens.forEach((token) => {
        if (questionTokens.has(token)) {
          score += RELEVANCE_WEIGHTS.TOKEN_MATCH;
        }
      });
    }

    return {
      ...entry,
      score,
    };
  });

  return scoredEntries
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
