# AcceleraQA Requirements Specification

## 1. Product Overview
AcceleraQA is an AI-powered learning assistant tailored for pharmaceutical quality and compliance professionals, combining enterprise-grade Auth0 authentication with GPT-4 based guidance, resource recommendations, and study management tooling.【F:README.md†L1-L178】

## 2. User Roles & Personas
- **Authenticated Quality/Compliance Professional** – primary end user who signs in with Auth0, interacts with the chat assistant, uploads reference documents, and curates personal resources.【F:src/App.js†L211-L519】【F:src/components/Header.js†L91-L197】
- **Administrator** – privileged user with additional dashboard access to monitor system health, configure AI models, inspect RAG status, and manage shared resources.【F:src/components/Header.js†L116-L153】【F:src/components/AdminScreen.js†L68-L640】
- **Support Operations** – team responding to in-app support tickets initiated by authenticated users through the support overlay.【F:src/components/SupportRequestOverlay.js†L4-L66】

## 3. Key Assumptions & Dependencies
- Deployment environments must supply valid Auth0, OpenAI, and optional Neon/PostgreSQL credentials via environment variables before the app will operate.【F:README.md†L76-L105】
- The application relies on the browser's local storage to persist conversation history and requires adequate storage availability for a smooth experience.【F:src/utils/storageUtils.js†L4-L140】【F:src/components/StorageNotification.js†L5-L170】
- Retrieval augmented generation (RAG) features depend on either OpenAI's file search APIs or a Neon-hosted backend, selectable via configuration flags.【F:src/config/ragConfig.js†L1-L24】【F:src/services/ragService.js†L1-L144】

## 4. Epics, User Stories, and Acceptance Criteria

### Epic 1: Secure Access & Session Continuity
**Goal:** Guarantee that only authorized professionals can use AcceleraQA and that their sessions persist safely.

#### Story 1.1 – Authenticate with enterprise SSO
*As a regulated industry professional, I want to authenticate through Auth0 so I can access my protected learning workspace.*

**Acceptance Criteria**
- The system initializes Auth0 on application load, displaying a loading screen until the authentication state is known.【F:src/App.js†L211-L228】
- Unauthenticated users are routed to the Auth screen, while successful sign-in yields user profile metadata (email, roles, organization).【F:src/App.js†L211-L228】【F:src/components/Header.js†L91-L103】
- Auth0 configuration must validate required environment values before initialization, producing descriptive errors when missing or malformed.【F:src/services/authService.js†L12-L45】【F:src/config/constants.js†L64-L110】

#### Story 1.2 – Maintain session tokens securely
*As a returning user, I want AcceleraQA to remember my session without leaking tokens so I can resume quickly and safely.*

**Acceptance Criteria**
- The client silently refreshes tokens and augments the user object with role and organization claims after sign-in.【F:src/services/authService.js†L76-L110】
- Token acquisition caches expiry metadata and retries when necessary, surfacing actionable errors for authentication failures.【F:src/services/authService.js†L122-L199】
- When authenticated, the app loads any locally stored conversations tied to the user's subject identifier and re-saves updates automatically.【F:src/App.js†L258-L294】【F:src/utils/storageUtils.js†L147-L200】

#### Story 1.3 – Notify users about local storage behavior
*As a safety-focused user, I need to know how my conversations are stored so I can make informed retention decisions.*

**Acceptance Criteria**
- First-time authenticated users with saved messages see a storage notification or welcome modal explaining local persistence and its limitations.【F:src/App.js†L171-L177】【F:src/components/StorageNotification.js†L5-L200】
- Users can dismiss the storage notice, and their preference is remembered in local storage to prevent repeat prompts.【F:src/components/StorageNotification.js†L22-L200】

### Epic 2: Conversational Guidance & Knowledge Retrieval
**Goal:** Provide rich, context-aware AI assistance for pharmaceutical quality questions.

#### Story 2.1 – Compose prompts with optional attachments
*As a quality specialist, I want to send prompts with supporting documents so the assistant can tailor responses to my evidence.*

