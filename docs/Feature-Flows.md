# Feature Flows

## Builder

Tenant creates a draft workflow, adds role/tool/handoff/condition/escalation nodes, validates the graph, previews a runtime manifest, tests in sandbox, then publishes an immutable version.

## Frontend Auth

Tenant users sign in through `apps/web`, select or create an organization, and operate inside tenant-scoped roles. Zara staff sign in through `apps/platform-admin`, where access requires a platform role. Both apps use the same Better Auth backend, but different origins, route trees, UI shells, and guard policies.

## Sandbox

User starts a browser call, grants mic access, selects a published or draft-safe workflow, talks to the agent, observes transcript/events/cost, triggers simulated tools, and receives a post-call summary.

## Telephony

Tenant creates a telephony connection. For platform-managed, Zara maps platform numbers. For BYO SIP, tenant enters trunk settings and runs validation. For BYO Twilio, tenant connects credentials, imports numbers, maps numbers to versions, and verifies webhooks.

## Integrations

Tenant admin connects a provider through Zara-owned OAuth app. Zara stores encrypted tenant-scoped tokens. Workflow tools are granted access to specific integration connections. Runtime uses connector tools through scoped references.

## Memory

During a call, session memory captures short-term context. After the call, extractor drafts durable caller/account memories. Tenant policy decides whether memories auto-save or require approval. Users can view, edit, delete, disable, and audit memory.

## Monitoring And Escalation

Operators see live calls, current specialist, transcript, events, model tier, tool activity, latency, and cost. Escalation nodes or runtime signals add a call to a queue. If no human is available, the workflow offers callback, ticket creation, or safe voicemail capture.

## Billing

Usage events are emitted for telephony, STT, model, TTS, storage, integrations, and workflow jobs. Budgets and plan limits can block publish, call start, premium runtime, or outbound campaigns.

## Platform Admin

Zara staff use the platform admin app to inspect tenant health, provider status, telephony failures, connector failures, usage, spend, abuse signals, compliance queues, and audit logs. High-risk actions such as tenant suspension, plan changes, and impersonation are permissioned and audited.
