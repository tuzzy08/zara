# Roadmap

## Feature Delivery Order

Issues are grouped so each completed set leaves one product capability working end to end.

1. Foundation and access base: ISSUE-001 through ISSUE-008, plus ISSUE-083, ISSUE-098, and ISSUE-099. This slice is implemented. It gives the monorepo, API shell, shared packages, env/secrets, frontend auth gates, CI, tenant shell, and workspace domain model.
2. Basic workflow builder: ISSUE-009, ISSUE-010, and ISSUE-015. This gives a React Flow canvas, agent role configuration, deterministic graph serialization, and publish-blocking validation. This slice is implemented as the current builder baseline.
3. Publishable workflow draft: ISSUE-011 through ISSUE-014, ISSUE-016, and ISSUE-017. This slice is implemented. The builder now supports tool, handoff, condition, escalation, and exit nodes, immutable version publishing, and draft runtime manifest preview.
4. Sandbox runtime: ISSUE-018 through ISSUE-025. This slice is implemented. It makes a validated published draft testable in a browser call with runtime events and cost estimates.
5. Live audio sandbox expansion: ISSUE-109 through ISSUE-115. This slice is implemented. It replaces local simulation with Nest-owned live sandbox transport, AssemblyAI streaming STT, Cartesia Sonic 3 streaming TTS, draft-manifest execution on `/workflows`, published-manifest execution on `/sandbox`, live tool execution, and transport-token hardening.
6. Telephony hardening gate: ISSUE-107 and ISSUE-038. This slice is implemented. Telephony state now persists through normalized Postgres tables and provider secrets are stored as encrypted envelopes with rotation metadata before broader provider expansion.
7. Telephony MVP expansion: ISSUE-027, ISSUE-028, ISSUE-033, and ISSUE-035, on top of the already implemented ISSUE-026, ISSUE-029, ISSUE-030, ISSUE-031, ISSUE-032, ISSUE-034, and ISSUE-036. This slice is implemented. Zara now supports platform-managed telephony, BYO SIP, outbound calling, advanced call handling, durable provider heartbeats, and provider-native execution history.
8. Integrations and tools: ISSUE-039 through ISSUE-046. This slice is implemented. It connects OAuth-backed CRM/productivity tools and grants them to workflow nodes.
9. Memory and knowledge: ISSUE-047 through ISSUE-054. This slice is implemented. It adds scoped agent memory, retrieval, approval, editing, deletion, ingestion, and retention.
10. Monitoring and escalation: ISSUE-055 through ISSUE-063. This slice is implemented. It gives operators live calls, transcripts, telemetry, human takeover, summaries, sync status, and improvement signals.
11. Security, compliance, billing, and production: ISSUE-064 through ISSUE-082. This slice is implemented. It hardens tenant isolation, consent, redaction, abuse controls, metering, deployments, observability, backup, fallback, and readiness.
12. Platform admin: ISSUE-084 through ISSUE-097. This slice is implemented. It gives Zara staff platform-role-gated access, tenant oversight, support tools, provider operations, billing controls, audit filtering, impersonation, abuse/compliance review, and separate admin deployment config.
13. Workspace product layer: ISSUE-099 through ISSUE-102. This slice is implemented. It adds workspace creation, switching, workflow scoping, sandbox access control, settings, and role management.
14. Workflow builder enhancements: ISSUE-116 and ISSUE-117. This slice is implemented. It adds persisted reusable specialist templates and richer multi-language role controls after the baseline builder is closed.
15. Tenant app pages and payments: ISSUE-118 through ISSUE-121. This slice is implemented. It replaces placeholder sidebar routes for integrations, memory, and billing, then wires Polar-backed subscriptions, checkout, customer portal, webhooks, usage events, and payment state into tenant billing controls.
16. Workflow builder relationship rules: ISSUE-122 and ISSUE-123. This slice is implemented. The canonical node relationship policy now lives in shared core validation and the visual builder, and the builder now exposes policy-aware toolbar affordances plus repair UX for stale relationships.
17. Live sandbox architecture deepening: ISSUE-124. This slice is implemented. It deepens the live sandbox session spine by moving turn routing behind a smaller module interface while preserving the existing live-session API contract.

## Foundation

Workspace, NestJS API, two Vite React apps, shared frontend packages, shared types, Postgres migrations, Better Auth organizations, CI, environment config, and secrets strategy.