**Acceptance Criteria**
- The chat input supports multi-line prompts, attachment uploads (PDF, DOCX, TXT, CSV, XLSX), and disables sending when empty, loading, or cooling down.【F:src/components/ChatArea.js†L979-L1034】
- Non-PDF files are converted server-side prior to submission; conversion failures yield immediate assistant error messages explaining the supported formats.【F:src/App.js†L377-L403】
- Each user message persists attachment metadata so resources can be referenced later within the transcript and notebook.【F:src/App.js†L406-L434】

#### Story 2.2 – Generate AI responses with RAG context
*As a learner, I want the assistant to cite relevant documents when available so I can trust the guidance.*

**Acceptance Criteria**
- When RAG is enabled and no new file upload is pending, the system issues a retrieval search using either the active document vector store or the configured backend before calling OpenAI chat completion.【F:src/App.js†L669-L714】
- Assistant replies merge OpenAI-sourced references with internal attachments and admin-curated resources, deduplicating entries for clarity.【F:src/App.js†L720-L745】
- The transcript displays up to three source cards per message with titles, snippets, and outbound links when available.【F:src/components/ChatArea.js†L854-L919】
- If document search returns no answer or sources, the assistant automatically falls back to AI Knowledge, labels the message with the mode used, and retries document search on the next prompt.【F:src/App.js†L669-L717】【F:src/components/ChatArea.js†L713-L745】

#### Story 2.3 – Enforce responsible usage throttling
*As a system steward, I want to throttle rapid-fire prompts so that platform limits are respected.*

**Acceptance Criteria**
- Sending a message initiates a cooldown timer that disables the send button and notifies the user of remaining wait time.【F:src/App.js†L204-L209】【F:src/components/ChatArea.js†L979-L1028】
- Rate-limit responses from the OpenAI API propagate meaningful error messages to the user interface for corrective action.【F:src/services/openaiService.js†L14-L87】

#### Story 2.4 – Export study materials on demand
*As a learner, I want to export chat transcripts to Word or Excel so I can share or archive them.*

**Acceptance Criteria**
- The assistant detects export intents (e.g., “export to Word”) in user prompts and produces the requested document format, acknowledging success in chat.【F:src/App.js†L441-L476】
- Generated study-note messages expose a dedicated Word export action once the notes are available.【F:src/components/ChatArea.js†L938-L969】

### Epic 3: Resource Center & Personalized Recommendations
**Goal:** Give users a single pane for curated resources, AI suggestions, and conversation history.

#### Story 3.1 – Browse consolidated resource center
*As a professional, I need a resource sidebar that aggregates relevant links and conversations for quick follow-up.*

**Acceptance Criteria**
- The sidebar lists current session resources, links to notebook conversations, and exposes actions for adding items to the notebook.【F:src/components/Sidebar.js†L17-L65】【F:src/components/ResourcesView.js†L36-L82】
- Users can search within resources and filter conversation recommendations without leaving the chat view.【F:src/components/ResourcesView.js†L36-L71】【F:src/components/ResourcesView.js†L193-L205】

#### Story 3.2 – Surface AI learning suggestions
*As a lifelong learner, I want the assistant to proactively suggest topics so I can close knowledge gaps.*

**Acceptance Criteria**
- When the AI suggestions feature flag is enabled, the app loads personalized recommendations at login and refreshes them after new conversations.【F:src/App.js†L230-L323】
- Suggested items can link to matched internal resources or fall back to curated external URLs determined by the suggestion service.【F:src/services/learningSuggestionsService.js†L14-L139】
- The sidebar footer communicates whether suggestions are loading, ready, or awaiting conversation context.【F:src/components/Sidebar.js†L37-L64】

### Epic 4: Notebook & Study Management
**Goal:** Help users organize historical conversations, generate study notes, and manage saved resources.

#### Story 4.1 – Review and manage conversation history
*As a learner, I need a notebook view of recent conversations so I can revisit critical guidance.*

