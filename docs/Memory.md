# Memory

## Memory Scopes

- session: active-call context.
- caller: facts tied to a caller identity.
- account: facts tied to a CRM/customer account.
- tenant_knowledge: business policies, FAQs, documents, and knowledge sources.

## Defaults

Durable memory is scoped and opt-in. Session memory is allowed for active calls. Caller/account memory should be drafted after calls and saved according to tenant policy.

## Session Memory

Live sandbox sessions maintain short-term session memory from transcript and completed-turn text while the call is active. This memory survives reconnect because it is attached to the server-side session record, not the browser transport token.

When a session ends, raw session-memory entries are cleared and replaced by a short summary. Raw audio payloads are not stored in session memory.

## Storage

Use Postgres as source of truth and pgvector for semantic retrieval. Store source references, confidence, approval state, retention state, and audit metadata.

The current caller/account and tenant knowledge slices use the memory repository abstraction with file-backed local persistence for record bodies. Embedding storage now has a pgvector migration path through `memory_embeddings`, including tenant/scope lookup indexes and an ivfflat cosine index for top-k retrieval.

## Caller And Account Memory

Caller/account memory is opt-in. Writes without explicit opt-in are rejected. Caller memories are keyed by tenant plus caller identity, and account memories are keyed by tenant plus caller identity plus account ID so shared phone numbers do not expose unrelated account facts.

Caller/account memory writes may include an embedding vector. Retrieval uses cosine similarity, applies tenant and scope filters before returning matches, honors caller identity/account context, enforces `minConfidence`, and returns at most `topK` matches. Raw embedding vectors are not exposed in retrieval responses.

## Approval Workflow

Tenants can require approval before durable caller/account memory is written by setting `approvalRequired: true` on a memory write. Approval-required writes create pending drafts instead of active memory records.

Approvers can approve a pending draft as-is or edit the text/confidence before approval. Approval creates the durable active memory record and links the draft to the approved memory ID. Approvers can reject drafts with an optional reason. Drafts keep audit trail entries for creation, approval, and rejection so operators can reconstruct who made each decision.

## Post-Call Extraction

Post-call extraction drafts caller/account memory from caller transcript assertions after a call ends. Extraction requires explicit opt-in and returns pending drafts rather than writing approved memory directly.

Each draft links back to the call session, transcript, and transcript event IDs that produced it. The extractor filters sensitive content such as card numbers, passwords, tokens, SSNs, and other secret-like data, and it ignores agent/system assertions so suggestions do not become false caller memory.

## Tenant Knowledge Memory

Tenant knowledge memory stores tenant-scoped FAQs, policies, procedures, troubleshooting notes, pricing rules, escalation instructions, legal/compliance rules, and general references for published workflows. Each knowledge record includes one or more published workflow version IDs plus a traceable source with kind, title, optional URI, optional external ID, optional source snapshot ID, optional sensitivity labels, and optional stale timestamp.

Workflow retrieval requires a `publishedWorkflowVersionId` or the frozen workspace/workflow scope from the runtime manifest. Ordinary retrieval returns only active records in that scope. Runtime callers pass their call-start timestamp when they need snapshot stability; that point-in-time retrieval excludes records created later and keeps records that were active at call start even if a later approval marked them stale. If active records with the same kind and title have different text or source metadata, retrieval preserves both records and marks them with `conflictState: "conflicting"` so operators can resolve the conflict without losing provenance.

Knowledge ingestion jobs can convert already-resolved document, website, PDF, Notion, Google Drive, and CRM help-center source content into tenant knowledge for one or more published workflow versions. Each job stores visible aggregate status plus per-source status, failure code, retryability, and produced knowledge record IDs. Retry only reprocesses failed retryable sources, so successful records are not duplicated.

The tenant Add source workflow creates source snapshots for manual text, single URLs, PDFs, and provider imports. Manual text requires the operator to choose one record type and activates immediately; imported sources create record-level review drafts with suggested taxonomy and no runtime visibility until approval. Supported record types are FAQ, policy, procedure, troubleshooting, pricing, escalation, legal/compliance, and general reference. Policy, pricing, escalation, and legal/compliance suggestions require explicit high-risk confirmation before approval.

Full website crawling is a separate knowledge source type from single URL import. Tenant admins configure an allowed website root URL, crawl limit, excluded paths, workspace/workflow scope, and manual or daily sync. Zara confines crawling to the configured origin/root path, honors simple robots disallow rules, normalizes readable HTML title/body text, deduplicates canonical/content duplicates, and stores per-page status for skipped, failed, and succeeded pages. Crawled pages create review-gated record drafts with source URLs; auth-required pages, binary files, large pages, redirects/canonical exits, and fetch failures remain visible as source status rather than silently activating knowledge.

Source snapshots default to the active workspace and may include workflow IDs. Provider imports require a connected provider that supports knowledge sources plus an active `knowledge-source` grant for the selected workspace/workflow. Intercom Articles, Confluence spaces/pages, and SharePoint sites/pages/folders resolve provider content server side from stable source selections, create record-level review drafts with source URIs, and never expose provider API URLs or auth headers to tenant users. Published runtime manifests carry the workflow and workspace identity so retrieval can use the frozen allowed scope while newly approved records inside that scope become available to new calls.

Knowledge sources support snapshot mode and recurring mode. V1 recurring sync is limited to manual refresh and daily sync. Refreshes never directly mutate runtime-active knowledge. Changed content creates update review drafts, confirmed source deletion creates deletion review drafts, and approval is required before a new active record is created or an old record is marked stale. Provider auth or permission failures degrade the source, pause future refresh, and leave the last approved snapshot available.

Website crawl refresh compares approved page URLs and content hashes against the latest crawl. Provider knowledge-source refresh uses the same review-gated pattern for Confluence and SharePoint selections: added records create new drafts, changed records create update drafts, and removed source URLs create deletion drafts while approved records stay active until deletion approval. Provider 401/403 failures degrade the source, pause future refresh, and keep approved snapshots active. Runtime retrieval never performs live website, Confluence, or SharePoint search during calls.

Imported and refreshed records are scanned for PII, credentials/secrets, payment, health, legal, and internal-only signals. Obvious credentials, API keys, passwords, and secrets create activation blockers and cannot become runtime knowledge. High-risk, sensitive, and deletion approvals require owner/admin authority for the matching workspace and audit actor, role, workspace, reason, before state, after state, and timestamp.

Workflow publish validates knowledge conflicts for the selected workspace/workflow scope. Conflict warnings are shown for duplicate kind/title records with different source/text, but publish blocks only unresolved high-risk conflicts such as policy, pricing, legal/compliance, and escalation records.

## Controls

Tenant users can view, edit, delete, disable, approve, reject, export, purge, and audit memory. Edit and disable actions keep the fact tenant-scoped and append actor/timestamp audit entries. Delete soft-deletes the fact for auditability and removes associated embeddings so deleted facts no longer appear in semantic retrieval. Retention policies purge memory, knowledge, embeddings, and linked ingestion source rows older than the configured cutoff. Tenant-level memory delete clears all memory-module state unless legal hold is active.

## Safety

Do not automatically persist sensitive data. Direct memory writes and extraction must filter secrets, regulated data, payment data, and irrelevant personal details. Tenant exports expose embedding metadata but never raw embedding vectors. Retrieved memory and tenant knowledge must be clearly separated from system instructions.
