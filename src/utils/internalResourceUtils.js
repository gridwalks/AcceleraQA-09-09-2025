import { UI_CONFIG } from '../config/constants';

const DEFAULT_LIMIT = UI_CONFIG?.MAX_RESOURCES_PER_RESPONSE || 5;
const MIN_TOKEN_LENGTH = 3;

const FILENAME_EXTENSION_PATTERN =
  /\.(pdf|docx|doc|txt|md|rtf|xlsx|xls|csv|pptx|ppt|zip|json|xml|yaml|yml|html|htm|log)$/i;

function isLikelyFilename(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (/[\\/]/.test(trimmed)) {
    return true;
  }

  if (FILENAME_EXTENSION_PATTERN.test(trimmed)) {
    return true;
  }

  if (!/\s/.test(trimmed) && /\.[a-z0-9]{2,5}$/i.test(trimmed)) {
    return true;
  }

  return false;
}

function collectKnowledgeSourceTitleCandidates(source) {
  if (!source || typeof source !== 'object') {
    return [];
  }

  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const metadataDocumentMetadata =
    metadata.documentMetadata && typeof metadata.documentMetadata === 'object'
      ? metadata.documentMetadata
      : {};
  const document = source.document && typeof source.document === 'object' ? source.document : {};
  const documentMetadata =
    document.metadata && typeof document.metadata === 'object' ? document.metadata : {};
  const fileCitation =
    source.file_citation && typeof source.file_citation === 'object' ? source.file_citation : {};
  const fileCitationMetadata =
    fileCitation.metadata && typeof fileCitation.metadata === 'object'
      ? fileCitation.metadata
      : {};

  const seen = new Set();
  const candidates = [];

  const pushCandidate = (rawValue) => {
    if (typeof rawValue !== 'string') {
      return;
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
      return;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push(trimmed);
  };

  const pushFromObject = (obj) => {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    pushCandidate(obj.documentTitle);
    pushCandidate(obj.document_title);
    pushCandidate(obj.title);
    pushCandidate(obj.displayTitle);
    pushCandidate(obj.display_title);
    pushCandidate(obj.displayName);
    pushCandidate(obj.display_name);
    pushCandidate(obj.name);
    pushCandidate(obj.label);
    pushCandidate(obj.fileTitle);
    pushCandidate(obj.file_title);
    pushCandidate(obj.preferredTitle);
    pushCandidate(obj.documentName);
    pushCandidate(obj.document_name);
  };

  pushFromObject(source);
  pushFromObject(metadata);
  pushFromObject(metadataDocumentMetadata);
  pushFromObject(document);
  pushFromObject(documentMetadata);
  pushFromObject(fileCitation);
  pushFromObject(fileCitationMetadata);

  return candidates;
}

function getFirstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return '';
}

function tokenizeText(text) {
  if (!text) {
    return [];
  }

  return String(text)
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g) || [];
}

function buildResourceId(prefix, key, index) {
  const safeKey = (key || 'resource').toString().replace(/\s+/g, '-').toLowerCase();
  return `${prefix}-${safeKey}-${index}`;
}