**Acceptance Criteria**
- Selecting “Open Notebook” displays an overlay with tabs for conversations and learning resources, including search and sorting controls.【F:src/components/Header.js†L129-L141】【F:src/components/NotebookOverlay.js†L27-L113】
- The notebook merges current and stored conversations, distinguishes between session-only and cloud-saved threads, and enables selection toggles for batch actions.【F:src/components/NotebookView.js†L34-L200】
- Users may delete individual conversations or resources with confirmation prompts to manage their history.【F:src/components/NotebookView.js†L370-L588】

#### Story 4.2 – Generate consolidated study notes
*As a busy professional, I want to synthesize selected conversations into study notes so I can review efficiently.*

**Acceptance Criteria**
- Users can bulk-select notebook conversations and request study notes; the system validates selections and calls OpenAI to compile notes.【F:src/components/NotebookView.js†L203-L333】【F:src/App.js†L677-L768】
- Generated notes are saved back into the message stream as AI messages marked as study notes for future exports or reference.【F:src/App.js†L769-L799】【F:src/components/ChatArea.js†L938-L969】

#### Story 4.3 – Persist conversations locally and to the cloud
*As a regulated team, we need conversations persisted locally for offline access and optionally synced to Neon for continuity.*

**Acceptance Criteria**
- Messages are cached in browser storage per user and automatically reloaded across sessions.【F:src/App.js†L258-L294】【F:src/utils/storageUtils.js†L147-L200】
- After assistant responses, conversations are normalized and saved via the Neon service for longer-term retention and analytics.【F:src/App.js†L341-L366】【F:src/services/neonService.js†L12-L200】

### Epic 5: Personal Knowledge Base & Document Control
**Goal:** Allow users (and admins) to manage document-based context that powers RAG answers.

#### Story 5.1 – Upload and manage personal documents
*As a knowledge worker, I want to upload, categorize, and remove my reference documents so the assistant can ground responses in my materials.*

**Acceptance Criteria**
- The “My Resources” modal allows uploading supported files, applies document limits for non-admins, and reports conversion/processing status.【F:src/components/RAGConfigurationPage.js†L168-L217】【F:src/components/RAGConfigurationPage.js†L509-L617】
- Users can edit document metadata (title, description, tags, category, version) and persist changes through the RAG service.【F:src/components/RAGConfigurationPage.js†L653-L754】
- Deleting a document prompts for confirmation and removes the item from the listing when successful.【F:src/components/RAGConfigurationPage.js†L619-L633】

#### Story 5.2 – Monitor RAG connectivity and troubleshooting
*As a user, I need diagnostic feedback to confirm my document search backend is operational.*

**Acceptance Criteria**
- The configuration modal runs a backend connection test on load, displaying auth status and any failures in a debug banner.【F:src/components/RAGConfigurationPage.js†L446-L505】【F:src/components/RAGConfigurationPage.js†L768-L808】
- Users can trigger manual authentication checks when RAG operations report authorization issues.【F:src/components/RAGConfigurationPage.js†L238-L257】【F:src/components/RAGConfigurationPage.js†L852-L865】

#### Story 5.3 – Curate shared training resources
*As an administrator, I want to maintain a catalog of external training links so the assistant and users can leverage vetted materials.*

**Acceptance Criteria**
- Admins can add, edit, and remove external training resources with validation of required fields, and updates immediately reflect in the list.【F:src/components/RAGConfigurationPage.js†L302-L443】
- Training resource forms enforce required name and URL fields and surface descriptive errors when saving fails.【F:src/components/RAGConfigurationPage.js†L315-L360】【F:src/components/RAGConfigurationPage.js†L400-L441】

### Epic 6: Administrative Oversight & Operations
**Goal:** Equip administrators with tooling to keep the platform reliable and compliant.

#### Story 6.1 – Restrict admin dashboard to privileged roles
*As a security officer, I want only admins to access operational tooling so controls stay protected.*

**Acceptance Criteria**
- Admin menu options only render when the logged-in user carries the admin role claim; non-admins attempting to load the dashboard see an access denied view with a return action.【F:src/components/Header.js†L116-L153】【F:src/components/AdminScreen.js†L340-L359】

