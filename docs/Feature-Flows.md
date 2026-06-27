# Feature Flows

## Builder

Tenant selects a workspace, creates a draft workflow, adds agent/tool/escalation/exit nodes, validates the graph, previews a runtime manifest, publishes the workflow, then tests the immutable published version in sandbox. `Run in sandbox` opens the publish flow for unpublished or dirty drafts and opens the inline browser sandbox only for an unchanged published version. Legacy handoff and condition/intent-route node support has been removed from the tenant builder; old snapshots should be recreated through fresh workflows that use agent-attached route policy behavior.

The first completed builder slice covers ISSUE-009, ISSUE-010, and ISSUE-015. It provides the tenant workflow screen at `apps/web` `/workflows`, a React Flow canvas, add/connect/delete/move graph interactions, agent role editing, deterministic graph serialization, and shared validation that blocks publishing when required agent fields, entry paths, unsafe cycles, unreachable nodes, or tool authorization are invalid.

The second builder slice covers ISSUE-011, ISSUE-012, and ISSUE-014 as one publishable-draft step:

- Tool nodes bind to a permitted connector tool, surface connector/risk/approval state, and block publish if credentials are missing or revoked.
- Specialist routing now uses agent-attached route policy behavior instead of separate tenant-managed handoff nodes.
- Human escalation nodes bind to a live queue and fallback mode, then feed the internal draft manifest with queue and fallback policy details.

The runtime orchestration standard refines this baseline: agent-attached route policies now expose configured target agents as an internal handoff action/tool chosen by the active router agent, without requiring visible tenant-managed intent or handoff nodes. Tools are agent-assigned capabilities used at the agent's discretion, router agents keep those normal tools, and transfer context is created by runtime-validated handoff rather than by model-selected graph targets. See `docs/Intent-Routing-Standard.md`, `docs/Agent-Tool-And-Transfer-Standard.md`, and `docs/Turn-Runtime-Packet-v1.md`.

The third builder slice covers ISSUE-013, ISSUE-016, and ISSUE-017 and completes the first publishable workflow draft:

- Agent-attached route policies define configured branches, fallback posture, and runtime-owned classification without separate tenant-managed condition nodes.
- Exit nodes terminate a route cleanly so publish validation can distinguish a safe terminal path from an unsafe cycle.
- Tool nodes can carry API request metadata for webhook-style actions, including method, request URL, auth token reference, headers, and body template.
- Node creation stays in the top toolbar; the desktop builder uses a dense 70:30 canvas-to-inspector split instead of a separate node library rail.
- Version publishing turns a validated draft into an immutable workflow version snapshot, and active calls pin to that published version instead of following later draft edits.
- Published workflow versions are workspace-scoped. `Run in sandbox` moves the tenant shell into the published workflow's workspace before opening the sandbox so the sandbox selector never crosses workspace boundaries by accident.
- Draft manifest preview now shows runtime, telephony, memory scopes, budget, tool request posture, agent-attached route policies, exit nodes, escalation policy, and serialized manifest size before publish.

The runtime-profile slice adds workflow-level runtime policy selection plus per-agent overrides. Builders can switch the draft between cost-optimized, balanced, and premium realtime before publish, and agent inspectors can override the workflow policy when a specialist lane needs stronger routing or lower-latency treatment.

## Workspaces

Tenant users switch workspaces from the tenant shell and can create a new workspace with a production-facing name. The tenant app now loads accessible workspaces, memberships, and audit history from NestJS workspace routes, while the browser only keeps the last active workspace ID for UX continuity between reloads. Workspace access is a product scope below the tenant organization: users may belong to the organization without having access to every workspace.

Workspace admins can now rename, archive, and restore workspaces, manage workspace member roles, and inspect an API-backed audit trail for workspace access plus membership changes. Final-owner protection and archive blocking when active sessions exist are enforced through shared `@zara/core` domain rules and surfaced through Nest conflict responses. The tenant shell applies small optimistic updates for create, rename, and membership edits, then reconciles against the latest API response so slower initial loads cannot overwrite fresher mutations.

## Frontend Auth

