# Architecture

## System Shape

Zara has three major planes:

- Control plane: NestJS API, Postgres, Better Auth, workflow publishing, integrations, telephony config, memory, billing, and audit.
- Realtime plane: active call sessions, audio/runtime adapters, call event stream, live monitoring, and interruption handling.
- Workflow plane: durable retries, post-call summaries, CRM sync, memory extraction, improvement suggestions, and approval workflows.

## Primary Stack

- TypeScript everywhere.
- NestJS for the SaaS backend.
- Postgres as system of record.
- pgvector for v1 memory retrieval.
- Better Auth for users, organizations, sessions, roles, platform roles, and invitations.
- Workspaces as a product-scoping layer below tenant organizations for workflows, sandbox runs, monitoring views, and future workspace-level access policy.
- Two Vite React apps: `apps/web` for tenants and `apps/platform-admin` for Zara staff.
- Tailwind CSS v4 and shadcn/ui for frontend styling and component primitives.
- Lucide for product and admin iconography.
- React Flow inside `apps/web` for the visual workflow builder.
- Cloudflare Durable Objects may be used for live session state and WebSocket fanout.
- Temporal or a queue/workflow engine should be used for durable background work.

## Deep Module Seams

Recent architecture-deepening passes keep public contracts stable while moving reusable behavior behind smaller module interfaces:

- Live sandbox turn routing is resolved by `apps/api/src/sandbox-live-sessions/sandbox-live-session-router.ts`. That module owns condition branch traversal, tool invocation collection, handoff pre-events, terminal exit responses, and stale or empty frontier fallback while the existing live-session HTTP and websocket contracts stay unchanged.
- The tenant workflow builder delegates selected-node action state, route-target eligibility, canonical relationship decisions, and React Flow handle-role mapping to `apps/web/src/workflowBuilderWorkbench.ts`. The screen remains responsible for rendering and orchestration, while `@zara/core` remains the source of truth for the relationship policy.
- File-backed tenant state adapters for billing, integrations, memory, and telephony test/support paths share `apps/api/src/persistence/tenant-json-state.repository.ts` for tenant JSON path resolution, listing, validated load, atomic save, optional corrupt snapshot quarantine, encoded tenant filenames, and trailing-newline behavior. Feature repositories still own domain validation, normalization, encryption references, and public API shape. The production telephony module continues to use the Postgres repository.

## Runtime Strategy

The default voice runtime is cost-optimized sandwich:

1. Stream caller audio to STT.
2. Route transcript through rules/model policy.
3. Use a cheap or standard text model where safe.
4. Stream text to TTS.
5. Emit structured call events at every stage.

The default live sandbox and browser-call provider stack for this sandwich runtime is:

- AssemblyAI streaming STT for browser and test-call audio transcription.
- OpenAI chat models by default, with Google Gemini selectable per agent role through the text-model router for routed cheap/standard/sota responses inside the sandwich pipeline.
- Cartesia Sonic 3 streaming TTS for browser and test-call voice playback.

Sandbox browser clients do not talk directly to long-lived provider credentials. The browser connects to Zara-controlled realtime session transport, and NestJS owns the provider sessions, routing, model-provider selection, and event fanout.

OpenAI Realtime speech-to-speech is the default premium realtime provider for calls or nodes that need very low latency, natural turn-taking, or high-value treatment. Google Gemini Live is also selectable as a server-owned premium realtime provider option; browser clients still receive Zara-controlled session transports rather than direct provider URLs or credentials.

The next runtime orchestration standardization slice is documented in:

- `docs/Turn-Runtime-Packet-v1.md`
- `docs/Intent-Routing-Standard.md`
- `docs/Agent-Tool-And-Transfer-Standard.md`
- `docs/Runtime-Orchestration-Edge-Cases-And-Policies.md`

Those docs define the target turn-scoped packet, model-backed intent routing, discretionary agent toolbelts, structured transfer context, and the policy guards that should replace ad hoc event-derived context as the runtime evolves.

## Frontend Apps

Zara uses separate frontend applications with separate deployment origins:

- `apps/web`: tenant-facing product app for dashboard, builder, sandbox, telephony, integrations, memory, monitoring, and billing. Suggested production origin: `https://app.zara.ai`.
- `apps/platform-admin`: internal Zara staff app for tenant oversight, provider operations, abuse/compliance review, billing operations, audit logs, and impersonation. Suggested production origin: `https://admin.zara.ai`.

Both apps use the same NestJS API and Better Auth authority. Both apps should be built with Tailwind CSS v4 and shadcn/ui primitives, then customized to match `DESIGN.md` rather than shipping stock component styling. Frontend guards improve user experience, but NestJS guards are the source of truth for tenant permissions and platform-admin permissions.

## Telephony Strategy

Telephony is a tenant connection, not a single platform assumption.

- platform_managed: Zara owns the provider account, numbers, and trunks.
- byo_sip_trunk: tenant provides SIP trunk credentials and routes.
- byo_provider_account: tenant connects provider account credentials, starting with Twilio.

All calls resolve a workspace, telephony connection, published workflow version, runtime profile, memory policy, integration permissions, and escalation policy before starting.

## Data Flow

1. Tenant selects or creates a workspace.
2. Tenant builds a workflow graph in that workspace.
2. Validator checks graph and required resources.
3. Tenant publishes immutable version with the workspace ID attached.
4. Runtime manifest compiler creates a versioned workspace-scoped manifest.
5. Sandbox or telephony event starts a call inside an accessible workspace.
6. Browser sandbox sessions connect to the realtime plane through a Zara-authenticated transport and stream microphone audio into the configured runtime pipeline.
7. STT, model routing, tool execution, node transitions, and TTS all execute against the active manifest.
8. Runtime emits structured events plus audio output.
9. Live monitor consumes event stream.
10. Post-call workflows summarize, sync integrations, extract memory drafts, meter usage, and create improvement suggestions.

## Trust Boundaries

- Tenant data must be isolated at every API, query, memory, telephony, integration, and event boundary.
- Workspace-scoped resources must be filtered by both tenant ID and workspace ID; organization membership alone is not enough for workspace actions.
- Platform-admin access is separate from tenant-admin access and must be audited.
- Tool outputs and knowledge retrieval are untrusted content.
- Secrets are stored encrypted and only resolved inside connector/runtime execution.
- Browser sandbox sessions receive short-lived session tokens only; provider API keys and long-lived credentials stay server side.
- Platform runtime prompt policies are edited by platform-admin staff and consumed server-side by runtime providers; tenant agents supply identity and instructions, but global guardrails and role templates remain platform-controlled.
- Published workflow versions are immutable; active calls do not change mid-call.
