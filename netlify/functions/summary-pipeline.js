const crypto = require('crypto');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, X-Request-ID',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

const ROLE_PROFILES = {
  Auditor: {
    keywords: ['compliance', 'deviation', 'capa', 'audit', 'signature', 'approval', 'validation'],
    tone: 'formal',
    minCitationDensity: 0.7,
    sections: ['Compliance Obligations', 'Deviations & CAPA', 'Approvals & Timelines'],
  },
  'QA Lead': {
    keywords: ['risk', 'mitigation', 'owner', 'due date', 'change control', 'blocker'],
    tone: 'pragmatic',
    minCitationDensity: 0.5,
    sections: ['Risk Posture', 'Mitigations & Owners', 'Open Actions'],
  },
  Engineer: {
    keywords: ['test', 'defect', 'environment', 'configuration', 'log', 'pipeline'],
    tone: 'technical',
    minCitationDensity: 0.4,
    sections: ['Testing Summary', 'Defects & Evidence', 'Environment Notes'],
  },
  'New Hire': {
    keywords: ['overview', 'definition', 'context', 'role', 'training'],
    tone: 'accessible',
    minCitationDensity: 0.4,
    sections: ['Purpose & Scope', 'Key Responsibilities', 'Training Pointers'],
  },
};

const LENS_KEYWORDS = {
  Regulatory: ['21 cfr 11', 'annex 11', 'part 820', 'inspection', 'submission'],
  'Risk & CAPA': ['risk', 'severity', 'impact', 'capa', 'root cause'],
  Training: ['training', 'curriculum', 'onboarding', 'lesson'],
  'Timeline/Change log': ['timeline', 'change', 'revision', 'effective date'],
  'Testing & Evidence': ['test', 'iq', 'oq', 'pq', 'evidence', 'protocol'],
};

const DETAIL_CONFIG = {
  BRIEF: { targetSentences: 4, maxChunks: 8 },
  STANDARD: { targetSentences: 6, maxChunks: 14 },
  'DEEP DIVE': { targetSentences: 10, maxChunks: 24 },
};

const summaryStore = new Map();

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ message: 'CORS preflight' }),
    };
  }

  try {
    if (event.httpMethod === 'GET') {
      return await handleGet(event);
    }

    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: HEADERS,
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    const body = parseJson(event.body);
    if (!body) {
      return {
        statusCode: 400,
        headers: HEADERS,
        body: JSON.stringify({ error: 'Invalid JSON payload' }),
      };
    }

    const requestId = getRequestId(event.headers);
    const response = await processSummarizationRequest(body, requestId);

    return {
      statusCode: 202,
      headers: HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('summary-pipeline error:', error);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message,
      }),
    };
  }
};

async function handleGet(event) {
  const params = event.queryStringParameters || {};
  const summaryId = params.summary_id || params.id || params.summaryId;

  if (!summaryId) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: 'summary_id query parameter is required' }),
    };
  }

  let record = summaryStore.get(summaryId);
  if (!record) {
    record = await fetchSummaryFromDatabase(summaryId);
  }
  if (!record) {
    return {
      statusCode: 404,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Summary not found' }),
    };
  }

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ summary: record }),
  };
}

function parseJson(payload) {
  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(payload);
  } catch (error) {
    console.error('Failed to parse payload', error);
    return null;
  }
}

