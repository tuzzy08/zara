# Roadmap

## Feature Delivery Order

Issues are grouped so each completed set leaves one product capability working end to end.

1. Foundation and access base: ISSUE-001 through ISSUE-008, plus ISSUE-083 and ISSUE-098. This gives the monorepo, API shell, shared packages, env/secrets, auth direction, CI, and tenant shell.
2. Basic workflow builder: ISSUE-009, ISSUE-010, and ISSUE-015. This gives a React Flow canvas, agent role configuration, deterministic graph serialization, and publish-blocking validation. This slice is implemented as the current builder baseline.
3. Publishable workflow draft: ISSUE-011 through ISSUE-014, ISSUE-016, and ISSUE-017. This adds tool, handoff, condition, and escalation nodes, then publishes immutable versions and previews runtime manifests.
4. Sandbox runtime: ISSUE-018 through ISSUE-025. This makes a validated draft testable in a browser call with runtime events and cost estimates.
5. Telephony MVP: ISSUE-026 through ISSUE-038. This connects platform-managed telephony, BYO SIP, and BYO Twilio to published workflows.
6. Integrations and tools: ISSUE-039 through ISSUE-046. This connects OAuth-backed CRM/productivity tools and grants them to workflow nodes.
7. Memory and knowledge: ISSUE-047 through ISSUE-054. This adds scoped agent memory, retrieval, approval, editing, deletion, ingestion, and retention.
8. Monitoring and escalation: ISSUE-055 through ISSUE-063. This gives operators live calls, transcripts, telemetry, human takeover, summaries, sync status, and improvement signals.
9. Security, compliance, billing, and production: ISSUE-064 through ISSUE-082. This hardens tenant isolation, consent, redaction, abuse controls, metering, deployments, observability, backup, fallback, and readiness.
10. Platform admin: ISSUE-084 through ISSUE-097. This builds Zara staff access, oversight, support, provider operations, billing controls, audit, impersonation, abuse review, and separate admin deployment.

## Foundation

Workspace, NestJS API, two Vite React apps, shared frontend packages, shared types, Postgres migrations, Better Auth organizations, CI, environment config, and secrets strategy.

## MVP Builder

Dashboard shell using Tailwind CSS v4 and customized shadcn/ui primitives, React Flow builder, role/tool/handoff/condition/escalation nodes, validation, publishing, and manifest preview.

## Platform Admin

Separate platform-admin app, platform role model, admin auth gate, admin dashboard, tenant operations, support tools, provider health, usage controls, audit logs, impersonation, abuse/compliance review, and admin deployment/domain config.

## Sandbox

Runtime manifest compiler, cost-optimized sandwich adapter, runtime profiles, model router, event stream, cost estimation, and browser sandbox call.

## Telephony MVP

Telephony connection model, platform-managed connection, BYO SIP, BYO Twilio, number import, webhooks, inbound/outbound dispatch, recording policy, DTMF/voicemail/transfer/failover, health checks.

## Integrations

OAuth framework, encrypted credential storage, Zendesk, HubSpot, Google Workspace, Notion, webhook tools, health/revocation, and permission grants.

## Monitoring

Session/caller/account/tenant memory, pgvector retrieval, extraction, approval, live monitor, event timeline, telemetry, escalation queue, human fallback, summaries, CRM sync, and improvement suggestions.

## Production

Tenant isolation, audit, consent, retention, secrets rotation, prompt injection defenses, outbound compliance, redaction, usage metering, budgets, deployments, observability, backup/DR, provider fallback, and production readiness.