function truncateText(text, maxLength = 200) {
  if (!text) {
    return '';
  }

  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, maxLength - 1)}…`;
}

export function createAttachmentResources(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return [];
  }

  return attachments
    .map((attachment, index) => {
      if (!attachment) {
        return null;
      }

      const fallbackTitle =
        getFirstNonEmptyString(attachment.finalFileName, attachment.originalFileName) ||
        `Uploaded document ${index + 1}`;

      const preferredTitle = getFirstNonEmptyString(
        attachment.title,
        attachment.displayName,
        attachment.documentTitle,
        attachment.fileTitle,
        attachment?.metadata?.title,
        attachment?.metadata?.documentTitle
      );

      const title = preferredTitle || fallbackTitle;
      const descriptionParts = [];

      if (attachment.converted) {
        descriptionParts.push('Converted for knowledge search');
      }

      if (
        attachment.originalFileName &&
        attachment.finalFileName &&
        attachment.originalFileName !== attachment.finalFileName
      ) {
        descriptionParts.push(`Stored as ${attachment.finalFileName}`);
      }

      const description = descriptionParts.length > 0
        ? descriptionParts.join('. ')
        : 'Uploaded during this chat session.';

      const idKey = `${attachment.finalFileName || attachment.originalFileName || 'upload'}-${index}`;

      const metadata = {
        originalFileName: attachment.originalFileName || null,
        finalFileName: attachment.finalFileName || null,
        converted: Boolean(attachment.converted),
        conversionType: attachment.conversionType || null,
      };

      if (preferredTitle) {
        metadata.documentTitle = preferredTitle;
      }

      return {
        id: buildResourceId('user-upload', idKey, index),
        title,
        type: 'User Upload',
        url: attachment.url || null,
        description,
        origin: 'User Upload',
        location: 'Shared in this conversation',
        metadata,
      };
    })
    .filter(Boolean);
}

export function createKnowledgeBaseResources(sources = []) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return [];
  }

  const deduped = new Map();

  sources.forEach((source, index) => {
    if (!source) {
      return;
    }

    const key =
      getFirstNonEmptyString(
        source.documentId,
        source.file_id,
        source.fileId,
        source.file_citation?.file_id,
        source.document?.id
      ) ||
      source.filename ||
      `source-${index}`;
    const snippet = truncateText(source.text || '', 180);

    const fallbackTitle = `Referenced document ${index + 1}`;

    const titleCandidates = collectKnowledgeSourceTitleCandidates(source);
    const preferredTitle = titleCandidates.find(candidate => !isLikelyFilename(candidate));
    const resolvedTitle = preferredTitle || fallbackTitle;

    const metadataDocumentId =
      getFirstNonEmptyString(
        source.documentId,
        source.file_id,
        source.fileId,
        source.document?.id,
        source.file_citation?.file_id
      ) || null;

    const chunkIndex =
      typeof source.chunkIndex === 'number'
        ? source.chunkIndex
        : typeof source.chunk_index === 'number'
          ? source.chunk_index
          : typeof source.metadata?.chunkIndex === 'number'
            ? source.metadata.chunkIndex
            : typeof source.metadata?.chunk_index === 'number'
              ? source.metadata.chunk_index
              : typeof source.file_citation?.chunkIndex === 'number'
                ? source.file_citation.chunkIndex
                : typeof source.file_citation?.chunk_index === 'number'
                  ? source.file_citation.chunk_index
                  : null;
    const existing = deduped.get(key);

    if (existing) {
      if (snippet && !existing.description.includes(snippet)) {
        const merged = `${existing.description} ${snippet}`.trim();
        existing.description = truncateText(merged, 220);
      }
      if (resolvedTitle && existing.title !== resolvedTitle) {
        existing.title = resolvedTitle;
      }
      if (!existing.metadata?.documentTitle && resolvedTitle) {
        existing.metadata = {
          ...(existing.metadata || {}),
          documentTitle: resolvedTitle,
        };
      }
      deduped.set(key, existing);
      return;
    }

    const metadata = {
      documentId: metadataDocumentId,
      chunkIndex,
    };
    if (resolvedTitle) {
      metadata.documentTitle = resolvedTitle;
    }

    deduped.set(key, {
      id: buildResourceId('knowledge', key, index),
      title: resolvedTitle,
      type: 'Knowledge Base',
      url: source.url || null,
      description: snippet || 'Referenced from your uploaded knowledge base.',
      origin: 'Knowledge Base',
      location: 'Derived from retrieved document context',
      metadata,
    });
  });

  return Array.from(deduped.values());
}

function scoreAdminResource(resource, contextTokens) {
  const searchableText = `${resource.name || ''} ${resource.description || ''} ${resource.tag || ''}`;
  const resourceTokens = tokenizeText(searchableText);

  if (resourceTokens.length === 0) {
    return 0;
  }

  let score = 0;
  const matchedTokens = new Set();

  resourceTokens.forEach(token => {
    if (token.length < MIN_TOKEN_LENGTH) {
      return;
    }
    if (contextTokens.has(token) && !matchedTokens.has(token)) {
      matchedTokens.add(token);
      score += 1;
    }
  });

  if (resource.tag) {
    const tagToken = resource.tag.toLowerCase();
    if (contextTokens.has(tagToken)) {
      score += 2;
    }
  }

  return score;
}

export function matchAdminResourcesToContext(contextText, adminResources = [], limit = DEFAULT_LIMIT) {
  if (!contextText || !Array.isArray(adminResources) || adminResources.length === 0) {
    return [];
  }

  const contextTokens = new Set(tokenizeText(contextText));
  if (contextTokens.size === 0) {
    return [];
  }

  const scored = adminResources
    .map((resource, index) => {
      if (!resource) {
        return null;
      }

      const score = scoreAdminResource(resource, contextTokens);
      if (score === 0) {
        return null;
      }

      return { resource, score, index };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.index - b.index;
    })
    .slice(0, limit);

  return scored.map(({ resource, index }) => ({
    id: resource.id ? `admin-${resource.id}` : buildResourceId('admin-resource', resource.url || resource.name, index),
    title: resource.name || 'Internal Resource',
    type: 'Admin Resource',
    url: resource.url || null,
    description: resource.description || 'Provided by your administrator.',
    origin: 'Admin Library',
    location: resource.tag ? `Tagged with ${resource.tag}` : 'Administrator library',
    tag: resource.tag || null,
    metadata: {
      adminResourceId: resource.id || null,
    },
  }));
}

export function dedupeResources(resources = []) {
  if (!Array.isArray(resources) || resources.length === 0) {
    return [];
  }

  const map = new Map();

  resources.forEach(resource => {
    if (!resource || !resource.title) {
      return;
    }

    const key = resource.url || resource.id || `${resource.title}-${resource.type || ''}`;
    if (!map.has(key)) {
      map.set(key, { ...resource });
    } else {
      const existing = map.get(key);
      if (!existing.description && resource.description) {
        existing.description = resource.description;
      }
      if (!existing.url && resource.url) {
        existing.url = resource.url;
      }
      map.set(key, existing);
    }
  });

  return Array.from(map.values());
}

export function buildInternalResources({
  attachments = [],
  sources = [],
  adminResources = [],
  contextText = '',
  limit = DEFAULT_LIMIT,
} = {}) {
  const attachmentResources = createAttachmentResources(attachments);
  const knowledgeResources = createKnowledgeBaseResources(sources);
  const adminMatches = matchAdminResourcesToContext(contextText, adminResources, limit);

  return dedupeResources([
    ...attachmentResources,
    ...knowledgeResources,
    ...adminMatches,
  ]);
}

export function getAdminResourceCatalog(adminResources = []) {
  if (!Array.isArray(adminResources) || adminResources.length === 0) {
    return [];
  }

  return adminResources.map((resource, index) => ({
    id: resource.id ? `admin-${resource.id}` : buildResourceId('admin-resource', resource.url || resource.name, index),
    title: resource.name || 'Internal Resource',
    type: 'Admin Resource',
    url: resource.url || null,
    description: resource.description || 'Provided by your administrator.',
    origin: 'Admin Library',
    location: resource.tag ? `Tagged with ${resource.tag}` : 'Administrator library',
    tag: resource.tag || null,
    metadata: {
      adminResourceId: resource.id || null,
    },
  }));
}
