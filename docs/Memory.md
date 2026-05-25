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

Tenant knowledge memory stores tenant-scoped policies and FAQs for published workflows. Each knowledge record includes one or more published workflow version IDs plus a traceable source with kind, title, optional URI, and optional external ID.

Workflow retrieval requires a `publishedWorkflowVersionId` and only returns active records attached to that published version. Records with a `staleAt` timestamp at or before retrieval time are excluded. If active records with the same kind and title have different text or source metadata, retrieval preserves both records and marks them with `conflictState: "conflicting"` so operators can resolve the conflict without losing provenance.

Knowledge ingestion jobs can convert already-resolved document, website, PDF, Notion, Google Drive, and CRM help-center source content into tenant knowledge for one or more published workflow versions. Each job stores visible aggregate status plus per-source status, failure code, retryability, and produced knowledge record IDs. Retry only reprocesses failed retryable sources, so successful records are not duplicated.

## Controls

Tenant users can view, edit, delete, disable, approve, reject, export, purge, and audit memory. Edit and disable actions keep the fact tenant-scoped and append actor/timestamp audit entries. Delete soft-deletes the fact for auditability and removes associated embeddings so deleted facts no longer appear in semantic retrieval. Retention policies purge memory, knowledge, embeddings, and linked ingestion source rows older than the configured cutoff. Tenant-level memory delete clears all memory-module state unless legal hold is active.

## Safety

Do not automatically persist sensitive data. Direct memory writes and extraction must filter secrets, regulated data, payment data, and irrelevant personal details. Tenant exports expose embedding metadata but never raw embedding vectors. Retrieved memory and tenant knowledge must be clearly separated from system instructions.
