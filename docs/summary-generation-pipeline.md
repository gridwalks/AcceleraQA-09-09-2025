# AcceleraQA Summary-Generation Pipeline Architecture

## 0. Objectives
- Deliver audit-ready summaries of QA and validation artifacts with precise source citations.
- Tailor outputs for specific roles (Auditor, QA Lead, Engineer, New Hire) and intents (Executive brief, SOP synopsis, CAPA evidence, Training deck).
- Integrate seamlessly with the Netlify-hosted AcceleraQA front-end and OpenAI File Search / vector databases.
- Provide observability, guardrails, and optional human-in-the-loop (HITL) review.

---

## 1. User-Facing Modes
- **Ask Summarize**: One-click summarization for PDF, DOCX, HTML, or Markdown documents with selectable detail levels (*Brief*, *Standard*, *Deep Dive*).
- **Role Profiles**: Auditor, QA Lead, Engineer, and New Hire profiles adapt rubric, vocabulary, and filters.
- **Focus Lenses**: *Regulatory*, *Risk & CAPA*, *Training*, *Timeline / Change Log*, *Testing & Evidence*.
- **Interactive Refinement**: Expand or contract sections, toggle citation visibility, term explanations, version comparisons, and export actions.

---

## 2. High-Level Flow
1. **Ingest** → 2. **Preprocess & Chunk** → 3. **Index** (Embeddings + metadata) → 4. **Retrieve** (query + role + lens) → 5. **Orchestrate** (multi-pass) → 6. **Generate** (extractive → abstractive) → 7. **Citations & Confidence** → 8. **Guardrails** → 9. **Human Review** → 10. **Persist & Export**.

```
Client → API → Ingestion svc → Parser → Chunker → Indexer (pgvector/OpenAI File Search)
     → Retrieval svc → Orchestrator → LLM Workers → Citation Builder → Policy Guard
     → Review Queue → Storage (NeonDB + S3/Blobs) → Exporters (Vault/Jira/GitHub)
```

---

## 3. Component Responsibilities

### 3.1 Ingestion Service
- Source documents from OpenAI File Search, normalizing metadata: `doc_id`, `title`, `owner`, `version`, `effective_date`, `doc_type`, and `system_of_record`.
- Persist raw bytes in object storage (Netlify Blobs or S3) and record hashes for deduplication.

### 3.2 Preprocessing & Chunking
- Convert documents to rich text with heading, table, and caption structure while retaining page and paragraph anchors.
- Apply adaptive chunking (800–1600 tokens with overlap) with boundary boosts at headings and tables.
- Tag each chunk with metadata (`doc_id`, `section`, `page`, `tags`, `version`).

### 3.3 Index Layer
- Maintain a vector index (pgvector on NeonDB or OpenAI embeddings) using schema `chunks(id, doc_id, section, page, vector, text, version, tags jsonb)`.
- Maintain keyword and metadata search via Postgres GIN indexes on `text`, `tags`, `doc_type`, and `version`.
- Re-embed on updates with transactional upserts keyed by `doc_id` + `hash`.

### 3.4 Retrieval Service
- Perform hybrid retrieval: semantic kNN + BM25, reranked via cross-encoder.
- Compose queries from user prompt, role profile rubric, and focus lens constraints, respecting time/version filters.
- Return diversified top-N chunks (18–30) by section.

### 3.5 Orchestrator (Multi-Pass)
- **Pass A – Extractive**: Select salient sentences and entities (systems, dates, owners, deviations, regulations).
- **Pass B – Abstractive**: Compose narratives tailored by role and lens.
- **Pass C – Evidence & Citations**: Map claims to chunk anchors with confidence scores.
- **Pass D – Tailoring**: Adjust style, length, glossaries, and role-specific inserts (e.g., risk tables for QA Lead).

### 3.6 Guardrails & Compliance
- Detect and redact PII/PHI using pattern and ML approaches (configurable per environment).
- Enforce claim grounding (no uncited statements in Auditor mode) and mark speculative language.
- Block edits to regulated content and expose confidence bands.

### 3.7 Human Review & Approvals
- Optional review queue with diff view versus prior summaries.
- Allow reviewers to pin/unpin citations, edit text, and add notes.
- Capture audit evidence: reviewer, timestamp, changes.

### 3.8 Persistence & Exports
- Store `summary_id`, `doc_id`, `mode`, `model`, `prompt_hash`, `citations`, `confidence`, `created_by`, and `checksum` in NeonDB.
- Support exports to DOCX, PDF, HTML, and integrations with Vault, Jira, and GitHub.

### 3.9 Observability
- Track latency, token usage, retrieval MRR, section coverage, and citation density.
- Capture traces with prompt details, retrieved chunk IDs, and model version via OpenTelemetry.
- Provide dashboards for drift and failure analysis.

---

## 4. Data Contracts

### 4.1 Chunk Metadata
```json
{
  "doc_id": "VEEVA-000123",
  "version": "3.1",
  "doc_type": "SOP",
  "page": 12,
  "section": "4.2 Risk Assessment",
  "tags": ["21 CFR 11", "Annex 11", "risk", "CAPA"],
  "effective_date": "2025-03-01"
}
```

### 4.2 Summary Record
```json
{
  "summary_id": "SUM-9f3c",
  "doc_id": "VEEVA-000123",
  "mode": {"role": "Auditor", "lens": "Regulatory", "detail": "Standard"},
  "model": "gpt-5-mini",
  "prompt_hash": "sha256:...",
  "citations": [
    {"page": 12, "section": "4.2", "chunk_id": "c-01", "score": 0.91},
    {"page": 18, "section": "5.1", "chunk_id": "c-07", "score": 0.86}
  ],
  "confidence": 0.88,
  "created_at": "2025-09-25T13:30:00Z"
}
```

