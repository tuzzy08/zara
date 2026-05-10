# Memory

## Memory Scopes

- session: active-call context.
- caller: facts tied to a caller identity.
- account: facts tied to a CRM/customer account.
- tenant_knowledge: business policies, FAQs, documents, and knowledge sources.

## Defaults

Durable memory is scoped and opt-in. Session memory is allowed for active calls. Caller/account memory should be drafted after calls and saved according to tenant policy.

## Storage

Use Postgres as source of truth and pgvector for semantic retrieval. Store source references, confidence, approval state, retention state, and audit metadata.

## Controls

Tenant users can view, edit, delete, disable, approve, reject, and audit memory. Retention policies must purge memory and embeddings.

## Safety

Do not automatically persist sensitive data. Memory extraction must filter secrets, regulated data, payment data, and irrelevant personal details. Retrieved memory must be clearly separated from system instructions.