Tenant users sign in through `apps/web`, select or create an organization, and operate inside tenant-scoped roles. Zara staff sign in through `apps/platform-admin`, where access requires a server-resolved platform role plus staff auth posture. Password-only staff sessions can read according to role, while support/admin mutations and impersonation require MFA or passkey assurance. Both apps use the same Better Auth backend, but different origins, route trees, UI shells, and guard policies.

## Sandbox

User starts a browser call, grants mic access, selects a published or draft-safe workflow, talks to the agent, observes transcript/events/cost, and watches the real workflow path execute node by node through the live runtime.

The current runtime foundation compiles published workflows into deterministic runtime manifests, applies a cost-first routing policy per turn, and runs the default STT -> text model -> TTS sandwich adapter with ordered event emission and predictable degradation for provider faults.

The published sandbox slice is implemented in `apps/web` at `/sandbox`. It loads published workflow versions for the active workspace, starts a voice browser sandbox session through Nest live-session APIs, runs caller turns through the shared sandwich runtime, records transcript entries, plays returned audio, renders the live event stream, and shows runtime decision plus estimated cost telemetry.

The workflow builder supports published-version browser testing directly on `/workflows`. `Run in sandbox` opens the publish flow for unpublished or dirty graphs; once the selected graph is an unchanged published version, it opens a right-side sandbox drawer with live start controls, microphone capture, transcript output, runtime event rendering, tool posture, and a close button. When the same workflow already has a routed live number in the active workspace, the drawer can switch into Phone test (Twilio/PSTN) mode and deep-link to the shared `/sandbox` Phone test surface for that exact published version and number. The standalone sandbox page remains the place to test and compare existing published workflows.

Balanced workflows surface stronger routing floors and higher-quality TTS in both the draft drawer and the published sandbox. Premium realtime workflows now start through the same live session transport as the sandwich profiles, with the runtime profile embedded in the manifest that the browser submits to Nest. If the control plane rejects startup because of budget or availability, the sandbox surfaces that failure inline instead of silently falling back.

The live browser sandbox now runs through the Nest-owned session transport:

- `/workflows` published mode compiles the selected immutable version and starts a live audio sandbox session from the builder drawer.
- `/sandbox` starts the same live pipeline for published workflow versions.
- NestJS owns the realtime session transport, provider auth, AssemblyAI streaming STT, model routing, node transitions, Cartesia Sonic 3 streaming TTS, and event fanout.
- Both surfaces request microphone access for voice mode; the tenant web client is voice-only and does not expose typed sandbox turns.
- Routed-number mode verifies telephony posture, then executes the published workflow through the same live sandbox transport instead of replaying local turns.
- Tool nodes now execute inside the live sandbox turn path instead of being simulated, and the browser surfaces readable tool, routing, handoff, provider, and per-turn cost events while the call is running.
- Published sandbox runs now persist enough session metadata to reconnect after a browser refresh. On resume, the browser requests a fresh transport token, replays the stored event history, restores the transcript and routing state, and continues on the same live session ID.
- The standalone `/sandbox` page now includes a live monitor rail for active sandbox calls. Operators can refresh workspace-scoped live sessions, inspect active agent and runtime tier, and replay a redacted transcript plus event timeline from the persisted sandbox event history.

NestJS creates workspace-scoped live sandbox session records, issues short-lived transport tokens, buffers browser audio frames, transcribes them through AssemblyAI, routes the resulting transcript through the active workflow frontier, generates the agent reply through the sandwich text model provider, synthesizes reply audio through Cartesia, and fans the resulting transcript plus runtime events back out over the websocket transport.

The PSTN live call runtime extends the same sandbox concept with Phone test mode. Operators choose Published test (browser) for browser checks against immutable versions and Phone test (Twilio/PSTN) for real phone calls against an exact published version and protected `test_route`. Phone tests require an allowed caller number and waiting session expiry, show active session/checklist/result state in `/sandbox`, and store the final result before `/calls` can activate that exact version/profile as a live route. Premium realtime PSTN runs stay inside the same Phone test surface, but are labeled as `Premium realtime PSTN (native provider)` and route through `pstn-premium-realtime` after entitlement, provider capability, budget, and fallback-policy gates pass.

## Telephony

The first telephony slice is now live on `apps/web` `/calls`.

Current flow:

1. Tenant operator connects a platform-managed rail, a BYO Twilio account, or a BYO SIP trunk from `/calls`.
2. Zara returns masked credential references and keeps runtime secrets off the client response.
3. Operator validates provider posture or runs a provider heartbeat from the same surface.
4. Zara provisions platform numbers, imports voice-capable Twilio numbers, or registers SIP DIDs.
5. Operator maps a live number to a published workflow in the active workspace.
6. Operator launches Phone test from `/calls`, `/workflows`, or `/sandbox` to create a protected waiting session before routing live calls.
7. Operator activates the live route from the successful Phone test result after subscription, budget, tenant, provider health, credentials, and recording checks pass.
8. Operator can pause or resume the live route from `/calls`; paused routes keep setup/history but do not answer.
9. Twilio webhooks hit NestJS, verify signature, reject invalid signatures, and suppress duplicate `EventSid` replays before resolving inbound routing.

Telephony state, execution sessions, and execution commands persist through the normalized Postgres-backed control plane, so the shared Phone test sandbox can reuse the same number binding and bridge posture the Calls screen already manages.

PSTN media flow:

1. Operator publishes a workflow version.
2. Operator starts a Phone test for a routed number, selected version, runtime profile, allowed caller number, and expiry.
3. Caller dials the number from an allowed phone.
4. Twilio webhook verification and route resolution select the active `test_route`.
5. Twilio connects media to Zara through bidirectional Media Streams.
6. Zara runs the selected PSTN runtime path: `pstn-sandwich` for cost-optimized/balanced calls, or `pstn-premium-realtime` for entitled premium realtime calls with provider-native audio and interruption semantics.
7. The test result stores the required checklist and latency/call-quality classifications.
8. `/calls` can manually activate the exact tested number/version/profile as `live_route` after activation gates pass.

## Integrations

Tenant admin connects a provider through Zara-owned OAuth app. Zara stores encrypted tenant-scoped tokens. Workflow tools are granted access to specific integration connections. Runtime uses connector tools through scoped references.

## Memory

During a call, session memory captures short-term context. After the call, extractor drafts durable caller/account memories. Tenant policy decides whether memories auto-save or require approval. Users can view, edit, delete, disable, and audit memory.

## Monitoring And Escalation

Operators see live calls, current specialist, transcript, events, model tier, tool activity, latency, and cost. Escalation nodes or runtime signals add a call to a queue. If no human is available, the workflow offers callback, ticket creation, or safe voicemail capture.

The first monitoring depth is now live on the published sandbox surface:

- operators can refresh an active sandbox session list for the current workspace
- each session shows current role, runtime tier, status, turn count, and event count
- replay inspection renders a redacted transcript timeline alongside summarized tool and runtime events
- reconnect and replay use the same persisted event spine, so the monitor and the active browser tab stay aligned on the same session history
- escalation requests from live sandbox events now enter a workspace-scoped queue with SLA deadlines, accept/decline actions, and timeout fallback events visible from the sandbox monitor surface
- telephony-backed human fallback now chooses provider-safe live takeover or callback scheduling and audits the safe message sent to the caller
- post-call summaries derive a redacted outcome, disposition, and open action items from the same event spine, then optionally queue a CRM sync target without returning raw credentials or sensitive transcript content
- CRM sync status is visible from the post-call session record, including failed provider diagnostics, retryability, and queued retry attempts
- quality reports flag dead ends, low-grounding hallucination risk, slow turns, and escalation misses, then create draft-only improvement suggestions that require human approval
- AI observability sends packet-derived OpenTelemetry spans to LangSmith when enabled, so internal operators can inspect redacted intent, tool, transfer, model, and policy traces without making LangSmith the tenant event replay or audit source of truth
- Runtime evals replay versioned packet fixtures through LangSmith/Vitest scorecards to catch routing, tool-use, transfer-context, and policy regressions before prompt or model changes ship

## Billing

Usage events are emitted for telephony, STT, model, TTS, storage, integrations, and workflow jobs. Budgets and plan limits can block publish, call start, premium runtime, or outbound campaigns.

## Platform Admin

Zara staff use the platform admin app to inspect tenant health, provider status, telephony failures, connector failures, usage, spend, abuse signals, compliance queues, and audit logs. High-risk actions such as tenant suspension, plan changes, and impersonation are permissioned and audited.