---

## 5. Prompting & Rubrics
- **System Prompt**: “You are AcceleraQA’s summarizer. Write concise, audit-ready summaries grounded ONLY in provided chunks. For each claim, include a citation map {section/page}. If evidence is insufficient, state that explicitly. Adapt to role and lens.”
- **Role Rubrics**:
  - Auditor: compliance obligations, signatures, dates, deviations, CAPA actions, acceptance criteria.
  - QA Lead: risk items, mitigation status, due dates, owner matrix, blockers, change control summary.
  - Engineer: test coverage, defects, environment/config deltas, pipeline evidence, logs.
  - New Hire: purpose, context, definitions, responsibilities, training links.
- **Citation Template**: `[Citation] Statement → (Doc: {doc_id}, Sec {section}, p.{page})`.

---

## 6. Algorithms & Models
- **Embeddings**: `text-embedding-3-large` (or pgvector-compatible) with periodic refreshes.
- **Reranking**: Cross-encoder (e.g., MiniLM) for top-k relevance boosts.
- **LLMs**: `gpt-5` or `gpt-5-mini`, with `mini` used for batch jobs and full model for high-stakes modes.
- **Extractive Pass**: TextRank + NER (dates, people, systems, regulations, risk terms).
- **Factuality Check**: QAG to ensure each sentence is grounded in retrieved context.

---

## 7. Evaluation & QA
- **Coverage**: Ensure summaries address major sections (heading heuristics).
- **Citations**: Citation density ≥0.7 for Auditor mode; ≥0.4 otherwise.
- **Factuality**: Automated contradiction detection keeps hallucination rate below threshold.
- **Human Ratings**: Collect role-specific scores and edit deltas for iterative tuning.
- **Regression Suite**: Golden documents with expected outputs.

---

## 8. Guardrails & Policy
- PII/PHI policies: redact or gate access with audit logs.
- Regulatory language detector ensures mandated disclaimers are present.
- Safety classifier monitors free-text inputs for prohibited content.

---

## 9. CI/CD & Automation Hooks
- Regenerate summaries upon document version updates (Vault/GitHub webhooks).
- Apply PR checks that post engineering-mode summaries for spec changes.
- Run nightly jobs to rescore embeddings, refresh indices, and detect staleness.

---

## 10. Security & Access Control
- Enforce row-level security by `system_of_record` and user role.
- Provide signed, time-bound URLs for citation anchors with audit logging.
- Manage secrets via Netlify environment variables and encrypt raw bytes/embeddings with KMS.

---

## 11. API Surface
- **POST /summaries** → `202 Accepted {summary_id}` with body `{ doc_id, role, lens, detail, version?, sections?, language? }`.
- **GET /summaries/{id}** → Retrieve summary text, citations, confidence, export options.
- **POST /refine** → Return updated sections with new citations for follow-up queries.

---

## 12. Configuration Examples

### Role & Lens Config (YAML)
```yaml
roles:
  Auditor:
    min_citation_density: 0.7
    max_len_tokens: 1200
    include: [obligations, signatures, dates, deviations, capa]
  QA_Lead:
    min_citation_density: 0.5
    max_len_tokens: 900
    include: [risks, owners, due_dates, changes]
lenses:
  Regulatory:
    regex_boost: ["21 CFR 11", "Annex 11", "ICH E6"]
  Risk_CAPA:
    regex_boost: ["risk", "severity", "impact", "CAPA", "deviation"]
```

### Chunker Config (YAML)
```yaml
chunk_size: 1200
chunk_overlap: 180
respect_headings: true
keep_tables: true
anchors: ["H1", "H2", "Table", "Figure"]
```

---

## 13. Core Orchestration (Pseudo-code)
```ts
const summarize = async (req) => {
  const profile = loadProfile(req.role, req.lens, req.detail);
  const query = buildQuery(req, profile);
  const chunks = await hybridRetrieve(query, req.doc_id, req.version);

  const extractive = await llmExtractive(chunks, profile);
  const abstractive = await llmAbstractive(extractive, profile);

  const citations = mapCitations(abstractive, chunks);
  const guarded = await applyGuardrails(abstractive, citations, profile);

  const confidence = scoreConfidence(guarded, citations, chunks);
  const record = await persistSummary(req, guarded, citations, confidence);

  emitEvent("summary.created", record);
  return record;
};
```

---

## 14. Performance & Cost Controls
- Cache retrieval results per (`doc_id`, `version`, `lens`, `role`).
- Batch process with `gpt-5-mini`, upgrading to `gpt-5` for Auditor or on-demand needs.
- Optimize prompts for token efficiency and enforce response length caps.
- Tier storage to balance cost for cold or archived documents.

---

## 15. Integration Blueprints
- **Veeva Vault**: Trigger summary regeneration on document status changes; attach summaries and maintain cross-links.
- **Jira / YPT**: Insert summaries into ticket descriptions with citations; auto-update on document changes.
- **GitHub**: Post engineering-mode summaries on pull requests with evidence links.

---

## 16. Roadmap Enhancements
- Version-to-version diff summaries with change rationale.
- Multilingual summary support for global audits.
- Template-driven executive briefs for QBRs.
- Explainable retrieval visualizations (saliency heatmaps).

---

## 17. MVP Acceptance Criteria
- Role/lens summaries achieve ≥0.5 citation density and ≤2% hallucination on golden set.
- End-to-end latency ≤8s for Standard detail on 50-page documents (warm cache).
- Vault and Jira exports functioning end-to-end.
- Observability dashboard exposes retrieval coverage and token usage per summary.
