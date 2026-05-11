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
- Two Vite React apps: `apps/web` for tenants and `apps/platform-admin` for Zara staff.
- React Flow inside `apps/web` for the visual workflow builder.
- Cloudflare Durable Objects may be used for live session state and WebSocket fanout.
- Temporal or a queue/workflow engine should be used for durable background work.

## Runtime Strategy

The default voice runtime is cost-optimized sandwich:

1. Stream caller audio to STT.
2. Route transcript through rules/model policy.
3. Use a cheap or standard text model where safe.
4. Stream text to TTS.
5. Emit structured call events at every stage.

OpenAI Realtime speech-to-speech is a premium profile for calls or nodes that need very low latency, natural turn-taking, or high-value treatment.

## Frontend Apps

Zara uses separate frontend applications with separate deployment origins:

- `apps/web`: tenant-facing product app for dashboard, builder, sandbox, telephony, integrations, memory, monitoring, and billing. Suggested production origin: `https://app.zara.ai`.
- `apps/platform-admin`: internal Zara staff app for tenant oversight, provider operations, abuse/compliance review, billing operations, audit logs, and impersonation. Suggested production origin: `https://admin.zara.ai`.

Both apps use the same NestJS API and Better Auth authority. Frontend guards improve user experience, but NestJS guards are the source of truth for tenant permissions and platform-admin permissions.

## Telephony Strategy

Telephony is a tenant connection, not a single platform assumption.

- platform_managed: Zara owns the provider account, numbers, and trunks.
- byo_sip_trunk: tenant provides SIP trunk credentials and routes.
- byo_provider_account: tenant connects provider account credentials, starting with Twilio.

All calls resolve a telephony connection, published workflow version, runtime profile, memory policy, integration permissions, and escalation policy before starting.

## Data Flow

1. Tenant builds a workflow graph.
2. Validator checks graph and required resources.
3. Tenant publishes immutable version.
4. Runtime manifest compiler creates a versioned manifest.
5. Sandbox or telephony event starts a call.
6. Runtime emits structured events.
7. Live monitor consumes event stream.
8. Post-call workflows summarize, sync integrations, extract memory drafts, meter usage, and create improvement suggestions.

## Trust Boundaries

- Tenant data must be isolated at every API, query, memory, telephony, integration, and event boundary.
- Platform-admin access is separate from tenant-admin access and must be audited.
- Tool outputs and knowledge retrieval are untrusted content.
- Secrets are stored encrypted and only resolved inside connector/runtime execution.
- Published workflow versions are immutable; active calls do not change mid-call.