function getRequestId(headers = {}) {
  const existing = headers['x-request-id'] || headers['X-Request-ID'];
  if (existing && typeof existing === 'string') {
    return existing;
  }

  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function processSummarizationRequest(body, requestId) {
  const diagnostics = [];
  const startedAt = Date.now();

  const document = normalizeDocument(body.document);
  diagnostics.push({ stage: 'ingest', message: 'Document normalized', metadata: { docId: document.doc_id } });

  const chunkConfig = {
    chunkSize: clampNumber(body?.chunkConfig?.chunkSize, 800, 2000, 1200),
    chunkOverlap: clampNumber(body?.chunkConfig?.chunkOverlap, 100, 400, 180),
  };

  const chunks = preprocessAndChunk(document, chunkConfig);
  diagnostics.push({ stage: 'preprocess', message: 'Chunks generated', metadata: { chunkCount: chunks.length } });

  const index = buildSearchIndex(chunks);
  diagnostics.push({ stage: 'index', message: 'Index prepared', metadata: { tokenCount: index.totalTokens } });

  const mode = buildMode(body.mode);
  const detailPlan = getDetailPlan(mode.detail);

  const query = buildQuery(body.query, mode, body.filters);
  const retrieved = retrieveChunks(index, query, detailPlan.maxChunks);
  diagnostics.push({ stage: 'retrieve', message: 'Chunks retrieved', metadata: { retrieved: retrieved.length } });

  const orchestration = runOrchestration(retrieved, mode, detailPlan);
  diagnostics.push({ stage: 'orchestrate', message: 'Summary generated', metadata: { sentenceCount: orchestration.sentences.length } });

  const guardrails = runGuardrails(orchestration.summaryText, orchestration.citations, mode);
  diagnostics.push({ stage: 'guardrails', message: 'Guardrails evaluated', metadata: guardrails });

  const record = await persistSummary(document, mode, orchestration, guardrails, requestId);
  diagnostics.push({ stage: 'persist', message: 'Summary persisted', metadata: { summaryId: record.summary_id } });

  const latencyMs = Date.now() - startedAt;

  return {
    summary: record,
    diagnostics,
    metrics: {
      latencyMs,
      chunkCount: chunks.length,
      retrievedCount: retrieved.length,
      citationDensity: orchestration.citations.length / Math.max(1, orchestration.sentences.length),
      confidence: record.confidence,
    },
  };
}

function normalizeDocument(input = {}) {
  const text = normalizeText(input.content || input.text || '');
  if (!text) {
    throw new Error('Document content is required');
  }

  const docId = input.doc_id || input.id || generateDeterministicId(text);
  const title = input.title || 'Untitled Document';
  const version = input.version || '1.0';
  const docType = input.doc_type || input.type || 'Document';
  const effectiveDate = input.effective_date || input.effectiveDate || new Date().toISOString().slice(0, 10);

  return {
    doc_id: docId,
    title,
    version,
    doc_type: docType,
    effective_date: effectiveDate,
    owner: input.owner || 'unknown',
    system_of_record: input.system_of_record || input.systemOfRecord || 'unspecified',
    content: text,
  };
}

function normalizeText(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function generateDeterministicId(text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);
}

function clampNumber(value, min, max, fallback) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

function preprocessAndChunk(document, config) {
  const paragraphs = document.content.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let tokenCursor = 0;
  let section = 'Introduction';
  let buffer = [];
  let bufferTokens = 0;
  const chunkSize = config.chunkSize;
  const overlap = config.chunkOverlap;

  const paragraphTokens = paragraphs.map(p => ({
    text: p,
    tokens: tokenize(p),
    isHeading: /^([0-9]+\.|#+|Section\s+\d+)/i.test(p),
  }));

  const pushChunk = () => {
    if (buffer.length === 0) {
      return;
    }
    const text = buffer.join(' ');
    const tokens = tokenize(text);
    const chunkId = `${document.doc_id}_c${chunks.length + 1}`;
    const page = Math.max(1, Math.round(tokenCursor / 400) + 1);
    chunks.push({
      id: chunkId,
      doc_id: document.doc_id,
      section,
      page,
      text,
      tokens,
      tokenCount: tokens.length,
      startToken: tokenCursor,
      endToken: tokenCursor + tokens.length,
    });
    tokenCursor += Math.max(tokens.length - overlap, 0);
    buffer = [];
    bufferTokens = 0;
  };

  paragraphTokens.forEach((para) => {
    if (para.isHeading) {
      if (bufferTokens > chunkSize * 0.5) {
        pushChunk();
      }
      section = para.text.replace(/^#+\s*/, '').split(/\.|:/)[0].trim() || section;
      return;
    }

    if (bufferTokens + para.tokens.length > chunkSize && bufferTokens > 0) {
      pushChunk();
    }

    buffer.push(para.text);
    bufferTokens += para.tokens.length;
  });

  if (buffer.length > 0) {
    pushChunk();
  }

  return chunks;
}

function tokenize(text) {
  return text.split(/\s+/).filter(Boolean);
}

function buildSearchIndex(chunks) {
  const vocabulary = new Map();
  let totalTokens = 0;

  chunks.forEach((chunk) => {
    chunk.termFrequency = new Map();
    chunk.tokens.forEach((token) => {
      const normalized = token.toLowerCase().replace(/[^a-z0-9]/gi, '');
      if (!normalized) {
        return;
      }
      const prevCount = chunk.termFrequency.get(normalized) || 0;
      chunk.termFrequency.set(normalized, prevCount + 1);
      totalTokens += 1;
      vocabulary.set(normalized, (vocabulary.get(normalized) || 0) + 1);
    });
  });

  return {
    chunks,
    vocabulary,
    totalTokens,
  };
}

function buildMode(rawMode = {}) {
  const role = ROLE_PROFILES[rawMode.role] ? rawMode.role : 'QA Lead';
  const lens = LENS_KEYWORDS[rawMode.lens] ? rawMode.lens : 'Regulatory';
  const detail = normalizeDetail(rawMode.detail);

  return {
    role,
    lens,
    detail,
  };
}

function normalizeDetail(detail) {
  if (!detail) {
    return 'Standard';
  }

  const normalized = String(detail).trim().toLowerCase();
  if (normalized.startsWith('brief')) {
    return 'Brief';
  }
  if (normalized.startsWith('deep')) {
    return 'Deep Dive';
  }
  return 'Standard';
}

function getDetailPlan(detail) {
  const key = detail.toUpperCase();
  return DETAIL_CONFIG[key] || DETAIL_CONFIG.STANDARD;
}

function buildQuery(userQuery = '', mode, filters = {}) {
  const baseTerms = tokenize(userQuery.toLowerCase());
  const roleTerms = ROLE_PROFILES[mode.role].keywords;
  const lensTerms = LENS_KEYWORDS[mode.lens] || [];
  const filterTerms = [];

  if (filters?.tags && Array.isArray(filters.tags)) {
    filters.tags.forEach(tag => filterTerms.push(String(tag).toLowerCase()));
  }

  if (filters?.sections && Array.isArray(filters.sections)) {
    filters.sections.forEach(section => filterTerms.push(String(section).toLowerCase()));
  }

  const terms = [...new Set([...baseTerms, ...roleTerms, ...lensTerms, ...filterTerms].map((term) => term.toLowerCase()))]
    .filter(Boolean);

  return {
    terms,
    role: mode.role,
    lens: mode.lens,
  };
}

function retrieveChunks(index, query, maxChunks) {
  const scored = index.chunks.map((chunk) => {
    const score = scoreChunk(chunk, query.terms);
    return {
      ...chunk,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(maxChunks, 1));
}

function scoreChunk(chunk, terms) {
  if (!terms || terms.length === 0) {
    return chunk.tokenCount / Math.max(1, chunk.tokens.length);
  }

  let score = 0;
  terms.forEach((term) => {
    const normalized = term.toLowerCase().replace(/[^a-z0-9]/gi, '');
    if (!normalized) {
      return;
    }
    const frequency = chunk.termFrequency.get(normalized) || 0;
    if (frequency > 0) {
      score += Math.log(1 + frequency);
    }
  });

  const coverageBonus = Math.min(0.5, chunk.tokenCount / 1500);
  return score + coverageBonus;
}

function runOrchestration(chunks, mode, detailPlan) {
  const extractiveSentences = extractSentences(chunks, detailPlan.targetSentences * 2);
  const sentences = selectSentences(extractiveSentences, detailPlan.targetSentences);
  const citations = buildCitations(sentences);
  const summaryText = renderSummary(sentences, citations, mode);

  return {
    sentences,
    citations,
    summaryText,
  };
}

function extractSentences(chunks, targetCount) {
  const sentences = [];

  chunks.forEach((chunk, index) => {
    const parts = chunk.text.split(/(?<=[.!?])\s+/);
    parts.forEach((sentence) => {
      const normalized = sentence.trim();
      if (!normalized) {
        return;
      }
      const weight = chunk.score + Math.min(0.5, normalized.length / 500);
      sentences.push({
        text: normalized,
        chunkId: chunk.id,
        section: chunk.section,
        page: chunk.page,
        weight,
        rawScore: chunk.score,
        order: sentences.length,
      });
    });
  });

  sentences.sort((a, b) => b.weight - a.weight || a.order - b.order);
  return sentences.slice(0, Math.max(targetCount, 1));
}

function selectSentences(sentences, targetCount) {
  const result = [];
  const seenSections = new Set();

  sentences.forEach((sentence) => {
    if (result.length >= targetCount) {
      return;
    }

    const sectionKey = sentence.section.toLowerCase();
    if (!seenSections.has(sectionKey) || result.length < targetCount / 2) {
      result.push(sentence);
      seenSections.add(sectionKey);
    } else if (result.length < targetCount) {
      result.push(sentence);
    }
  });

  return result.slice(0, targetCount);
}

function buildCitations(sentences) {
  const citations = [];
  const seen = new Map();

  sentences.forEach((sentence) => {
    if (!seen.has(sentence.chunkId)) {
      const citationNumber = seen.size + 1;
      const citation = {
        citationNumber,
        chunk_id: sentence.chunkId,
        section: sentence.section,
        page: sentence.page,
        preview: sentence.text.slice(0, 180),
        score: Number(sentence.rawScore.toFixed(3)),
      };
      seen.set(sentence.chunkId, citation);
      citations.push(citation);
    }
  });

  return citations;
}

function renderSummary(sentences, citations, mode) {
  const profile = ROLE_PROFILES[mode.role];
  const citationLookup = new Map(citations.map((c) => [c.chunk_id, c.citationNumber]));

  const grouped = profile.sections.map((sectionTitle) => ({
    title: sectionTitle,
    bullets: [],
  }));

  const defaultGroup = { title: 'Key Insights', bullets: [] };

  sentences.forEach((sentence) => {
    const citationNumber = citationLookup.get(sentence.chunkId);
    const bullet = formatSentence(sentence.text, citationNumber, profile.tone);
    const matchingGroup = grouped.find((group) => sentence.section.toLowerCase().includes(group.title.split('&')[0].toLowerCase()));
    if (matchingGroup) {
      matchingGroup.bullets.push(bullet);
    } else {
      defaultGroup.bullets.push(bullet);
    }
  });

  const orderedGroups = [...grouped, defaultGroup].filter((group) => group.bullets.length > 0);

  const lines = [];
  orderedGroups.forEach((group) => {
    lines.push(`### ${group.title}`);
    group.bullets.forEach((bullet) => {
      lines.push(`- ${bullet}`);
    });
    lines.push('');
  });

  return lines.join('\n').trim();
}

function formatSentence(text, citationNumber, tone) {
  let sentence = text;
  if (tone === 'accessible') {
    sentence = sentence.replace(/\b(QA|CAPA|SOP|IQ|OQ|PQ)\b/g, (match) => `${match} (see glossary)`);
  }

  if (typeof citationNumber === 'number') {
    return `${sentence} [${citationNumber}]`;
  }

  return sentence;
}

function runGuardrails(summaryText, citations, mode) {
  const violations = [];

  if (!summaryText || typeof summaryText !== 'string' || summaryText.trim().length === 0) {
    violations.push({ code: 'EMPTY_SUMMARY', message: 'Summary text is empty' });
  }

  const citationDensity = citations.length / Math.max(1, (summaryText.match(/\[[0-9]+\]/g) || []).length);
  const minDensity = ROLE_PROFILES[mode.role].minCitationDensity;
  if (citationDensity < minDensity) {
    violations.push({
      code: 'LOW_CITATION_DENSITY',
      message: `Citation density ${citationDensity.toFixed(2)} below threshold ${minDensity}`,
    });
  }

  const piiMatches = summaryText.match(/\b\d{3}-\d{2}-\d{4}\b/g);
  if (piiMatches) {
    violations.push({ code: 'PII_DETECTED', message: 'Potential PII detected in summary output' });
  }

  return {
    violations,
    citationDensity,
  };
}

async function persistSummary(document, mode, orchestration, guardrails, requestId) {
  const summaryId = `sum_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const nowIso = new Date().toISOString();
  const confidence = calculateConfidence(orchestration.citations, guardrails.violations);

  const record = {
    summary_id: summaryId,
    doc_id: document.doc_id,
    title: document.title,
    mode,
    model: 'acceleraqa-orchestrator-v1',
    prompt_hash: crypto.createHash('sha256').update(`${document.doc_id}:${mode.role}:${mode.lens}`).digest('hex'),
    citations: orchestration.citations,
    confidence,
    created_at: nowIso,
    request_id: requestId,
    summary: orchestration.summaryText,
    guardrails,
  };

  summaryStore.set(summaryId, record);
  const sql = await getSqlClient();
  if (!sql) {
    console.warn('Neon database not configured; summary stored in memory only.');
    return record;
  }

  try {
    await ensureSummariesTable(sql);
    await sql`
      INSERT INTO summaries (
        summary_id,
        doc_id,
        title,
        mode,
        model,
        prompt_hash,
        citations,
        confidence,
        created_at,
        request_id,
        summary,
        guardrails
      ) VALUES (
        ${record.summary_id},
        ${record.doc_id},
        ${record.title},
        ${sql.json(record.mode)},
        ${record.model},
        ${record.prompt_hash},
        ${sql.json(record.citations)},
        ${record.confidence},
        ${record.created_at},
        ${record.request_id},
        ${record.summary},
        ${sql.json(record.guardrails)}
      )
      ON CONFLICT (summary_id) DO UPDATE SET
        doc_id = EXCLUDED.doc_id,
        title = EXCLUDED.title,
        mode = EXCLUDED.mode,
        model = EXCLUDED.model,
        prompt_hash = EXCLUDED.prompt_hash,
        citations = EXCLUDED.citations,
        confidence = EXCLUDED.confidence,
        request_id = EXCLUDED.request_id,
        summary = EXCLUDED.summary,
        guardrails = EXCLUDED.guardrails,
        updated_at = NOW();
    `;
  } catch (error) {
    console.error('Failed to persist summary to Neon database', error);
  }

  return record;
}

let cachedSqlClient = null;
let hasEnsuredSummariesTable = false;

async function getSqlClient() {
  if (cachedSqlClient) {
    return cachedSqlClient;
  }

  const connectionString = process.env.NEON_DATABASE_URL;
  if (!connectionString) {
    return null;
  }

  try {
    const { neon } = await import('@neondatabase/serverless');
    cachedSqlClient = neon(connectionString);
    return cachedSqlClient;
  } catch (error) {
    console.error('Failed to initialize Neon client', error);
    return null;
  }
}

async function ensureSummariesTable(sql) {
  if (hasEnsuredSummariesTable) {
    return;
  }

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS summaries (
        summary_id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        title TEXT,
        mode JSONB NOT NULL,
        model TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        citations JSONB NOT NULL,
        confidence DOUBLE PRECISION,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        request_id TEXT,
        summary TEXT NOT NULL,
        guardrails JSONB NOT NULL
      );
    `;
    hasEnsuredSummariesTable = true;
  } catch (error) {
    console.error('Failed to ensure summaries table exists', error);
  }
}

async function fetchSummaryFromDatabase(summaryId) {
  const sql = await getSqlClient();
  if (!sql) {
    return null;
  }

  try {
    const rows = await sql`
      SELECT
        summary_id,
        doc_id,
        title,
        mode,
        model,
        prompt_hash,
        citations,
        confidence,
        created_at,
        request_id,
        summary,
        guardrails
      FROM summaries
      WHERE summary_id = ${summaryId}
      LIMIT 1;
    `;

    if (!rows || rows.length === 0) {
      return null;
    }

    const row = rows[0];
    const record = {
      summary_id: row.summary_id,
      doc_id: row.doc_id,
      title: row.title,
      mode: row.mode,
      model: row.model,
      prompt_hash: row.prompt_hash,
      citations: row.citations,
      confidence: typeof row.confidence === 'number' ? Number(row.confidence.toFixed(2)) : row.confidence,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      request_id: row.request_id,
      summary: row.summary,
      guardrails: row.guardrails,
    };

    summaryStore.set(summaryId, record);
    return record;
  } catch (error) {
    console.error('Failed to load summary from Neon database', error);
    return null;
  }
}

function calculateConfidence(citations, violations) {
  const base = citations.length > 0 ? 0.6 + Math.min(0.3, citations.length * 0.05) : 0.4;
  const penalty = Math.min(0.3, (violations?.length || 0) * 0.1);
  return Number(Math.max(0, base - penalty).toFixed(2));
}