#### Story 6.2 – Observe system health and usage metrics
*As an administrator, I want visibility into backend health, RAG status, authentication, and storage so I can respond to issues quickly.*

**Acceptance Criteria**
- The overview tab visualizes backend, RAG, authentication, and storage health along with conversation and token usage statistics.【F:src/components/AdminScreen.js†L361-L562】
- Admins can refresh data on demand, export health snapshots to JSON, and run connectivity tests across backend services.【F:src/components/AdminScreen.js†L286-L337】【F:src/components/AdminScreen.js†L384-L399】
- Token usage charts and authentication panels reveal token validity, expiry, and cached state for troubleshooting SSO issues.【F:src/components/AdminScreen.js†L84-L113】【F:src/components/AdminScreen.js†L566-L588】

#### Story 6.3 – Configure AI model preferences
*As an admin, I want to select which OpenAI model powers conversations so we can balance performance and cost.*

**Acceptance Criteria**
- Model options are sourced from configuration, persisted in local storage when changed, and reflected immediately in the admin dashboard state.【F:src/components/AdminScreen.js†L68-L85】【F:src/config/modelConfig.js†L3-L29】

### Epic 7: Support & Issue Reporting
**Goal:** Provide in-app pathways for users to request help and for the system to surface storage constraints.

#### Story 7.1 – Submit support tickets from the app
*As an end user, I want to raise a support request without leaving the application so issues are resolved quickly.*

**Acceptance Criteria**
- Users can open the support overlay from the header menu, compose a message, and submit it to a Netlify serverless endpoint along with their email address.【F:src/components/Header.js†L143-L185】【F:src/components/SupportRequestOverlay.js†L4-L66】
- Success and failure states are clearly indicated via alerts, and the overlay closes on successful submission.【F:src/components/SupportRequestOverlay.js†L18-L33】

#### Story 7.2 – Warn about storage availability
*As a user, I need to be warned if my browser cannot persist data so I can adjust my workflow.*

**Acceptance Criteria**
- The storage notification component detects local-storage availability and shows either a success confirmation or a warning about limited persistence.【F:src/components/StorageNotification.js†L5-L64】
- Users can access a welcome modal explaining how storage works and dismiss it once they acknowledge the information.【F:src/components/StorageNotification.js†L108-L200】

## 5. Non-Functional Requirements
- **Security & Compliance:** All network calls to backend services must include Auth0 bearer tokens and user identifiers; unauthorized responses produce actionable errors. The system prompt enforces regulatory references in AI outputs.【F:src/services/neonService.js†L26-L135】【F:src/config/constants.js†L10-L45】
- **Data Retention & Privacy:** Local storage is namespaced per user, capped at 1,000 messages, and includes utilities for validation, compression, and storage-usage estimation to respect browser limits.【F:src/utils/storageUtils.js†L4-L113】
- **Reliability & Diagnostics:** Admin tooling must surface backend test results, health statuses, and debug info for RAG operations, including connection tests from the resource configuration modal.【F:src/components/AdminScreen.js†L200-L337】【F:src/components/RAGConfigurationPage.js†L446-L505】
- **Performance:** Chat rendering and notebook views rely on memoization and batching of conversations to keep interactions responsive even with 30 days of history.【F:src/App.js†L32-L35】【F:src/components/NotebookView.js†L34-L166】
- **Configurability:** Feature flags and model selections are controlled via environment variables and persisted client-side, enabling staged rollouts of AI suggestions and backend providers.【F:src/config/featureFlags.js†L1-L6】【F:src/config/ragConfig.js†L1-L24】【F:src/config/modelConfig.js†L3-L29】

## 6. Out of Scope / Future Considerations
- Workflow automation beyond support ticket submission (e.g., automatic Jira case creation) is outside the current scope despite placeholder environment variables.【F:README.md†L95-L103】
- Advanced analytics dashboards or granular role management beyond the current admin/user roles are not defined in this release but can build upon the admin infrastructure described above.【F:src/components/AdminScreen.js†L68-L640】

