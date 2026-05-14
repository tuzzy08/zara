# Feature Flows

## Builder

Tenant selects a workspace, creates a draft workflow, adds role/tool/handoff/condition/escalation nodes, validates the graph, previews a runtime manifest, tests in sandbox, then opens a publish dialog to name the workflow release and choose a workspace before creating an immutable version.

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
- Published workflow versions are workspace-scoped. `Run in sandbox` moves the tenant shell into the published workflow's workspace before opening the sandbox so the sandbox selector never crosses workspace boundaries by accident.
- Draft manifest preview now shows runtime, telephony, memory scopes, budget, tool request posture, condition routes, exit nodes, escalation policy, and serialized manifest size before publish.

The runtime-profile slice adds workflow-level runtime policy selection plus per-agent overrides. Builders can switch the draft between cost-optimized, balanced, and premium realtime before publish, and agent inspectors can override the workflow policy when a specialist lane needs stronger routing or lower-latency treatment.

## Workspaces

Tenant users switch workspaces from the tenant shell and can create a new workspace with a production-facing name. The tenant app now loads accessible workspaces, memberships, and audit history from NestJS workspace routes, while the browser only keeps the last active workspace ID for UX continuity between reloads. Workspace access is a product scope below the tenant organization: users may belong to the organization without having access to every workspace.

Workspace admins can now rename, archive, and restore workspaces, manage workspace member roles, and inspect an API-backed audit trail for workspace access plus membership changes. Final-owner protection and archive blocking when active sessions exist are enforced through shared `@zara/core` domain rules and surfaced through Nest conflict responses. The tenant shell applies small optimistic updates for create, rename, and membership edits, then reconciles against the latest API response so slower initial loads cannot overwrite fresher mutations.

## Frontend Auth

Tenant users sign in through `apps/web`, select or create an organization, and operate inside tenant-scoped roles. Zara staff sign in through `apps/platform-admin`, where access requires a platform role. Both apps use the same Better Auth backend, but different origins, route trees, UI shells, and guard policies.

## Sandbox

User starts a browser call, grants mic access, selects a published or draft-safe workflow, talks to the agent, observes transcript/events/cost, triggers simulated tools, and receives a post-call summary.

The current runtime foundation compiles published workflows into deterministic runtime manifests, applies a cost-first routing policy per turn, and runs the default STT -> text model -> TTS sandwich adapter with ordered event emission and predictable degradation for provider faults.

The first browser sandbox slice is implemented in `apps/web` at `/sandbox`. It loads published workflow versions for the active workspace, starts a typed or microphone-attempted browser sandbox session, runs caller turns through the shared sandwich runtime, records transcript entries, replays the live event stream, triggers simulated tools, and shows runtime decision plus estimated cost telemetry.

The workflow builder also supports pre-publish draft testing directly on `/workflows`. `Run in sandbox` opens a right-side sandbox drawer instead of navigating away, with start controls, typed caller input, transcript output, draft routing summary, tool posture, and a close button. This lets builders inspect the current unpublished graph before creating an immutable published version. The standalone sandbox page remains the place to test and compare existing published workflows. The session currently runs in-browser against shared `@zara/core` contracts; the future NestJS runtime API should preserve these contracts when execution moves server-side.

Balanced workflows surface stronger routing floors and higher-quality TTS in both the draft drawer and the published sandbox. Premium realtime workflows now request a server session from NestJS via `POST /runtime/realtime/sessions` when a published sandbox run starts, then show the returned transport URL, expiry, and policy state inside the sandbox before the in-browser turn simulation proceeds. If the control plane rejects premium startup because of budget or availability, the sandbox surfaces that failure inline instead of silently falling back.

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
