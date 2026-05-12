# Feature Flows

## Builder

Tenant creates a draft workflow, adds role/tool/handoff/condition/escalation nodes, validates the graph, previews a runtime manifest, tests in sandbox, then publishes an immutable version.

The first completed builder slice covers ISSUE-009, ISSUE-010, and ISSUE-015. It provides the tenant workflow screen at `apps/web` `/workflows`, a React Flow canvas, add/connect/delete/move graph interactions, agent role editing, deterministic graph serialization, and shared validation that blocks publishing when required agent fields, entry paths, unsafe cycles, unreachable nodes, or tool authorization are invalid.

The second builder slice covers ISSUE-011, ISSUE-012, and ISSUE-014 as one publishable-draft step:

- Tool nodes bind to a permitted connector tool, surface connector/risk/approval state, and block publish if credentials are missing or revoked.
- Handoff nodes explicitly target a specialist role instead of implying specialist routing through agent-to-agent edges.
- Human escalation nodes bind to a live queue and fallback mode, then feed the draft manifest preview with queue and fallback policy details.

The third builder slice covers ISSUE-013, ISSUE-016, and ISSUE-017 and completes the first publishable workflow draft:

- Condition nodes define explicit branch expressions, required fallback paths, and route targets that can point to tools, handoffs, escalation lanes, or exit nodes.
- Exit nodes terminate a route cleanly so publish validation can distinguish a safe terminal path from an unsafe cycle.
- Tool nodes can carry API request metadata for webhook-style actions, including method, request URL, auth token reference, headers, and body template.
- Node creation stays in the top toolbar; the desktop builder uses a dense 70:30 canvas-to-inspector split instead of a separate node library rail.
- Version publishing turns a validated draft into an immutable workflow version snapshot, and active calls pin to that published version instead of following later draft edits.
- Draft manifest preview now shows runtime, telephony, memory scopes, budget, tool request posture, condition routes, exit nodes, escalation policy, and serialized manifest size before publish.

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
