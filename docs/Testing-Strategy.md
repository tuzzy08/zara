# Testing Strategy

## Test Layers

- Unit: domain policies, validators, manifest compiler, routing, memory filters, cost estimation.
- Integration: NestJS modules, database, auth, connectors, telephony webhooks, queues.
- Contract: public API routes, runtime event schemas, connector tool schemas.
- Security: tenant isolation, RBAC, secrets, webhook signatures, prompt injection.
- Runtime: STT/model/TTS adapter contracts, event ordering, idempotency, fallback.
- Telephony: BYO Twilio, BYO SIP, platform routing, DTMF, voicemail, failover.
- UI: light smoke tests for builder, sandbox, monitor, memory management.
- Platform admin UI: light smoke tests for login gate, dashboard load, and impersonation banner.

## Required For Completion

Each issue must include tests appropriate to its layer. If tests are deferred, the handover must explain why and record the risk.

## Auth And Admin Tests

- Tenant users cannot access platform-admin APIs.
- Tenant admins are not platform admins.
- Platform readonly users cannot mutate tenant status, impersonate, or change plans.
- Platform admin actions create audit records.
- Both Vite apps can establish Better Auth sessions against the NestJS API with trusted origins configured.

## Tenant Isolation Regression Tests

Automated controller tests now cover cross-tenant ID guessing across live call sessions, memory, integrations, and telephony. These tests assert that another tenant cannot read or mutate session events, quality reports, CRM sync state, memory drafts, knowledge ingestion jobs, connector state, webhook tools, tool grants, telephony numbers, or call-control records by guessing IDs.