## MVP Builder

Dashboard shell using Tailwind CSS v4 and customized shadcn/ui primitives, React Flow builder, role/tool/handoff/condition/escalation/exit nodes, request-aware tool configuration, validation, publishing, and manifest preview.

Builder enhancement follow-ups are now implemented separately from the closed baseline builder slice: ISSUE-116 covers reusable specialist role templates, and ISSUE-117 covers richer multi-language role controls.

Current follow-up note: ISSUE-122 centralizes workflow node relationship rules in `@zara/core`. ISSUE-123 completes the UI slice by making builder node actions obey that policy, adding relationship repair for stale drafts, and browser-validating clear-canvas recovery, tool call/result auto-links, invalid action disablement, and repair without console errors.

## Platform Admin

Separate platform-admin app, platform role model, admin auth gate, admin dashboard, tenant operations, support tools, provider health, usage controls, audit logs, impersonation, abuse/compliance review, and admin deployment/domain config.

Current sequencing note: the platform-admin slice is now implemented across ISSUE-084 through ISSUE-097. Nest exposes guarded staff APIs for dashboard, organizations, users, telephony, integrations, runtime health, usage and billing controls, audit logs, impersonation sessions, and abuse/compliance reviews. The `apps/platform-admin` Vite app has an independent shell, route set, auth gate, environment file, and deployment security-header config for the admin origin.

## Sandbox

Runtime manifest compiler, cost-optimized sandwich adapter, runtime profiles, model router, event stream, cost estimation, browser sandbox call, workspace-scoped sandbox workflow loading, and live browser transport shared between draft and published runs.

Current sequencing note: draft and published sandbox runs now share the Nest-owned live browser transport using AssemblyAI for STT and Cartesia Sonic 3 for TTS. Tool nodes, node transitions, provider telemetry, per-turn cost deltas, transport token hardening, browser reconnect, and the first workspace-scoped sandbox monitor depth are now in place across ISSUE-055, ISSUE-056, ISSUE-109, ISSUE-113, ISSUE-114, and ISSUE-115. ISSUE-124 deepens the live session spine by moving route traversal behind a smaller tested module interface before broader monitoring work builds further on it.

## Telephony MVP

Telephony connection model, platform-managed connection, BYO SIP, BYO Twilio, number import, webhooks, inbound/outbound dispatch, recording policy, DTMF/voicemail/transfer/failover, health checks.

Current sequencing note: the Twilio-first inbound slice, hardening gate, and telephony MVP expansion are in place. Telephony now runs on normalized Postgres-backed state, encrypted credential envelopes, durable provider heartbeats, and provider-native execution sessions with command history.

## Integrations

OAuth framework, encrypted credential storage, Zendesk, HubSpot, Google Workspace, Notion, webhook tools, health/revocation, and permission grants.

## Monitoring

Session/caller/account/tenant memory, pgvector retrieval, extraction, approval, live monitor, event timeline, telemetry, escalation queue, human fallback, summaries, CRM sync, and improvement suggestions.

## Production

Tenant isolation, audit, consent, retention, secrets rotation, prompt injection defenses, outbound compliance, redaction, usage metering, budgets, deployments, observability, backup/DR, provider fallback, and production readiness.

Current sequencing note: audit logging, call consent/recording notices, retention deletion jobs, secrets encryption and key rotation metadata, prompt-injection defenses, outbound abuse rate limits, DNC/timezone calling controls, redaction, compliance readiness, usage metering, telephony minute accounting, runtime cost accounting, tenant budget controls, production/staging deployment plans, observability dashboards, backup and disaster recovery, provider outage fallback, and final production readiness gates are in place for ISSUE-064 through ISSUE-082. Tenant compliance APIs now expose hash-chained audit logs, general SaaS readiness posture, and retention job orchestration for telephony, memory, and recording deletion targets.

Tenant billing production work now includes the tenant billing page and Polar-backed checkout, subscription, customer portal, webhook, usage-billing integration, feature usage aggregates, provider-connection telephony minute accounting, runtime cost accounting, and configurable tenant budget enforcement.

Deployment planning now includes separate production and staging runbooks covering release flow, secrets, migrations, rollback, smoke tests, staging parity, safe seed data, validation, drift controls, observability dashboards, backup/DR restore checks, and final release-gate ownership.
