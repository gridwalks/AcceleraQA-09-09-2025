# Front-end integration for the AcceleraQA summary pipeline

This guide explains how the React client invokes the Netlify-hosted summary pipeline, renders multi-pass outputs, and exposes guardrail feedback for QA teams. Use it alongside the [runtime architecture reference](summary-generation-pipeline.md) when building new surfaces that need citation-backed summaries.

## Entry point: RAG configuration screen

* Component: [`SummaryRequestPanel`](../src/components/SummaryRequestPanel.js)
* Mounted inside the RAG configuration page so document admins can trial summaries before surfacing them elsewhere.
* Reads the current document inventory, fetches document text, and lets the operator tailor **role**, **lens**, **detail**, query boosts, and filters before calling the pipeline.

Rendered layout:

```
RAGConfigurationPage
 └── SummaryRequestPanel
      ├── Document selector (pulls from ragService.getDocuments)
      ├── Mode controls (role / lens / detail)
      ├── Retrieval filters (query + tags + sections)
      ├── Editable content textarea (pre-filled via ragService.downloadDocument)
      └── Output dashboard (summary markdown + citations + guardrails + diagnostics)
```

## Hook: `useSummaryPipeline`

Located at [`src/hooks/useSummaryPipeline.js`](../src/hooks/useSummaryPipeline.js), the hook centralises pipeline calls and normalises state:

* **requestSummary** – shapes the payload, forwards authentication headers via `summaryPipelineService`, and tracks `status`, `metrics`, `diagnostics`, and the persisted summary record.
* **fetchSummary** – hydrates historical runs by `summary_id`.
* **reset** – clears cached output when the operator tweaks source content or switches documents.
* Exposes canonical **role**, **lens**, and **detail** lists so the UI stays aligned with backend rubrics.

Usage snippet:

```jsx
const {
  requestSummary,
  fetchSummary,
  status,
  summary,
  diagnostics,
  metrics,
  roleOptions,
  lensOptions,
  detailOptions,
} = useSummaryPipeline();

await requestSummary({
  document: { ...metadata, content },
  mode: { role, lens, detail },
  query,
  filters: { tags, sections },
  metadata: { sourceDocumentId },
});
```

## Document content workflow

1. The panel calls `ragService.downloadDocument` with the selected document ID.
2. The helper [`decodeDocumentContent`](../src/utils/documentTextUtils.js) converts the returned base64 payload into summarizable text and surfaces lossy warnings when dealing with PDFs or DOCX files.
3. Operators can edit the textarea before the request, enabling quick iteration without re-uploading.

## Request → render lifecycle

1. **Submit** – UI disables the primary CTA, shows pipeline activity copy, and stores the mode/query filters that shaped the call.
2. **Pipeline response** – The Netlify function returns `{ summary, diagnostics, metrics }`. The hook caches everything for downstream renders.
3. **Output dashboard** – The panel:
   * Renders markdown-style text in a dark code block.
   * Lists citations with section/page anchors and confidence scores.
   * Surfaces guardrail violations (e.g., low citation density) or confirms a clean pass.
   * Shows stage-by-stage diagnostics for observability.
4. **Copy / reset** – Users can copy the summary to the clipboard or reset the state to start a new run.

## Extending the experience

* To embed summaries in other screens (e.g., chat replies or ticket exports) reuse `useSummaryPipeline` and the `decodeDocumentContent` helper to keep payloads consistent.
* Guardrail and diagnostics cards are separated so additional visualisations (sparkline latency, citation charts) can be slotted in without changing the hook API.
* When enabling automated refreshes, call `fetchSummary(summaryId)` during hydration instead of rerunning the pipeline.

## Troubleshooting tips

* **Binary files look garbled** – the lossy conversion warning signals that a server-side text extraction step should be added for PDFs/DOCX before summarisation.
* **Auth failures** – the hook surfaces errors from `summaryPipelineService`, so check the Auth0 session and Netlify logs.
* **Missing citations** – review diagnostics to confirm retrieval returned enough chunks and adjust tag/section filters accordingly.
