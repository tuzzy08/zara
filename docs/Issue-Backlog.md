# Issue Backlog

This is the canonical local backlog. External tracker issues must mirror these items. Linear is the current default external tracker unless a future pass explicitly moves issue tracking to GitHub. Every item has a matching handover document in docs/Handovers.

External reconciliation rule: do not create repo-local issues only. Every new issue must include an `External:` line linking the Linear or GitHub tracker issue, and its handover must carry the same external link.

## Feature Slices

Issues should be completed in feature slices so each group leaves one capability working end to end.

- Foundation and access base: ISSUE-001 through ISSUE-008, plus ISSUE-083, ISSUE-098, and ISSUE-099. Implemented baseline: workspace setup, API shell, shared packages, env/secrets, auth organization model, CI, tenant shell, frontend auth gates, and workspace domain model.
- Basic workflow builder: ISSUE-009, ISSUE-010, and ISSUE-015. Implemented baseline: React Flow canvas, agent role inspector, deterministic graph serialization, and shared publish-blocking validation.
- Publishable workflow draft: ISSUE-011 through ISSUE-014, ISSUE-016, and ISSUE-017. Implemented baseline: connector-aware tool nodes, specialist handoff nodes, condition routes, exit nodes, escalation lanes, immutable version publishing, and draft runtime manifest preview.
- Sandbox runtime: ISSUE-018 through ISSUE-025. Implemented baseline: runtime manifest compilation, cost-optimized/balanced/premium runtime policies, model routing, call event stream, runtime cost estimation, and sandbox session orchestration.
- Live audio sandbox expansion: ISSUE-109 through ISSUE-115. Implemented baseline: provider-backed live sandbox transport, AssemblyAI STT, Cartesia TTS, draft and published live execution, live tool telemetry, and browser token hardening.
- Telephony hardening gate: ISSUE-107 and ISSUE-038. Implemented baseline: durable telephony state, encrypted provider-secret envelopes, and Coolify migration-before-API startup before broader provider expansion.
- Telephony MVP: ISSUE-026 through ISSUE-038. Implemented baseline: telephony connection model, platform-managed connection, BYO SIP, BYO Twilio, Twilio number routing, webhooks, inbound/outbound dispatch, recording policy, failover handling, and provider health checks.
- Integrations and tools: ISSUE-039 through ISSUE-046. Implemented baseline: OAuth connection framework, encrypted credentials, Zendesk, HubSpot, Google Workspace, Notion, webhook HTTP tools, connector health/revocation, and tool permission grants.
- Memory and knowledge: ISSUE-047 through ISSUE-054. Implemented baseline: session memory, caller/account memory, tenant knowledge, pgvector retrieval, extraction, approval, edit/delete APIs, ingestion, and privacy/retention enforcement.
- Monitoring and escalation: ISSUE-055 through ISSUE-063. Implemented baseline: live monitor, transcript/event timeline, cost telemetry, escalation queue, human takeover callback fallback, post-call summary, CRM sync status, quality flags, and tenant isolation tests.
- Security, compliance, billing, and production: ISSUE-064 through ISSUE-082. Implemented baseline: tenant isolation and audit, consent, retention, secrets rotation, prompt-injection defense, abuse controls, DNC/timezone controls, redaction, compliance readiness, usage and cost metering, tenant budgets, deployment plans, observability, backup/DR, provider fallback, and final production readiness gates.
- Platform admin: ISSUE-084 through ISSUE-097. Implemented baseline: staff roles, admin app, admin auth gate, dashboard, tenant/user support, telephony/integration/runtime/billing operations, audit, impersonation, abuse review, and deployment config.
- Workspace product layer: ISSUE-099 through ISSUE-102. Implemented baseline: workspace domain model, workspace switcher/creation, workspace-scoped workflows and sandbox runs, and workspace settings/access management.
- Workflow builder enhancements: ISSUE-116 and ISSUE-117. Implemented baseline: reusable workspace-scoped specialist templates, agent/handoff template selection, snapshot-safe published versions, multi-language role controls, language validation, and runtime-facing language prompt metadata.
- Tenant app pages and payments: ISSUE-118 through ISSUE-121. Implemented baseline: tenant integrations with provider logo badges, memory, and billing pages plus Polar checkout, customer portal, webhook, subscription/customer-state, invoice/order, entitlement, and usage-event billing APIs.
- Workflow builder relationship rules: ISSUE-122 and ISSUE-123 are implemented. Current baseline: canonical node relationship policy, shared validation, builder add/connect/reconnect/target controls, policy-aware toolbar affordances, and repair UX all consume the same source, target, edge-kind, and handle-role rules.
- Live sandbox architecture deepening: ISSUE-124 is implemented. Live sandbox turn routing now sits behind a focused module interface while preserving the public live-session API contract.
- Workflow builder architecture deepening: ISSUE-125 is implemented. Workbench relationship decisions, selected-node action state, route-target eligibility, and handle mapping now sit behind a focused module interface while preserving visual builder behavior.
- Tenant JSON state architecture deepening: ISSUE-126 is implemented. Billing, integrations, memory, and telephony file repositories now share tenant-scoped JSON persistence mechanics while preserving feature-specific validation; integrations module wiring treats blank state-directory env values as unset before constructing the shared adapter.
- Agent model provider selection: ISSUE-127 is implemented. Agent role nodes now preserve text model provider/model ID through publish, route live sandbox text turns to OpenAI or Google Gemini, and expose provider/model metadata in sandbox routing events.
- Marketing landing and dedicated auth: ISSUE-130 is implemented. Signed-out visitors now see a voice-agent agency landing page at `/`, while sign-in and sign-up live on dedicated auth routes.
- Tenant auth reactivation: ISSUE-131 is implemented. Tenant email sign-in restores an active Better Auth organization for existing members before app navigation, mirrors Better Auth organizations into the product `tenants` table, treats Better Auth refetch windows as loading instead of missing tenancy, and signup rejects blank tenant organization names before account creation.
- Auth flow hardening: ISSUE-150 through ISSUE-155 are implemented. Current baseline: server-owned auth context, atomic tenant onboarding, explicit tenant/workspace choice, server-owned tenant invitation create/revoke/acceptance with workspace intent, account security/session controls with no-enumeration reset requests, verification email staging, safe session revocation, tenant/platform shell session rendering that avoids Better Auth session, active-organization, and active-member hook readers, production auth-context membership expansion from one Postgres query, production secure cookies/proxy headers/database-backed rate limiting with a normal-read-safe default bucket, required auth email delivery, and platform-admin staff authority with explicit auth assurance, session age, MFA/passkey mutation gates, expired-session safe states, and tenant-only denial states.
- Runtime-aware builder inspector controls: ISSUE-132 is implemented. Builder startup, workflow naming, runtime-specific model controls, language selection, intent fallback-to-caller handling, provider-first tool selection, and tenant-connection-backed tool credential binding now match runtime expectations.
- Runtime orchestration standardization: ISSUE-133 through ISSUE-137 are implemented. Current baseline: turn runtime packet v1 exists in shared core, live sandbox routing emits packet-backed turn metadata, intent routes use a guarded Gemini classifier that writes `IntentRouteResult`, assigned tools compile/run as discretionary agent toolbelt capabilities with structured packet results, routed agents receive structured transfer context, direct transfer loops and transfer language mismatch are guarded, agents with no assigned tools run normal response turns through an explicit empty toolbelt, unsupported structured agent commands are ignored with packet-backed warnings, tool timeout/rate-limit/partial-success outcomes are structured, and tenant-scoped replay stays redacted.
- Runtime observability and evals: ISSUE-138 through ISSUE-140 are implemented. Current baseline: live sandbox turns can emit packet-backed OpenTelemetry spans, export redacted LangSmith AI traces when configured, isolate exporter failures through warning/metrics events, run separate LangSmith/Vitest packet eval fixtures with deterministic and openevals judge-plan scorecards, gate CI/release runtime evals separately, and expose platform-admin-only AI runtime health plus eval regression status.
- Workflow sandbox runtime provider and controls: ISSUE-141 is implemented. Current baseline: draft sandbox runtime display uses the effective entry-role realtime provider/model for premium realtime agents, suppresses stale sandwich-routing text while Gemini Live or OpenAI Realtime is selected, and keeps End Call active while the live session is connecting, listening, active, or playing agent audio.
- PSTN live call runtime: ISSUE-142 through ISSUE-149 are implemented. Current baseline: provider-neutral live call session core with manifest-pinned browser/PSTN sources, ordered lifecycle events, packet-backed turn creation, in-memory coordinator rehydration, explicit scope isolation, no Twilio or sandbox-session dependency, the first `pstn-sandwich` media harness for G.711 mu-law 8 kHz frames, telephony STT/TTS metadata, outbound mu-law frames, latency classifications, TTS fallback, no-frame timeout, barge-in/clear events, the Twilio bidirectional Media Streams bridge with verified webhook TwiML, server-authorized media sockets, inbound message normalization, outbound media/mark/clear sends, DTMF recording, malformed-message safe closure, no raw-media persistence, protected `test_route` lifecycle state with caller allow-lists, expiry, route-mode dispatch records, phone-test checklist results, one unified sandbox Phone test experience across `/calls`, `/workflows`, and `/sandbox`, tenant-wide saved workflow routing selectors, imported-number inbound/outbound selectors, live-control session selectors from persisted dispatch/execution sessions, manual live activation from successful phone tests or audited overrides, pause/resume controls, connection deletion with active inventory/credential cleanup, subscription/budget/tenant activation gates, safe unavailable TwiML for blocked new calls, mid-call grace/closeout/termination policy states, PSTN OpenTelemetry/LangSmith redacted trace projection, platform-admin PSTN call-quality signals, separate `npm run eval:pstn` synthetic Twilio media eval gates, and the separately gated `pstn-premium-realtime` provider path with provider capability, tenant entitlement, budget, fallback-policy, interruption-normalization, and redacted observability coverage.
- Integration registry and knowledge-source expansion: ISSUE-156 through ISSUE-159 are implemented; ISSUE-160 through ISSUE-170 are pending. Current baseline: capability-based provider registry, tenant-safe API-served catalog foundation, tenant frontend consumption of the catalog for current provider/tool surfaces, scoped connection/grant foundations, backend plus tenant-builder publish blocking for invalid agent-tool grants, guided setup presets, setup-copy previews, reconnect prompts for missing provider scopes, mocked provider contracts for built-in tools, structured runtime failure outcomes, integration health degradation, and side-effect ledger safety. Planned follow-ups add knowledge-base source import plus daily sync and the first popular provider expansion batch.

### ISSUE-001: Project workspace setup

- Priority: P0
- Area: Setup
- Milestone: Foundation
- Labels: setup, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-001-project-workspace-setup.md](../docs/Handovers/ISSUE-001-project-workspace-setup.md)

Acceptance criteria:
- npm workspace installs cleanly
- TypeScript project references compile
- Repository has root scripts for typecheck and tests

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Windows PowerShell npm shim
- Empty repo with no prior commits

### ISSUE-002: NestJS API scaffold

- Priority: P0
- Area: Backend
- Milestone: Foundation
- Labels: backend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-002-nestjs-api-scaffold.md](../docs/Handovers/ISSUE-002-nestjs-api-scaffold.md)

Acceptance criteria:
- NestJS app boots in test mode
- Health endpoint is covered by a failing-first test
- Module layout is documented

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Config missing
- Port collision

### ISSUE-003: Shared TypeScript core package

- Priority: P0
- Area: Setup
- Milestone: Foundation
- Labels: setup, backend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-003-shared-typescript-core-package.md](../docs/Handovers/ISSUE-003-shared-typescript-core-package.md)

Acceptance criteria:
- Core package exports public domain types
- No app imports private implementation paths
- Typecheck passes

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Breaking shared contracts
- Circular package imports

### ISSUE-004: Postgres schema and migration setup

- Priority: P0
- Area: Backend
- Milestone: Foundation
- Labels: backend, testing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-004-postgres-schema-and-migration-setup.md](../docs/Handovers/ISSUE-004-postgres-schema-and-migration-setup.md)

Acceptance criteria:
- Migration tool is configured
- Root script can apply generated migrations to Postgres
- Initial schema covers tenant and audit foundations
- Migration checks run in CI

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Failed migration rollback
- Local database unavailable

### ISSUE-005: Better Auth organization model

- Priority: P0
- Area: Backend
- Milestone: Foundation
- Labels: backend, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-005-better-auth-organization-model.md](../docs/Handovers/ISSUE-005-better-auth-organization-model.md)

Acceptance criteria:
- Users can belong to organizations
- Roles gate organization resources
- Session tests cover tenant isolation

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- User removed during session
- Invite accepted twice

### ISSUE-006: CI pipeline with typecheck tests lint and migration checks

- Priority: P0
- Area: DevOps
- Milestone: Foundation
- Labels: devops, testing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-006-ci-pipeline-with-typecheck-tests-lint-and-migration-checks.md](../docs/Handovers/ISSUE-006-ci-pipeline-with-typecheck-tests-lint-and-migration-checks.md)

Acceptance criteria:
- CI runs typecheck, tests, lint, and migration checks
- CI blocks failed checks
- Status is documented

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Flaky dependency install
- Secrets unavailable in forked PR

### ISSUE-007: Environment config and secrets strategy

- Priority: P0
- Area: Security
- Milestone: Foundation
- Labels: security, devops, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-007-environment-config-and-secrets-strategy.md](../docs/Handovers/ISSUE-007-environment-config-and-secrets-strategy.md)

Acceptance criteria:
- Environment schema validates required values
- Secrets are never logged
- Local example env is documented

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Missing env at runtime
- Wrong environment selected

### ISSUE-008: React dashboard shell

- Priority: P1
- Area: Frontend
- Milestone: MVP Builder
- Labels: frontend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-008-react-dashboard-shell.md](../docs/Handovers/ISSUE-008-react-dashboard-shell.md)

Acceptance criteria:
- Authenticated shell renders tenant navigation
- Critical route smoke test exists
- UI tests stay minimal

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- No tenant selected
- Small viewport navigation

### ISSUE-009: React Flow visual builder

- Priority: P1
- Area: Frontend
- Milestone: MVP Builder
- Labels: frontend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-009-react-flow-visual-builder.md](../docs/Handovers/ISSUE-009-react-flow-visual-builder.md)

Acceptance criteria:
- Users can add, move, connect, and delete nodes
- Graph state serializes deterministically
- Core graph operations are unit tested

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Disconnected nodes
- Malformed imported graph

### ISSUE-010: Agent role nodes

- Priority: P1
- Area: Frontend
- Milestone: MVP Builder
- Labels: frontend, runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-010-agent-role-nodes.md](../docs/Handovers/ISSUE-010-agent-role-nodes.md)

Acceptance criteria:
- Role node captures instructions, language policy, and default model tier
- Missing required fields block publish
- Specialist roles are reusable

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Duplicate role names
- Unsupported language

### ISSUE-011: Tool nodes

- Priority: P1
- Area: Frontend
- Milestone: MVP Builder
- Labels: frontend, integrations, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-011-tool-nodes.md](../docs/Handovers/ISSUE-011-tool-nodes.md)

Acceptance criteria:
- Tool node binds to a permitted integration tool
- Risk and approval state are visible
- Missing credentials block publish

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Revoked integration
- High-risk tool without approval

### ISSUE-012: Handoff nodes

- Priority: P1
- Area: Runtime
- Milestone: MVP Builder
- Labels: runtime, frontend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-012-handoff-nodes.md](../docs/Handovers/ISSUE-012-handoff-nodes.md)

Acceptance criteria:
- Handoff node targets a valid specialist
- Manifest distinguishes handoff from agent-as-tool
- Tests cover invalid targets

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Handoff loop
- Specialist disabled

### ISSUE-013: Condition routing nodes

- Priority: P1
- Area: Runtime
- Milestone: MVP Builder
- Labels: runtime, frontend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-013-condition-routing-nodes.md](../docs/Handovers/ISSUE-013-condition-routing-nodes.md)

Acceptance criteria:
- Condition node validates expression shape
- Fallback branch is required
- Router tests cover branch selection

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- No matching branch
- Ambiguous conditions

### ISSUE-014: Human escalation nodes

- Priority: P1
- Area: Runtime
- Milestone: MVP Builder
- Labels: runtime, frontend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-014-human-escalation-nodes.md](../docs/Handovers/ISSUE-014-human-escalation-nodes.md)

Acceptance criteria:
- Escalation node binds to a queue
- Fallback callback behavior is configurable
- Manifest includes escalation policy

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Queue offline
- No available human

### ISSUE-015: Workflow validation

- Priority: P0
- Area: Backend
- Milestone: MVP Builder
- Labels: backend, runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-015-workflow-validation.md](../docs/Handovers/ISSUE-015-workflow-validation.md)

Acceptance criteria:
- Validator catches missing entry, unreachable nodes, unsafe cycles, and missing tool auth
- Validation errors are actionable
- Contract tests cover invalid graphs

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Cycle with exit condition
- Deleted integration used by graph

### ISSUE-016: Version publishing

- Priority: P0
- Area: Backend
- Milestone: MVP Builder
- Labels: backend, runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-016-version-publishing.md](../docs/Handovers/ISSUE-016-version-publishing.md)

Acceptance criteria:
- Published versions are immutable
- Calls pin to a published version
- Draft changes do not affect active calls

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Concurrent publishes
- Rollback to prior version

### ISSUE-017: Runtime manifest preview

- Priority: P1
- Area: Backend
- Milestone: MVP Builder
- Labels: backend, runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-017-runtime-manifest-preview.md](../docs/Handovers/ISSUE-017-runtime-manifest-preview.md)

Acceptance criteria:
- Users can preview compiled manifest before publish
- Preview includes runtime, telephony, memory, tools, and budget
- Schema tests cover preview output

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Missing telephony route
- Budget over limit

### ISSUE-018: Runtime manifest compiler

- Priority: P0
- Area: Runtime
- Milestone: Sandbox
- Labels: runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-018-runtime-manifest-compiler.md](../docs/Handovers/ISSUE-018-runtime-manifest-compiler.md)

Acceptance criteria:
- Compiler converts published workflow to manifest
- Manifest is deterministic and versioned
- Invalid references fail fast

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Deleted tool
- Partial tenant config

### ISSUE-019: Cost optimized sandwich runtime adapter

- Priority: P0
- Area: Runtime
- Milestone: Sandbox
- Labels: runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-019-cost-optimized-sandwich-runtime-adapter.md](../docs/Handovers/ISSUE-019-cost-optimized-sandwich-runtime-adapter.md)

Acceptance criteria:
- Adapter streams STT to text model to TTS
- Call events capture each stage
- Provider failures degrade predictably

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- STT timeout
- TTS first byte delay
- Model stream interruption

### ISSUE-020: Balanced runtime profile

- Priority: P1
- Area: Runtime
- Milestone: Sandbox
- Labels: runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-020-balanced-runtime-profile.md](../docs/Handovers/ISSUE-020-balanced-runtime-profile.md)

Acceptance criteria:
- Balanced profile uses stronger routing and TTS options
- Per-agent override is supported
- Cost estimate reflects profile

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Language fallback
- Provider quota exceeded

### ISSUE-021: Premium OpenAI Realtime profile

- Priority: P1
- Area: Runtime
- Milestone: Sandbox
- Labels: runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-021-premium-openai-realtime-profile.md](../docs/Handovers/ISSUE-021-premium-openai-realtime-profile.md)

Acceptance criteria:
- Premium profile is opt-in by policy
- Session creation is server-side
- Tool and handoff events are observed

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Realtime unavailable
- Budget disallows premium

### ISSUE-022: Model routing policy engine

- Priority: P0
- Area: Runtime
- Milestone: Sandbox
- Labels: runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-022-model-routing-policy-engine.md](../docs/Handovers/ISSUE-022-model-routing-policy-engine.md)

Acceptance criteria:
- Rules select tiers by intent, risk, confidence, language, and call phase
- Tests cover escalation and fallback
- Decision is logged

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Conflicting rules
- Low confidence high-risk call

### ISSUE-023: Call event stream

- Priority: P0
- Area: Runtime
- Milestone: Sandbox
- Labels: runtime, testing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-023-call-event-stream.md](../docs/Handovers/ISSUE-023-call-event-stream.md)

Acceptance criteria:
- Events are ordered and idempotent
- Subscribers receive live updates
- Replay works for post-call analysis

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Reconnect
- Duplicate provider webhook

### ISSUE-024: Runtime budget and cost estimation

- Priority: P1
- Area: Billing
- Milestone: Sandbox
- Labels: billing, runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-024-runtime-budget-and-cost-estimation.md](../docs/Handovers/ISSUE-024-runtime-budget-and-cost-estimation.md)

Acceptance criteria:
- Estimate includes telephony, STT, model, TTS, and storage
- Tenant budgets can block publish or call start
- Usage is attributed by tenant

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Long call
- Provider pricing missing

### ISSUE-025: Sandbox call session

- Priority: P0
- Area: Runtime
- Milestone: Sandbox
- Labels: runtime, frontend, good-first-slice, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-025-sandbox-call-session.md](../docs/Handovers/ISSUE-025-sandbox-call-session.md)

Acceptance criteria:
- Browser sandbox starts a test call
- Simulated tools are available
- Transcript and metrics are recorded

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Mic permission denied
- Sandbox tool throws

### ISSUE-026: Telephony connection model

- Priority: P0
- Area: Telephony
- Milestone: Telephony MVP
- Labels: telephony, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-026-telephony-connection-model.md](../docs/Handovers/ISSUE-026-telephony-connection-model.md)

Acceptance criteria:
- Model supports platform managed, BYO SIP, and BYO provider account
- Credentials are referenced, not exposed
- Tenant isolation is tested

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Provider deleted
- Connection disabled mid-call

### ISSUE-027: Platform managed telephony connection

- Priority: P1
- Area: Telephony
- Milestone: Telephony MVP
- Labels: telephony, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-027-platform-managed-telephony-connection.md](../docs/Handovers/ISSUE-027-platform-managed-telephony-connection.md)

Acceptance criteria:
- Platform numbers can map to agent versions
- Inbound routing is validated
- Recording policy is enforced

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Number unassigned
- Provider outage

### ISSUE-028: BYO SIP trunk connection

- Priority: P1
- Area: Telephony
- Milestone: Telephony MVP
- Labels: telephony, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-028-byo-sip-trunk-connection.md](../docs/Handovers/ISSUE-028-byo-sip-trunk-connection.md)

Acceptance criteria:
- Tenant can configure SIP trunk details
- Validation call checks route health
- Failure messages are actionable

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Bad credentials
- Codec mismatch
- NAT/firewall issue

### ISSUE-029: BYO Twilio provider account connection

- Priority: P1
- Area: Telephony
- Milestone: Telephony MVP
- Labels: telephony, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-029-byo-twilio-provider-account-connection.md](../docs/Handovers/ISSUE-029-byo-twilio-provider-account-connection.md)

Acceptance criteria:
- Tenant can connect Twilio credentials
- Credentials are encrypted
- Account validation is covered

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Revoked token
- Subaccount permissions missing

### ISSUE-030: Twilio number import and routing

- Priority: P1
- Area: Telephony
- Milestone: Telephony MVP
- Labels: telephony, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-030-twilio-number-import-and-routing.md](../docs/Handovers/ISSUE-030-twilio-number-import-and-routing.md)

Acceptance criteria:
- Numbers import from BYO Twilio
- Imported numbers map to published versions
- Webhook setup status is visible

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Duplicate number
- Number lacks voice capability

### ISSUE-031: Telephony webhook handling

- Priority: P0
- Area: Telephony
- Milestone: Telephony MVP
- Labels: telephony, backend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-031-telephony-webhook-handling.md](../docs/Handovers/ISSUE-031-telephony-webhook-handling.md)

Acceptance criteria:
- Webhook signatures are verified
- Events are idempotent
- Unknown events are safely logged

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Replay attack
- Out-of-order events

### ISSUE-032: Inbound call dispatch

- Priority: P0
- Area: Telephony
- Milestone: Telephony MVP
- Labels: telephony, runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-032-inbound-call-dispatch.md](../docs/Handovers/ISSUE-032-inbound-call-dispatch.md)

Acceptance criteria:
- Inbound call resolves tenant and published version
- Dispatch creates call session
- No route returns safe fallback

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Disabled tenant
- No active version

### ISSUE-033: Outbound call dispatch

- Priority: P1
- Area: Telephony
- Milestone: Telephony MVP
- Labels: telephony, compliance, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-033-outbound-call-dispatch.md](../docs/Handovers/ISSUE-033-outbound-call-dispatch.md)

Acceptance criteria:
- Outbound calls enforce consent, budget, and calling window
- Caller ID policy is applied
- Dispatch is auditable

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Do-not-call match
- Timezone blocked

### ISSUE-034: Call recording policy

- Priority: P1
- Area: Compliance
- Milestone: Telephony MVP
- Labels: compliance, telephony, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-034-call-recording-policy.md](../docs/Handovers/ISSUE-034-call-recording-policy.md)

Acceptance criteria:
- Recording consent policy is configurable
- Recording can be disabled by tenant/workflow
- Recording state is logged

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Two-party consent region
- Sensitive data capture

### ISSUE-035: DTMF voicemail transfer and failover handling

- Priority: P1
- Area: Telephony
- Milestone: Telephony MVP
- Labels: telephony, edge-case, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-035-dtmf-voicemail-transfer-and-failover-handling.md](../docs/Handovers/ISSUE-035-dtmf-voicemail-transfer-and-failover-handling.md)

Acceptance criteria:
- DTMF, voicemail, transfer, and failover are first-class events
- Fallback paths are configured
- Edge cases are covered by tests

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Voicemail detected late
- Transfer fails

### ISSUE-036: Provider health checks and test calls

- Priority: P1
- Area: Telephony
- Milestone: Telephony MVP
- Labels: telephony, testing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-036-provider-health-checks-and-test-calls.md](../docs/Handovers/ISSUE-036-provider-health-checks-and-test-calls.md)

Acceptance criteria:
- Health checks run for each provider connection
- Test calls record diagnostics
- Failures block production routing when required

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Provider API down
- False positive health

### ISSUE-037: OAuth connection framework

- Priority: P0
- Area: Integrations
- Milestone: Integrations
- Labels: integrations, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-037-oauth-connection-framework.md](../docs/Handovers/ISSUE-037-oauth-connection-framework.md)

Acceptance criteria:
- Platform OAuth apps support connect and callback
- State parameter prevents CSRF
- Tenant-scoped connection is created

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Callback replay
- User lacks admin role

### ISSUE-038: Encrypted credential storage

- Priority: P0
- Area: Security
- Milestone: Integrations
- Labels: security, integrations, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-038-encrypted-credential-storage.md](../docs/Handovers/ISSUE-038-encrypted-credential-storage.md)

Acceptance criteria:
- Tokens and provider secrets are encrypted at rest
- Key version metadata is stored
- No raw secrets are returned from APIs

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Key rotation
- Decrypt failure

### ISSUE-039: Zendesk connector

- Priority: P1
- Area: Integrations
- Milestone: Integrations
- Labels: integrations, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-039-zendesk-connector.md](../docs/Handovers/ISSUE-039-zendesk-connector.md)

Acceptance criteria:
- Connector can search/create/update tickets
- Tool schemas are typed
- Rate limits are handled

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Expired token
- Ticket field validation

Implementation notes:
- 2026-06-04 follow-up added secure Zendesk API-token configuration with subdomain, email, and API token only. Built-in Zendesk API URLs are connector-owned, not tenant-configurable.
- `zendesk.tickets.create` now uses Zendesk's Tickets API `POST /api/v2/tickets` with a documented top-level `ticket` payload when executed through an API-token profile.
- Zendesk workflow tools use Tickets API semantics because Zara executes them with tenant-owned agent/admin credentials; future end-user submission flows should use a separate Requests API tool.
- Blank `ZARA_INTEGRATION_STATE_DIR` values fall back to the default `.zara/integrations` state store so Zendesk credential saves do not fail with `mkdir("")`.

### ISSUE-040: HubSpot connector

- Priority: P1
- Area: Integrations
- Milestone: Integrations
- Labels: integrations, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-040-hubspot-connector.md](../docs/Handovers/ISSUE-040-hubspot-connector.md)

Acceptance criteria:
- Connector can look up contacts and write notes
- Pipeline updates are permissioned
- Tool errors are recoverable

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Duplicate contacts
- Missing scope

### ISSUE-041: Google Workspace connector

- Priority: P1
- Area: Integrations
- Milestone: Integrations
- Labels: integrations, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-041-google-workspace-connector.md](../docs/Handovers/ISSUE-041-google-workspace-connector.md)

Acceptance criteria:
- Connector can read calendar availability and create events
- Scopes are minimal
- Timezone behavior is tested

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Calendar conflict
- Revoked consent

### ISSUE-042: Notion connector

- Priority: P2
- Area: Integrations
- Milestone: Integrations
- Labels: integrations, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-042-notion-connector.md](../docs/Handovers/ISSUE-042-notion-connector.md)

Acceptance criteria:
- Connector can search knowledge and create pages/tasks
- Workspace selection is stored
- Permission failures are clear

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Page moved
- Shared workspace revoked

### ISSUE-043: Webhook HTTP tool connector

- Priority: P1
- Area: Integrations
- Milestone: Integrations
- Labels: integrations, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-043-webhook-http-tool-connector.md](../docs/Handovers/ISSUE-043-webhook-http-tool-connector.md)

Acceptance criteria:
- Tenant can define HTTP tool schema
- Secrets are injected securely
- Timeout and retry policy are enforced

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Slow endpoint
- Prompt injection in response

### ISSUE-044: Connector health and revocation

- Priority: P1
- Area: Integrations
- Milestone: Integrations
- Labels: integrations, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-044-connector-health-and-revocation.md](../docs/Handovers/ISSUE-044-connector-health-and-revocation.md)

Acceptance criteria:
- Connection health is visible
- Revoked connections disable tools
- Reconnect flow preserves audit history

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Partial outage
- Token refresh failure

### ISSUE-045: Tool permission grants

- Priority: P0
- Area: Integrations
- Milestone: Integrations
- Labels: integrations, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-045-tool-permission-grants.md](../docs/Handovers/ISSUE-045-tool-permission-grants.md)

Acceptance criteria:
- Tools require explicit grants by role/workflow
- High-risk tools can require approval
- Unauthorized calls are blocked

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Role removed
- Grant changed during call

### ISSUE-046: Session memory

- Priority: P0
- Area: Memory
- Milestone: Monitoring
- Labels: memory, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-046-session-memory.md](../docs/Handovers/ISSUE-046-session-memory.md)

Acceptance criteria:
- Active call memory is available within the session
- Session memory is cleared or summarized after call
- Tests cover interruption and resume

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Long call context overflow
- Reconnect

### ISSUE-047: Caller account memory

- Priority: P1
- Area: Memory
- Milestone: Monitoring
- Labels: memory, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-047-caller-account-memory.md](../docs/Handovers/ISSUE-047-caller-account-memory.md)

Acceptance criteria:
- Durable caller/account memory is opt-in
- Memory is tenant scoped
- Retrieval respects caller identity

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Shared phone number
- Wrong account match

### ISSUE-048: Tenant knowledge memory

- Priority: P1
- Area: Memory
- Milestone: Monitoring
- Labels: memory, integrations, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-048-tenant-knowledge-memory.md](../docs/Handovers/ISSUE-048-tenant-knowledge-memory.md)

Acceptance criteria:
- Tenant knowledge can store policies and FAQs
- Sources are traceable
- Retrieval filters by published workflow

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Stale knowledge
- Conflicting sources

### ISSUE-049: pgvector retrieval

- Priority: P1
- Area: Memory
- Milestone: Monitoring
- Labels: memory, backend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-049-pgvector-retrieval.md](../docs/Handovers/ISSUE-049-pgvector-retrieval.md)

Acceptance criteria:
- Embeddings are stored in Postgres pgvector
- Top-k retrieval has scope and confidence filters
- Index migration is documented

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- No results
- Low-confidence match

### ISSUE-050: Memory extraction after calls

- Priority: P1
- Area: Memory
- Milestone: Monitoring
- Labels: memory, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-050-memory-extraction-after-calls.md](../docs/Handovers/ISSUE-050-memory-extraction-after-calls.md)

Acceptance criteria:
- Post-call extractor drafts useful facts
- Sensitive facts are filtered
- Extraction source links to transcript

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- False memory
- Sensitive data

### ISSUE-051: Memory approval workflow

- Priority: P1
- Area: Memory
- Milestone: Monitoring
- Labels: memory, frontend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-051-memory-approval-workflow.md](../docs/Handovers/ISSUE-051-memory-approval-workflow.md)

Acceptance criteria:
- Tenant can require approval before durable memory write
- Approvers can accept, edit, reject
- Audit trail is kept

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Approver unavailable
- Duplicate suggestions

### ISSUE-052: Memory edit delete UI API

- Priority: P1
- Area: Memory
- Milestone: Monitoring
- Labels: memory, frontend, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-052-memory-edit-delete-ui-api.md](../docs/Handovers/ISSUE-052-memory-edit-delete-ui-api.md)

Acceptance criteria:
- Users can view, edit, delete, and disable memory
- Deletion removes embeddings and facts
- Audit records the action

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Delete during active call
- Permission denied

### ISSUE-053: Knowledge ingestion pipeline

- Priority: P1
- Area: Memory
- Milestone: Integrations
- Labels: memory, integrations, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-053-knowledge-ingestion-pipeline.md](../docs/Handovers/ISSUE-053-knowledge-ingestion-pipeline.md)

Acceptance criteria:
- Pipeline ingests docs, websites, PDFs, Notion, Google Drive, and CRM help centers
- Ingestion status is visible
- Failures are retryable

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Large file
- Unsupported content type

### ISSUE-054: Memory privacy and retention enforcement

- Priority: P0
- Area: Compliance
- Milestone: Monitoring
- Labels: memory, compliance, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-054-memory-privacy-and-retention-enforcement.md](../docs/Handovers/ISSUE-054-memory-privacy-and-retention-enforcement.md)

Acceptance criteria:
- Retention policies purge memory and sources
- Sensitive memory classes are blocked
- Tenant export/delete is supported

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Legal hold
- Partial purge failure

### ISSUE-055: Live call monitor

- Priority: P1
- Area: Frontend
- Milestone: Monitoring
- Labels: frontend, runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-055-live-call-monitor.md](../docs/Handovers/ISSUE-055-live-call-monitor.md)

Acceptance criteria:
- Operators see active calls, agent role, runtime tier, and status
- Critical interactions are covered lightly
- Data comes from event stream

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Event stream disconnect
- Many active calls

### ISSUE-056: Transcript and event timeline

- Priority: P1
- Area: Monitoring
- Milestone: Monitoring
- Labels: runtime, frontend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-056-transcript-and-event-timeline.md](../docs/Handovers/ISSUE-056-transcript-and-event-timeline.md)

Acceptance criteria:
- Timeline shows transcript, tools, handoffs, routing, and errors
- Events can be replayed after call
- Sensitive text is redacted

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Out-of-order events
- Redaction failure

### ISSUE-057: Model tool cost telemetry

- Priority: P1
- Area: Monitoring
- Milestone: Monitoring
- Labels: runtime, billing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-057-model-tool-cost-telemetry.md](../docs/Handovers/ISSUE-057-model-tool-cost-telemetry.md)

Acceptance criteria:
- Telemetry captures model, tool, latency, and cost
- Metrics aggregate by tenant and call
- Tests cover missing usage data

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Provider usage delayed
- Clock skew

### ISSUE-058: Escalation queue

- Priority: P1
- Area: Monitoring
- Milestone: Monitoring
- Labels: runtime, frontend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-058-escalation-queue.md](../docs/Handovers/ISSUE-058-escalation-queue.md)

Acceptance criteria:
- Escalations enter queue with reason and SLA
- Agents can accept or decline
- Fallback is triggered on timeout

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- No humans online
- Duplicate escalation

### ISSUE-059: Human takeover callback fallback

- Priority: P1
- Area: Monitoring
- Milestone: Monitoring
- Labels: runtime, telephony, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-059-human-takeover-callback-fallback.md](../docs/Handovers/ISSUE-059-human-takeover-callback-fallback.md)

Acceptance criteria:
- Takeover or callback fallback follows provider capability
- Caller receives safe message
- Action is audited

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Transfer fails
- Callback number invalid

### ISSUE-060: Post-call summary

- Priority: P1
- Area: Runtime
- Milestone: Monitoring
- Labels: runtime, integrations, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-060-post-call-summary.md](../docs/Handovers/ISSUE-060-post-call-summary.md)

Acceptance criteria:
- Summary includes outcome, action items, and disposition
- Summary sync can target CRM
- Sensitive content is redacted

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Long transcript
- Summary hallucination

### ISSUE-061: CRM sync status

- Priority: P1
- Area: Integrations
- Milestone: Monitoring
- Labels: integrations, monitoring, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-061-crm-sync-status.md](../docs/Handovers/ISSUE-061-crm-sync-status.md)

Acceptance criteria:
- Post-call sync status is visible
- Retries are queued
- Failures include actionable diagnostics

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- CRM outage
- Partial sync

### ISSUE-062: Quality flags and improvement suggestions

- Priority: P2
- Area: Runtime
- Milestone: Monitoring
- Labels: runtime, testing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-062-quality-flags-and-improvement-suggestions.md](../docs/Handovers/ISSUE-062-quality-flags-and-improvement-suggestions.md)

Acceptance criteria:
- System flags dead ends, hallucinations, slow turns, and escalation misses
- Suggestions create draft changes only
- Human approval is required

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Bad suggestion
- Regression risk

### ISSUE-063: Tenant isolation tests

- Priority: P0
- Area: Security
- Milestone: Production
- Labels: security, testing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-063-tenant-isolation-tests.md](../docs/Handovers/ISSUE-063-tenant-isolation-tests.md)

Acceptance criteria:
- Automated tests prove tenant data isolation
- Cross-tenant access returns forbidden/not found
- Covers calls, memory, integrations, telephony

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- ID guessing
- Admin role confusion

### ISSUE-064: Audit logging

- Priority: P0
- Area: Security
- Milestone: Production
- Labels: security, compliance, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-064-audit-logging.md](../docs/Handovers/ISSUE-064-audit-logging.md)

Acceptance criteria:
- Security-sensitive actions create audit records
- Records include actor, tenant, target, and timestamp
- Audit logs are immutable enough for v1

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- System actor
- Failed action logging

### ISSUE-065: Call consent and recording notices

- Priority: P0
- Area: Compliance
- Milestone: Production
- Labels: compliance, telephony, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-065-call-consent-and-recording-notices.md](../docs/Handovers/ISSUE-065-call-consent-and-recording-notices.md)

Acceptance criteria:
- Consent policy can be configured
- Notices play before recording where required
- Consent state is recorded

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Region unknown
- Caller opts out

### ISSUE-066: Retention and deletion workflows

- Priority: P0
- Area: Compliance
- Milestone: Production
- Labels: compliance, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-066-retention-and-deletion-workflows.md](../docs/Handovers/ISSUE-066-retention-and-deletion-workflows.md)

Acceptance criteria:
- Tenant retention policies apply to calls, transcripts, memory, and recordings
- Deletion jobs are auditable
- Failures retry

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Legal hold
- Object storage delete fails

### ISSUE-067: Secrets encryption and key rotation metadata

- Priority: P0
- Area: Security
- Milestone: Production
- Labels: security, devops, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-067-secrets-encryption-and-key-rotation-metadata.md](../docs/Handovers/ISSUE-067-secrets-encryption-and-key-rotation-metadata.md)

Acceptance criteria:
- Secret blobs include key version
- Rotation plan is documented
- Decrypt failures are safe

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Old key unavailable
- Partial rotation

### ISSUE-068: Prompt injection defenses

- Priority: P1
- Area: Security
- Milestone: Production
- Labels: security, runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-068-prompt-injection-defenses.md](../docs/Handovers/ISSUE-068-prompt-injection-defenses.md)

Acceptance criteria:
- Tool outputs and knowledge are treated as untrusted
- System instructions are separated from retrieved content
- Tests cover malicious content

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- CRM note injection
- Website ingestion attack

### ISSUE-069: Outbound abuse rate limits

- Priority: P0
- Area: Compliance
- Milestone: Production
- Labels: compliance, telephony, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-069-outbound-abuse-rate-limits.md](../docs/Handovers/ISSUE-069-outbound-abuse-rate-limits.md)

Acceptance criteria:
- Outbound calls enforce rate limits and consent
- Abuse signals can pause tenant
- Logs support review

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Burst campaign
- Compromised account

### ISSUE-070: Do-not-call and timezone safe calling windows

- Priority: P0
- Area: Compliance
- Milestone: Production
- Labels: compliance, telephony, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-070-do-not-call-and-timezone-safe-calling-windows.md](../docs/Handovers/ISSUE-070-do-not-call-and-timezone-safe-calling-windows.md)

Acceptance criteria:
- DNC list blocks outbound calls
- Timezone windows are enforced
- Overrides require audit

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Unknown timezone
- Emergency callback

### ISSUE-071: Redaction pipeline

- Priority: P0
- Area: Security
- Milestone: Production
- Labels: security, compliance, runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-071-redaction-pipeline.md](../docs/Handovers/ISSUE-071-redaction-pipeline.md)

Acceptance criteria:
- PII/sensitive data redaction runs before storage where configured
- Original access is restricted
- Tests cover transcripts and summaries

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- False positive
- Streaming partial redaction

### ISSUE-072: General SaaS compliance readiness

- Priority: P1
- Area: Compliance
- Milestone: Production
- Labels: compliance, security, devops, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-072-general-saas-compliance-readiness.md](../docs/Handovers/ISSUE-072-general-saas-compliance-readiness.md)

Acceptance criteria:
- Readiness checklist covers encryption, audit, retention, consent, and access control
- No HIPAA/PCI claims are made
- Known gaps are documented

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Enterprise asks for regulated data
- Data residency request

### ISSUE-073: Usage metering

- Priority: P0
- Area: Billing
- Milestone: Production
- Labels: billing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-073-usage-metering.md](../docs/Handovers/ISSUE-073-usage-metering.md)

Acceptance criteria:
- Usage events are recorded idempotently
- Usage aggregates by tenant and feature
- Tests cover duplicate events

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Delayed provider usage
- Clock skew

### ISSUE-074: Telephony minute accounting

- Priority: P1
- Area: Billing
- Milestone: Production
- Labels: billing, telephony, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-074-telephony-minute-accounting.md](../docs/Handovers/ISSUE-074-telephony-minute-accounting.md)

Acceptance criteria:
- Minutes are computed by provider connection and tenant
- Rounding policy is documented
- Failed calls are classified

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Transferred call
- Provider mismatch

### ISSUE-075: Model STT TTS cost accounting

- Priority: P1
- Area: Billing
- Milestone: Production
- Labels: billing, runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-075-model-stt-tts-cost-accounting.md](../docs/Handovers/ISSUE-075-model-stt-tts-cost-accounting.md)

Acceptance criteria:
- Model/STT/TTS usage maps to runtime events
- Cost rates are versioned
- Unknown rates are flagged

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Provider pricing change
- Missing usage tokens

### ISSUE-076: Plan limits and tenant budgets

- Priority: P1
- Area: Billing
- Milestone: Production
- Labels: billing, backend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-076-plan-limits-and-tenant-budgets.md](../docs/Handovers/ISSUE-076-plan-limits-and-tenant-budgets.md)

Acceptance criteria:
- Tenant budgets can cap calls and premium runtime use
- Over-budget behavior is configurable
- Admins see warnings

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Budget reached mid-call
- VIP override

### ISSUE-077: Production deployment plan

- Priority: P0
- Area: DevOps
- Milestone: Production
- Labels: devops, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-077-production-deployment-plan.md](../docs/Handovers/ISSUE-077-production-deployment-plan.md)

Acceptance criteria:
- Production environment, release process, secrets, migrations, and rollback are documented
- Deployment checklist exists
- Smoke tests are defined

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Failed migration
- Rollback with active calls

### ISSUE-078: Staging deployment plan

- Priority: P0
- Area: DevOps
- Milestone: Production
- Labels: devops, testing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-078-staging-deployment-plan.md](../docs/Handovers/ISSUE-078-staging-deployment-plan.md)

Acceptance criteria:
- Staging mirrors production-critical services
- Seed data is safe
- Staging validation is documented

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Staging uses production secrets
- Drift from prod

### ISSUE-079: Observability dashboards

- Priority: P1
- Area: DevOps
- Milestone: Production
- Labels: devops, monitoring, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-079-observability-dashboards.md](../docs/Handovers/ISSUE-079-observability-dashboards.md)

Acceptance criteria:
- Dashboards cover calls, latency, errors, cost, integrations, and telephony
- Alert thresholds are documented
- Trace IDs connect systems

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Alert noise
- Missing correlation ID

### ISSUE-080: Backup and disaster recovery

- Priority: P1
- Area: DevOps
- Milestone: Production
- Labels: devops, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-080-backup-and-disaster-recovery.md](../docs/Handovers/ISSUE-080-backup-and-disaster-recovery.md)

Acceptance criteria:
- Backups cover DB and critical object storage
- Restore procedure is tested
- RPO/RTO targets are documented

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Partial restore
- Corrupt backup

### ISSUE-081: Provider outage fallback

- Priority: P1
- Area: Runtime
- Milestone: Production
- Labels: runtime, telephony, devops, edge-case, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-081-provider-outage-fallback.md](../docs/Handovers/ISSUE-081-provider-outage-fallback.md)

Acceptance criteria:
- Fallback routes exist for telephony/runtime providers
- Outage mode is visible
- Calls fail safely when no fallback exists

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Multiple providers down
- Stuck failover

### ISSUE-082: Final production readiness checklist

- Priority: P0
- Area: Docs
- Milestone: Production
- Labels: docs, devops, security
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-082-final-production-readiness-checklist.md](../docs/Handovers/ISSUE-082-final-production-readiness-checklist.md)

Acceptance criteria:
- Checklist covers tests, docs, security, compliance, billing, observability, and rollback
- Open risks are tracked
- Release gate is explicit

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Unchecked critical item
- Stale checklist

### ISSUE-083: Frontend auth client setup

- Priority: P0
- Area: Auth
- Milestone: Foundation
- Labels: auth, frontend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-083-frontend-auth-client-setup.md](../docs/Handovers/ISSUE-083-frontend-auth-client-setup.md)

Acceptance criteria:
- Better Auth React client is configured for both Vite apps
- Login, logout, and session state work against the NestJS auth backend
- Route guards cover unauthenticated, tenant, and platform-admin users

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Trusted origin missing
- Session expires while app is open
- Fresh email sign-in must restore an active tenant organization for users with existing memberships

### ISSUE-084: Platform role and permission model

- Priority: P0
- Area: Security
- Milestone: Foundation
- Labels: platform-admin, auth, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-084-platform-role-and-permission-model.md](../docs/Handovers/ISSUE-084-platform-role-and-permission-model.md)

Acceptance criteria:
- Shared platform and tenant role types exist
- NestJS guards distinguish platform roles from tenant roles
- Tests prove tenant admins are not platform admins

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Role downgraded during session
- Conflicting tenant and platform roles

### ISSUE-085: Platform admin app scaffold

- Priority: P0
- Area: Platform Admin
- Milestone: Foundation
- Labels: platform-admin, frontend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-085-platform-admin-app-scaffold.md](../docs/Handovers/ISSUE-085-platform-admin-app-scaffold.md)

Acceptance criteria:
- `apps/platform-admin` Vite React app is created
- It has independent routing, shell, build script, and env config
- It shares only approved packages with tenant app

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Wrong API origin
- Shared component imports tenant-only code

### ISSUE-086: Platform admin auth client and access gate

- Priority: P0
- Area: Platform Admin
- Milestone: Foundation
- Labels: platform-admin, auth, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-086-platform-admin-auth-client-and-access-gate.md](../docs/Handovers/ISSUE-086-platform-admin-auth-client-and-access-gate.md)

Acceptance criteria:
- Platform admin app uses Better Auth React client
- Non-platform users are blocked from admin UI
- Server-side platform guard rejects unauthorized API calls

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Tenant admin tries admin app
- Platform role revoked mid-session

### ISSUE-087: Platform admin dashboard shell

- Priority: P1
- Area: Platform Admin
- Milestone: MVP Builder
- Labels: platform-admin, frontend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-087-platform-admin-dashboard-shell.md](../docs/Handovers/ISSUE-087-platform-admin-dashboard-shell.md)

Acceptance criteria:
- Dashboard shows system health, tenants, calls, runtime status, spend, incidents, and abuse queues
- Navigation is independent from tenant app
- UI smoke test covers dashboard load

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Empty state
- Provider status unavailable

### ISSUE-088: Platform organization management

- Priority: P1
- Area: Platform Admin
- Milestone: MVP Builder
- Labels: platform-admin, backend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-088-platform-organization-management.md](../docs/Handovers/ISSUE-088-platform-organization-management.md)

Acceptance criteria:
- Platform admins can view tenant status, plan, usage, telephony, integration state, and risk flags
- Tenant status changes are permissioned
- Status changes are audited

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Suspended tenant with active calls
- Readonly admin attempts mutation

### ISSUE-089: Platform user and membership support tools

- Priority: P1
- Area: Platform Admin
- Milestone: MVP Builder
- Labels: platform-admin, auth, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-089-platform-user-and-membership-support-tools.md](../docs/Handovers/ISSUE-089-platform-user-and-membership-support-tools.md)

Acceptance criteria:
- Platform admins can view users and memberships
- Support actions are permissioned and audited
- No raw secrets or credentials are exposed

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Deleted user
- Membership removed during support flow

### ISSUE-090: Platform telephony operations dashboard

- Priority: P1
- Area: Platform Admin
- Milestone: Telephony MVP
- Labels: platform-admin, telephony, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-090-platform-telephony-operations-dashboard.md](../docs/Handovers/ISSUE-090-platform-telephony-operations-dashboard.md)

Acceptance criteria:
- Platform admins can inspect platform-managed, BYO SIP, and BYO Twilio connections
- Health, route, and webhook failures are visible
- Raw provider credentials are never exposed

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Provider outage
- Tenant connection disabled mid-call

### ISSUE-091: Platform integration operations dashboard

- Priority: P1
- Area: Platform Admin
- Milestone: Integrations
- Labels: platform-admin, integrations, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-091-platform-integration-operations-dashboard.md](../docs/Handovers/ISSUE-091-platform-integration-operations-dashboard.md)

Acceptance criteria:
- Platform admins can inspect connector health, token status, sync failures, and revocation state
- Raw OAuth tokens are never exposed
- Retry/reconnect diagnostics are visible

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Token refresh failure
- Connector outage

### ISSUE-092: Runtime provider health dashboard

- Priority: P1
- Area: Platform Admin
- Milestone: Monitoring
- Labels: platform-admin, runtime, monitoring, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-092-runtime-provider-health-dashboard.md](../docs/Handovers/ISSUE-092-runtime-provider-health-dashboard.md)

Acceptance criteria:
- Platform admins can see STT, TTS, model, realtime, telephony, and queue health by provider and region
- Health events include timestamps and severity
- Outage state is visible

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Partial regional outage
- Stale health signal

### ISSUE-093: Platform usage and billing controls

- Priority: P1
- Area: Platform Admin
- Milestone: Production
- Labels: platform-admin, billing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-093-platform-usage-and-billing-controls.md](../docs/Handovers/ISSUE-093-platform-usage-and-billing-controls.md)

Acceptance criteria:
- Platform admins can inspect usage, budgets, overages, premium realtime usage, and plan limits across tenants
- Plan/budget changes are audited
- Readonly admins cannot mutate billing controls

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Budget reached mid-call
- Pricing table missing

### ISSUE-094: Platform admin audit log

- Priority: P0
- Area: Platform Admin
- Milestone: Production
- Labels: platform-admin, security, compliance, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-094-platform-admin-audit-log.md](../docs/Handovers/ISSUE-094-platform-admin-audit-log.md)

Acceptance criteria:
- Every platform admin action records actor, target, tenant, action, timestamp, metadata, and impersonation state
- Audit log can be filtered by actor, tenant, and action
- Audit records are not editable by normal admins

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- System actor
- Failed mutation still audited

### ISSUE-095: Platform impersonation workflow

- Priority: P0
- Area: Platform Admin
- Milestone: Production
- Labels: platform-admin, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-095-platform-impersonation-workflow.md](../docs/Handovers/ISSUE-095-platform-impersonation-workflow.md)

Acceptance criteria:
- Impersonation is time-boxed, permissioned, visibly marked, auditable, and revocable
- Destructive actions are blocked unless explicitly allowed
- Tenant and platform audit records link to the impersonation session

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Session expires during impersonation
- Role revoked while impersonating

### ISSUE-096: Abuse and compliance review queue

- Priority: P1
- Area: Platform Admin
- Milestone: Production
- Labels: platform-admin, compliance, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-096-abuse-and-compliance-review-queue.md](../docs/Handovers/ISSUE-096-abuse-and-compliance-review-queue.md)

Acceptance criteria:
- Platform admins can review outbound abuse signals, DNC violations, consent issues, prompt-injection flags, and suspension recommendations
- Review decisions are audited
- Queue supports safe escalation and dismissal

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- False positive
- Compromised tenant account

### ISSUE-097: Platform admin deployment and domain config

- Priority: P1
- Area: DevOps
- Milestone: Production
- Labels: platform-admin, devops, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-097-platform-admin-deployment-and-domain-config.md](../docs/Handovers/ISSUE-097-platform-admin-deployment-and-domain-config.md)

Acceptance criteria:
- `apps/platform-admin` has separate deploy config and environment variables
- Trusted origins include local, staging, and production admin domains
- Security headers and CSP can differ from tenant app

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Wrong domain points to tenant app
- Missing staging origin

### ISSUE-098: Shared frontend packages setup

- Priority: P1
- Area: Frontend
- Milestone: Foundation
- Labels: frontend, platform-admin, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-098-shared-frontend-packages-setup.md](../docs/Handovers/ISSUE-098-shared-frontend-packages-setup.md)

Acceptance criteria:
- `packages/ui`, `packages/api-client`, and `packages/auth-client` are planned or scaffolded for shared frontend code
- Shared packages do not depend on tenant-only or admin-only app code
- Typecheck covers shared package boundaries

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Circular workspace dependency
- Admin-only component leaks into tenant app

### ISSUE-099: Workspace domain model

- Priority: P0
- Area: Backend
- Milestone: Foundation
- Labels: backend, auth, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-099-workspace-domain-model.md](../docs/Handovers/ISSUE-099-workspace-domain-model.md)

Acceptance criteria:
- Workspace entities belong to one tenant organization
- Workspace membership and role records support owner, admin, builder, operator, and viewer access
- Workspace slugs are unique per tenant and safe for URLs

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Duplicate workspace slug inside one tenant
- User belongs to organization but not the selected workspace

### ISSUE-100: Workspace switcher and creation flow

- Priority: P1
- Area: Frontend
- Milestone: MVP Builder
- Labels: frontend, auth, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-100-workspace-switcher-and-creation-flow.md](../docs/Handovers/ISSUE-100-workspace-switcher-and-creation-flow.md)

Acceptance criteria:
- Tenant app header/sidebar exposes a workspace switcher
- Authorized users can create a workspace with name, slug, and default role policy
- Current workspace selection persists across reloads and is reflected in route/API context

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Last accessible workspace is deleted
- User switches workspace while editing a draft workflow

### ISSUE-101: Workspace scoped workflows and sandbox runs

- Priority: P0
- Area: Backend
- Milestone: Sandbox
- Labels: backend, frontend, runtime, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-101-workspace-scoped-workflows-and-sandbox-runs.md](../docs/Handovers/ISSUE-101-workspace-scoped-workflows-and-sandbox-runs.md)

Acceptance criteria:
- Workflow drafts, published versions, and sandbox sessions are scoped to a workspace
- Publish dialog stores the selected workspace with the workflow version
- Sandbox only loads workflows from workspaces the user can access

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Published workflow is moved or archived before sandbox starts
- Workspace access is revoked after the sandbox route is opened

### ISSUE-102: Workspace settings and access management

- Priority: P1
- Area: Frontend
- Milestone: Production
- Labels: frontend, auth, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-102-workspace-settings-and-access-management.md](../docs/Handovers/ISSUE-102-workspace-settings-and-access-management.md)

Acceptance criteria:
- Workspace admins can rename, archive, and restore workspaces
- Workspace admins can grant and revoke member roles
- Audit logs capture workspace access and settings changes

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Removing the final workspace owner
- Archived workspace still has active calls or sandbox sessions

### ISSUE-107: Telephony persistence store

- Priority: P0
- Area: Backend
- Milestone: Telephony MVP
- Labels: backend, telephony, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-107-telephony-persistence-store.md](../docs/Handovers/ISSUE-107-telephony-persistence-store.md)

Acceptance criteria:
- Telephony connections, imported numbers, saved routes, dispatch history, and webhook dedupe state survive API restarts
- Persisted telephony state remains tenant scoped and reload-safe
- The persistence layer tolerates first boot, missing state, and partial-write recovery paths without leaking raw secrets
- Coolify deploys run schema migrations before API boot so normalized phone-number route columns such as `live_route` exist before number import writes.

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Missing telephony rows on first boot
- Duplicate webhook arrives after restart
- Transaction is interrupted during a telephony state save

### ISSUE-109: Live sandbox session transport

- Priority: P0
- Area: Backend
- Milestone: Sandbox
- Labels: backend, runtime, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-109-live-sandbox-session-transport.md](../docs/Handovers/ISSUE-109-live-sandbox-session-transport.md)

Acceptance criteria:
- NestJS creates authenticated workspace-scoped live sandbox sessions for draft and published manifests
- Browser clients connect through a Zara-owned realtime transport instead of direct provider keys
- Session stream emits call lifecycle, transcript, audio, node transition, and tool events

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Workspace access is revoked after session start
- Browser reconnects during an active sandbox run
- Browser closes while provider streams are still open

### ISSUE-110: AssemblyAI streaming STT adapter

- Priority: P0
- Area: Runtime
- Milestone: Sandbox
- Labels: runtime, backend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-110-assemblyai-streaming-stt-adapter.md](../docs/Handovers/ISSUE-110-assemblyai-streaming-stt-adapter.md)

Acceptance criteria:
- Adapter streams browser audio to AssemblyAI and returns partial plus final transcript events
- Runtime maps provider failures into structured STT runtime errors
- Provider auth stays server side and workspace-scoped through the live sandbox session

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- WebSocket reconnect occurs mid-utterance
- No-speech or silence timeout fires
- Unsupported audio format or sample rate is received

### ISSUE-111: Cartesia Sonic 3 streaming TTS adapter

- Priority: P0
- Area: Runtime
- Milestone: Sandbox
- Labels: runtime, backend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-111-cartesia-sonic-3-streaming-tts-adapter.md](../docs/Handovers/ISSUE-111-cartesia-sonic-3-streaming-tts-adapter.md)

Acceptance criteria:
- Adapter streams agent text to Cartesia Sonic 3 and returns playable audio chunks with first-byte latency metrics
- Runtime profiles can select voice and output settings without exposing provider credentials to the client
- Provider failures degrade with structured TTS runtime errors

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- First-byte latency breaches the runtime threshold
- Output stream is canceled during interruption or barge-in
- Requested voice or model is unavailable

### ISSUE-112: Draft manifest live execution on workflows

- Priority: P0
- Area: Frontend
- Milestone: Sandbox
- Labels: frontend, runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-112-draft-manifest-live-execution-on-workflows.md](../docs/Handovers/ISSUE-112-draft-manifest-live-execution-on-workflows.md)

Acceptance criteria:
- `/workflows` can compile the current validated draft into an ephemeral manifest without publishing
- Voice mode requests microphone access and starts a live sandbox run in the builder drawer
- Runtime events, transcript, and node-by-node progress reflect the real live execution path

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Graph changes while a draft sandbox run is active
- Draft becomes invalid before transport bootstrap completes
- Microphone permission is denied

### ISSUE-113: Published manifest live execution on sandbox

- Priority: P0
- Area: Frontend
- Milestone: Sandbox
- Labels: frontend, runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-113-published-manifest-live-execution-on-sandbox.md](../docs/Handovers/ISSUE-113-published-manifest-live-execution-on-sandbox.md)

Acceptance criteria:
- `/sandbox` starts the same live audio pipeline for published workflow versions
- Workspace-safe published workflow selection gates session start
- Cost-optimized, balanced, and premium runtime profiles all start through the live session transport

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Published version is archived after selection but before session start
- Active workspace changes during session bootstrap
- Browser refresh occurs during a live sandbox run

### ISSUE-114: Live sandbox tool execution and event telemetry

- Priority: P0
- Area: Runtime
- Milestone: Sandbox
- Labels: runtime, integrations, testing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-114-live-sandbox-tool-execution-and-event-telemetry.md](../docs/Handovers/ISSUE-114-live-sandbox-tool-execution-and-event-telemetry.md)

Acceptance criteria:
- Tool nodes execute through the live runtime tool registry during sandbox sessions
- Transcript and event timeline reflect tool calls, handoffs, condition branches, exit nodes, and failures
- Telemetry includes provider latency, tool duration, node transition, and cost deltas per turn

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Tool authorization is revoked mid-session
- Tool timeout triggers fallback routing
- Multiple tool-capable branches compete in the same turn

### ISSUE-115: Sandbox provider auth and browser token strategy

- Priority: P0
- Area: Security
- Milestone: Sandbox
- Labels: security, backend, runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-115-sandbox-provider-auth-and-browser-token-strategy.md](../docs/Handovers/ISSUE-115-sandbox-provider-auth-and-browser-token-strategy.md)

Acceptance criteria:
- Browser sandbox sessions use short-lived transport tokens and never receive long-lived provider secrets
- Session tokens are scoped to tenant, workspace, manifest source, and expiry
- Replay, expiry, and cross-workspace misuse are rejected and audited

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Transport token expires during bootstrap
- WebSocket token is replayed from another tab or browser
- Session is started with a valid token but mismatched workspace context

### ISSUE-116: Reusable specialist role library

- Priority: P2
- Area: Frontend
- Milestone: MVP Builder
- Labels: frontend, runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-116-reusable-specialist-role-library.md](../docs/Handovers/ISSUE-116-reusable-specialist-role-library.md)

Acceptance criteria:
- Tenant builders can save an agent role as a reusable specialist template
- Reusable specialists can be selected when configuring agent and handoff nodes
- Updating a reusable specialist does not silently mutate already-published workflow versions

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Duplicate specialist names inside a workspace
- Specialist template deleted while a draft references it
- Published workflow references an older specialist snapshot

### ISSUE-117: Multi-language role controls

- Priority: P2
- Area: Frontend
- Milestone: MVP Builder
- Labels: frontend, runtime, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-117-multi-language-role-controls.md](../docs/Handovers/ISSUE-117-multi-language-role-controls.md)

Acceptance criteria:
- Role nodes can configure multiple supported languages with a default fallback
- Builder validation blocks unsupported or duplicate language entries
- Runtime-facing role config preserves language policy for routing and prompt selection

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Caller language is unknown
- Default language is removed from the supported-language list
- Language-specific prompt text is missing

### ISSUE-118: Tenant integrations page

- Priority: P1
- Area: Frontend
- Milestone: Integrations
- Labels: frontend, integrations, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-118-tenant-integrations-page.md](../docs/Handovers/ISSUE-118-tenant-integrations-page.md)

Acceptance criteria:
- `/integrations` renders a tenant-facing integrations page instead of the dashboard placeholder
- Tenant admins can view connector connection status, health, revocation state, and available tool grants
- Connect, reconnect, revoke, and retry affordances never expose raw OAuth tokens or provider secrets
- Provider connection and catalog rows show accessible provider logo badges for existing connectors.

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- OAuth callback returns after the page has refreshed
- Connector is revoked while a workflow still references a tool
- Non-admin tenant user opens the page

Implementation notes:
- 2026-06-04 follow-up added a Zendesk credential form for subdomain, email, and API token. The tenant UI does not expose an API URL field for built-in Zendesk tools.
- API tokens are submitted through the server-owned integrations route and cleared from the form after save; public connection rows show only account label and masked credential preview.
- The server-side save path behind the Zendesk credential form treats blank integration state directory env values as unset.

### ISSUE-119: Tenant memory page

- Priority: P1
- Area: Frontend
- Milestone: Monitoring
- Labels: frontend, memory, security, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-119-tenant-memory-page.md](../docs/Handovers/ISSUE-119-tenant-memory-page.md)

Acceptance criteria:
- `/memory` renders a tenant-facing memory page instead of the dashboard placeholder
- Users can inspect approved memory, pending drafts, knowledge records, ingestion status, and audit posture
- Edit, disable, delete, approve, reject, export, and retention actions use the tenant-scoped memory APIs safely

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Memory record is deleted while the inspector is open
- Legal hold blocks destructive actions
- Export is requested while ingestion jobs are still pending

### ISSUE-120: Tenant billing page

- Priority: P1
- Area: Frontend
- Milestone: Production
- Labels: frontend, billing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-120-tenant-billing-page.md](../docs/Handovers/ISSUE-120-tenant-billing-page.md)

Acceptance criteria:
- `/billing` renders a tenant-facing billing page instead of the dashboard placeholder
- Tenant admins can view plan status, usage totals, budget warnings, invoices or orders, and premium runtime usage
- Billing actions route through safe backend APIs or the payment customer portal instead of exposing payment-provider secrets

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Pricing table is unavailable
- User has billing viewer access but not billing admin access
- Tenant is over budget while an active call is running

### ISSUE-121: Polar payments and subscriptions

- Priority: P0
- Area: Billing
- Milestone: Production
- Labels: billing, auth, backend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-121-polar-payments-and-subscriptions.md](../docs/Handovers/ISSUE-121-polar-payments-and-subscriptions.md)

Acceptance criteria:
- Better Auth is integrated with Polar for organization-linked checkout, subscriptions, customer portal, and customer state
- Polar webhooks update tenant plan, subscription, entitlement, invoice/order, and cancellation state idempotently
- Usage-based billing events from Zara usage meters can be sent to Polar without leaking tenant secrets or duplicating usage

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- Checkout completes after the user changes organization context
- Webhook is replayed or arrives before local checkout state is visible
- Subscription is canceled or payment fails during an active billing period

### ISSUE-122: Canonical workflow node relationship policy

- Priority: P0
- Area: Runtime
- Milestone: MVP Builder
- Labels: runtime, frontend, testing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-122-canonical-workflow-node-relationship-policy.md](../docs/Handovers/ISSUE-122-canonical-workflow-node-relationship-policy.md)

Acceptance criteria:
- A shared relationship policy enumerates allowed source node kind, target node kind, edge kind, handle role, and auto-created companion edges for entry, agent, tool, intent route, handoff, escalation, and exit nodes
- Builder connect, reconnect, add-node actions, and condition target selectors consume the same policy instead of maintaining separate ad hoc rules
- Shared validation returns stable errors for invalid node relationships, including entry-to-intent, tool-to-intent, intent-through-tool-handles, tool result to non-caller, and intent routes targeting invalid node kinds

TDD notes:
- Write failing shared policy tests before adding the policy module.
- Verify UI tests fail against the current ad hoc builder behavior before wiring the builder to the policy.
- Keep browser QA focused on one or two critical builder flows after unit coverage proves the policy matrix.

Edge cases:
- Existing drafts with now-invalid relationships
- Return edges for delegated agents versus ordinary flow edges
- Reconnecting an existing edge should update node config only when the policy allows the new relationship

### ISSUE-123: Relationship-aware builder affordances and repair UX

- Priority: P1
- Area: Frontend
- Milestone: MVP Builder
- Labels: frontend, runtime, testing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-123-relationship-aware-builder-affordances-and-repair-ux.md](../docs/Handovers/ISSUE-123-relationship-aware-builder-affordances-and-repair-ux.md)

Acceptance criteria:
- Builder toolbar actions, React Flow handles, connection attempts, reconnect attempts, and inspector target dropdowns expose only relationships allowed by the canonical policy
- Invalid edge attempts show relationship-specific guidance and do not mutate graph state
- Browser QA covers adding agents, tools, intent routes, handoffs, exits, and rejected invalid connections without console errors

TDD notes:
- Start from failing builder tests for disabled/enabled controls and rejected invalid connections.
- Add light browser validation after component tests cover the policy-driven behavior.
- Do not add broad visual tests; focus on critical edge creation and repair flows.

Edge cases:
- Empty canvas with only entry
- Selected tool, condition, handoff, escalation, or exit node when toolbar actions are clicked
- Route target dropdowns after deleting or reconnecting the caller node

### ISSUE-124: Live sandbox session spine deepening

- Priority: P1
- Area: Runtime
- Milestone: Sandbox
- Labels: runtime, backend, architecture, testing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-124-live-sandbox-session-spine-deepening.md](../docs/Handovers/ISSUE-124-live-sandbox-session-spine-deepening.md)

Acceptance criteria:
- Live sandbox turn routing is owned by a focused module with a small public interface
- The existing live sandbox session HTTP and websocket contracts remain unchanged
- Focused tests cover condition, handoff, tool, and terminal routing without requiring a full websocket session

TDD notes:
- Write a failing route-spine test before extracting the module.
- Keep existing controller and websocket tests green after the refactor.
- Preserve tenant isolation, token security, redaction, and event ordering contracts.

Edge cases:
- Empty or stale frontier falls back to the manifest entry node
- Tool nodes on the route are collected before the responding role is selected
- Terminal escalation and exit nodes stop the turn without invoking the model

### ISSUE-125: Workflow builder workbench deepening

- Priority: P1
- Area: Frontend
- Milestone: MVP Builder
- Labels: frontend, architecture, testing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-125-workflow-builder-workbench-deepening.md](../docs/Handovers/ISSUE-125-workflow-builder-workbench-deepening.md)

Acceptance criteria:
- Workflow builder selected-node action state is owned by a focused workbench module with a small public interface
- React Flow handle-role mapping and relationship decisions are kept out of the screen component while preserving existing builder behavior
- Focused tests cover action availability, route-target eligibility, and canonical handle mapping without rendering the full builder screen

TDD notes:
- Write a failing workbench module test before extracting policy adapter code from the screen.
- Keep the existing WorkflowBuilder screen tests green after the refactor.
- Preserve ISSUE-123 normal-flow handle behavior and relationship repair affordances.

Edge cases:
- Empty canvas or stale selected node falls back to a usable selected node
- Selected tool, entry, condition, handoff, escalation, and exit nodes expose only policy-valid actions
- Normal flow handles stay separate from tool call/result handles

### ISSUE-126: Tenant JSON state adapter deepening

- Priority: P1
- Area: Backend
- Milestone: Production
- Labels: backend, architecture, persistence, testing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-126-tenant-json-state-adapter-deepening.md](../docs/Handovers/ISSUE-126-tenant-json-state-adapter-deepening.md)

Acceptance criteria:
- Tenant-scoped JSON file persistence uses a shared adapter for path resolution, list, load, save, atomic replacement, and corrupt snapshot quarantine
- Billing, integrations, memory, and telephony state repositories preserve their public repository interfaces and domain-specific validation
- Focused tests cover the shared adapter without booting feature services, and existing persistence tests remain green

TDD notes:
- Write a failing shared adapter test before adding the adapter module.
- Keep domain repository tests green after rewiring feature repositories.
- Preserve telephony, integrations, and memory corrupt-file quarantine behavior.

Edge cases:
- Missing tenant snapshot returns `null`
- Invalid JSON or invalid tenant structure is moved aside as a corrupt snapshot where the feature expects quarantine
- Temporary files and quarantined snapshots are not returned by tenant listing
- Blank integration state directory environment values are handled by integrations module wiring before the shared adapter is constructed

### ISSUE-127: Agent text model provider selection

- Priority: P1
- Area: Runtime
- Milestone: Sandbox
- Labels: runtime, frontend, backend, testing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-127-agent-text-model-provider-selection.md](../docs/Handovers/ISSUE-127-agent-text-model-provider-selection.md)

Acceptance criteria:
- Agent role nodes preserve text model provider and optional exact model ID in draft, published, and compiled runtime role snapshots
- The live sandbox text model provider routes OpenAI by default and Google Gemini when the active agent role selects Gemini
- Workflow builder agent inspectors expose provider and model controls, with Gemini model presets and exact model IDs configurable by operators
- Runtime routing events and sandbox summaries identify the provider and exact model ID when one is configured

TDD notes:
- Start with failing shared workflow publishing coverage before changing role types.
- Add focused provider, provider-router, env, runtime-event, and builder-inspector tests before implementation.
- Keep existing live sandbox and builder tests green after adding provider routing.

Edge cases:
- Roles without a provider selection must remain OpenAI-compatible.
- Empty model IDs must fall back to tier defaults.
- Missing Gemini credentials should fail only when a Gemini-selected role attempts a text turn.

### ISSUE-128: Workflow sandbox loading, publishing, and audit controls

- Priority: P1
- Area: Frontend
- Milestone: Sandbox
- Labels: frontend, runtime, testing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-128-workflow-sandbox-loading-publishing-and-audit-controls.md](../docs/Handovers/ISSUE-128-workflow-sandbox-loading-publishing-and-audit-controls.md)

Acceptance criteria:
- The workflow builder can load existing workspace workflows from the published workflow registry without showing version suffixes in user-facing labels
- Publishing lets users edit the workflow name before release, never appends visible version suffixes, validates that a workflow name exists before publish or sandbox run, asks for confirmation before overwriting an existing workflow with the same name, and exposes an explicit create-new versus overwrite-existing release mode
- Agent node model selection uses provider-approved model dropdowns, including the configured Gemini Flash Lite, Flash, and Pro Preview model IDs
- Ending a live sandbox call preserves transcript and event replay until the user explicitly resets sandbox state
- The workflow sandbox drawer exposes separate End call and Reset sandbox controls, and active sandbox calls animate the workflow traversal path

TDD notes:
- Start with failing hook coverage proving end-call preserves replay state while reset clears it.
- Add builder tests for loading published workflows, publish-name validation, closed model selections, reset drawer controls, and active traversal decoration.
- Keep focused App-level smoke coverage for workflow publishing, routed sandbox, sandbox workflow labels, and telephony paths green.

Edge cases:
- Loaded published workflows can contain stale node configs, so the builder loader falls back to generic nodes if typed configs are missing.
- Empty workflow names block publish and draft sandbox entry through shared validation state.
- Browser CORS can block local QA if the dev app falls back to a port not listed in the running API's trusted origins.

### ISSUE-129: Live sandbox latency, identity prompts, and Gemini Live server transport

- Priority: P1
- Area: Runtime
- Milestone: Sandbox
- Labels: runtime, frontend, backend, testing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-129-live-sandbox-latency-identity-prompts-and-gemini-live-server-transport.md](../docs/Handovers/ISSUE-129-live-sandbox-latency-identity-prompts-and-gemini-live-server-transport.md)

Acceptance criteria:
- Live sandbox latency metrics show caller-turn-to-first-audio latency instead of provider-only TTS first-byte telemetry
- Model output streams into streaming-capable TTS, Cartesia audio chunks fan out to the browser as they arrive, Cartesia WebSockets stay warm for voice sessions, and browser microphone capture uses AudioWorklet or smaller fallback chunks
- Sandbox intent controls are sent through typed and voice transport messages and route condition nodes explicitly when selected
- Agent prompts use configured agent identity, business name, role type, platform guardrails, and role templates without hardcoding Zara or default specialist names
- Newly added agent nodes start with required identity/instruction fields empty and highlighted until configured
- A server-owned Gemini Live adapter builds setup, text, audio, and parser contracts for the server-to-server realtime pattern
- Premium realtime agent roles can choose OpenAI Realtime or Google Gemini Live while browser/runtime clients still receive only Zara-owned transport URLs
- Platform-admin staff can edit persisted runtime prompt guardrails and role templates through guarded prompt-policy APIs

TDD notes:
- Start from failing latency and intent transport tests before changing API or web session state
- Add core runtime tests for streaming model chunks into TTS and streaming audio callbacks before changing runtime behavior
- Add provider tests for Cartesia continuation streaming, warm socket reuse, microphone AudioWorklet fallback, prompt identity, and Gemini Live adapter contracts

Edge cases:
- Existing provider first-byte telemetry remains available separately for diagnostics
- Voice streaming STT keeps the latest selected intent and phase across automatic endpoint turns
- Cartesia aborts still surface structured interrupted failures while warm sockets are reused for normal generations
- Gemini Live credentials remain server-side; direct browser connections require a future ephemeral-token preview path

### ISSUE-130: Voice agent agency landing and dedicated auth page

- Priority: P1
- Area: Frontend
- Milestone: Marketing
- Labels: frontend, ui, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-130-voice-agent-agency-landing-and-auth.md](../docs/Handovers/ISSUE-130-voice-agent-agency-landing-and-auth.md)

Acceptance criteria:
- Signed-out visitors on `/` see the voice-agent agency landing page instead of the tenant auth form
- Landing page includes agency-positioned SEO copy, service sections, workflow-builder proof, results, pricing, final CTA, and footer
- `/login` and `/signup` render dedicated auth pages for tenant access
- Authenticated users who visit `/login` or `/signup` are returned to the tenant app

TDD notes:
- Start with a failing signed-out landing route test and a dedicated `/login` auth page test before changing the router or UI.
- Keep UI tests light and verify the production build plus browser smoke after the green pass.

Edge cases:
- Protected tenant routes still render sign-in when no session exists.
- Mobile landing layout must avoid horizontal overflow and keep CTA text inside controls.
- SEO metadata is set client-side for the Vite app shell.

### ISSUE-131: Tenant auth organization reactivation

- Priority: P0
- Area: Auth
- Milestone: Foundation
- Labels: auth, frontend, testing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-131-tenant-auth-organization-reactivation.md](../docs/Handovers/ISSUE-131-tenant-auth-organization-reactivation.md)

Acceptance criteria:
- Returning self-serve tenant owners regain an active tenant organization after email sign-in
- Better Auth organization creation mirrors the organization into `tenants` with the same id for product-table foreign keys
- Tenant signup rejects blank or whitespace-only organization names before creating a user account
- Focused auth-client tests cover organization reactivation and tenant-name validation

TDD notes:
- Start with a failing shared auth-client test proving email sign-in does not restore an active organization.
- Add a failing signup validation test before changing production client behavior.
- Keep tenant auth route smoke and API self-serve organization coverage green.

Edge cases:
- Better Auth persists memberships but starts fresh sign-in sessions without an active organization.
- Better Auth can briefly expose stale signed-in session data while organization activation refetches; the tenant app must stay loading rather than showing a false tenant access error.
- Existing organizations created before the tenant mirror require a one-time `organization` to `tenants` backfill.
- Better Auth callback redirects can abort organization restoration, so tenant auth forms must let the shared client finish and then navigate locally.
- Multi-tenant accounts currently restore the first available organization; a future picker can make this explicit.

### ISSUE-132: Runtime-aware workflow builder inspector controls

- Priority: P1
- Area: Frontend
- Milestone: Workflow Builder
- Labels: frontend, runtime, ui, testing, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-132-runtime-aware-workflow-builder-inspector-controls.md](../docs/Handovers/ISSUE-132-runtime-aware-workflow-builder-inspector-controls.md)

Acceptance criteria:
- Agent inspectors show text model tier/provider/model controls only for cost-optimized or balanced runtime profiles
- Agent inspectors show realtime provider/model controls only for premium realtime runtime profiles
- The workflow toolbar removes the inline workflow name input beside the workflow dropdown while preserving publish-time naming
- Supported languages use a dropdown-style multi-select instead of a native side-by-side listbox
- Empty workspaces open a blank workflow canvas, while workspaces with published workflows open the most recently published workflow
- Intent-route fallback target selectors include the calling agent as an explicit fallback option without adding it to normal branch target options, and fallback-to-caller condition edges validate as intentional loops

TDD notes:
- Start with failing builder tests for runtime-specific inspector visibility, blank/latest startup, toolbar naming, language multi-select, and fallback target options.
- Keep focused workflow builder coverage and full TypeScript checks green before ending the pass.

Edge cases:
- Reusable specialist templates remain available even though the builder no longer depends on the old seeded sample canvas.
- Selecting the draft workflow option resets the canvas to a blank entry point.
- The publish dialog remains the place where operators name or rename workflows before release.
- Tool inspectors list provider tools by provider and bind credential connections from tenant integrations instead of hardcoded connection fixtures.

### ISSUE-133: Turn runtime packet v1

- Priority: P0
- Area: Runtime
- Milestone: Sandbox
- Labels: runtime, backend, architecture, testing, tdd-required
- Status: Implemented
- Blocked by: None - can start immediately
- Handover: [docs/Handovers/ISSUE-133-turn-runtime-packet-v1.md](../docs/Handovers/ISSUE-133-turn-runtime-packet-v1.md)
- External: [Linear ZAR-66](https://linear.app/zara-voice/issue/ZAR-66/issue-133-turn-runtime-packet-v1)

Acceptance criteria:
- Shared core exposes a turn-scoped runtime packet contract with IDs, sequence, caller input, graph state, available tools, tool calls, intent, transfer, safety, diagnostics, and model-facing agent projection
- Live sandbox turn routing creates and updates the packet before model invocation while preserving the existing public live-session API contract
- Packet-backed runtime events include turn ID and monotonic sequence for node visits, agent selection, intent, tools, transfer, model routing, and warnings
- `docs/Architecture.md`, `docs/Runtime-Manifests.md`, and `docs/Testing-Strategy.md` remain aligned with the packet contract

TDD notes:
- Start with failing core tests for packet creation, reducer updates, projection size limits, and redaction-safe model context.
- Add failing live-router tests proving condition, tool, handoff, terminal, and stale-frontier paths write packet facts before changing production code.
- Keep live-session controller/websocket contract tests green after packet-backed events are introduced.

Edge cases:
- Active calls remain pinned to manifest ID and version.
- Packet events must remain ordered when provider callbacks arrive out of order.
- Tenant/workspace/call-session mismatches must be rejected before packet facts are read or written.

### ISSUE-134: Model-backed intent route classifier

- Priority: P0
- Area: Runtime
- Milestone: Sandbox
- Labels: runtime, backend, frontend, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-133
- Handover: [docs/Handovers/ISSUE-134-model-backed-intent-route-classifier.md](../docs/Handovers/ISSUE-134-model-backed-intent-route-classifier.md)
- External: [Linear ZAR-67](https://linear.app/zara-voice/issue/ZAR-67/issue-134-model-backed-intent-route-classifier)

Acceptance criteria:
- Intent route config stores branch intent keys, descriptions, examples, fallback, classifier threshold, and input-window options without exposing raw expressions to operators
- Runtime calls the `intent-classifier-fast` Gemini alias for intent routes, validates structured JSON output, and falls back safely when output is invalid or low confidence
- Intent classification writes `IntentRouteResult` into the turn runtime packet and routes only to configured branch or fallback targets
- Builder, runtime manifest, prompt, event, and architecture docs reflect the standardized intent routing contract

TDD notes:
- Start with failing classifier output-validation tests for unknown branch IDs, malformed JSON, missing confidence, low confidence, and fallback.
- Add live-router tests proving explicit branch match, fallback, latest-turn preference, multilingual text, and no invented targets.
- Add builder tests for branch descriptions/examples and fallback target behavior before changing inspector production code.

Edge cases:
- Multiple configured branches can overlap; choose the most specific branch or fallback when confidence is low.
- Caller asks to stop, cancel, or speak to a human; prefer a matching exit/escalation branch if configured.
- Provider model ID is environment-mapped so the stable alias can move between approved Gemini Flash Lite models.

### ISSUE-135: Discretionary agent toolbelt and structured tool results

- Priority: P0
- Area: Runtime
- Milestone: Integrations
- Labels: runtime, integrations, frontend, backend, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-133
- Handover: [docs/Handovers/ISSUE-135-discretionary-agent-toolbelt-and-structured-tool-results.md](../docs/Handovers/ISSUE-135-discretionary-agent-toolbelt-and-structured-tool-results.md)
- External: [Linear ZAR-68](https://linear.app/zara-voice/issue/ZAR-68/issue-135-discretionary-agent-toolbelt-and-structured-tool-results)

Acceptance criteria:
- Workflow manifests compile tool nodes or tool assignments as agent toolbelt capabilities rather than mandatory frontier steps
- Active agents receive available tool descriptions, usage guidance, input schemas, required inputs, risk, and approval posture in the model-facing packet projection
- Agent model output can request a tool call or a spoken response; runtime validates tool assignment, arguments, grants, approval, credentials, and idempotency before execution
- Tool execution results preserve structured status, summary, safe output, duration, idempotency key, and recoverable errors in the turn packet
- Builder and architecture docs describe tools as optional agent capabilities while preserving publish validation for credentials and high-risk approvals

TDD notes:
- Start with failing manifest/compiler tests proving assigned tools are available to the agent without automatic execution.
- Add prompt/provider tests for tool-call action output, missing required inputs, unknown tool IDs, and response-only turns.
- Add live-session tests for zero tool calls, one tool call, multiple bounded tool calls, approval-required tools, failures, and redacted safe output.

Edge cases:
- A tool may be assigned but unused for an entire call.
- Missing inputs should make the agent ask the caller instead of executing.
- Side-effect tools need deterministic idempotency keys and max tool-call limits per turn.

### ISSUE-136: Structured transfer context for routed agents

- Priority: P0
- Area: Runtime
- Milestone: Monitoring
- Labels: runtime, backend, frontend, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-133
- Handover: [docs/Handovers/ISSUE-136-structured-transfer-context-for-routed-agents.md](../docs/Handovers/ISSUE-136-structured-transfer-context-for-routed-agents.md)
- External: [Linear ZAR-69](https://linear.app/zara-voice/issue/ZAR-69/issue-136-structured-transfer-context-for-routed-agents)

Acceptance criteria:
- Handoff nodes and direct agent-to-agent routes create `AgentTransferContext` with source agent, target agent, reason, caller need summary, matched intent, and recent safe tool results
- Routed-to agents receive transfer context in their model-facing prompt and can respond with awareness of why the call was routed
- Runtime emits transfer requested/completed events from packet facts with source and target IDs, turn ID, and sequence
- Builder, runtime manifest, and monitoring docs describe transfer context as the standard for routed calls

TDD notes:
- Start with failing transfer-context tests for handoff routes, direct agent-to-agent routes, intent-to-handoff routes, and missing target defense.
- Add prompt tests proving the receiving agent sees source, reason, caller summary, matched intent, and safe tool result summaries.
- Add websocket/monitor tests proving transfer events remain replayable and ordered.

Edge cases:
- Transfer loops are limited by depth and visited-agent policy.
- Caller refusal can cancel or override a planned transfer.
- Target-agent instructions and platform guardrails override source transfer context.

### ISSUE-137: Runtime orchestration edge-case policy hardening

- Priority: P1
- Area: Runtime
- Milestone: Production
- Labels: runtime, security, backend, frontend, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-133, ISSUE-134, ISSUE-135, ISSUE-136
- Handover: [docs/Handovers/ISSUE-137-runtime-orchestration-edge-case-policy-hardening.md](../docs/Handovers/ISSUE-137-runtime-orchestration-edge-case-policy-hardening.md)
- External: [Linear ZAR-71](https://linear.app/zara-voice/issue/ZAR-71/issue-137-runtime-orchestration-edge-case-policy-hardening)

Acceptance criteria:
- Runtime policy guards cover ambiguity, multiple intents, invalid classifier output, missing tool inputs, approval gates, tool timeout/rate-limit, partial tool success, transfer loops, language mismatch, interruption, and context bloat
- Packet-backed warnings and replay events are redacted, ordered, tenant-scoped, and visible in sandbox monitoring
- Security tests cover untrusted tool output, prompt injection attempts, tenant/workspace packet isolation, and invalid model-command targets
- `docs/Runtime-Orchestration-Edge-Cases-And-Policies.md`, `docs/Security-Compliance.md`, `docs/Runtime-Manifests.md`, and `docs/Testing-Strategy.md` are updated with the implemented policy behavior

TDD notes:
- Start with failing policy-table tests for each documented edge case before adding runtime guard code.
- Add integration tests for websocket replay ordering, redaction, tenant isolation, and approval/timeout tool paths.
- Keep builder smoke tests light; focus deep coverage on core runtime, live-session service, and security boundaries.

Edge cases:
- Caller interruption during non-side-effect work should cancel safely.
- Runtime restart should reconstruct compact packet facts from persisted event history.
- Provider outage fallback must not bypass policy guards.

Implemented notes:
- Runtime policy guard coverage now includes intent ambiguity/fallback and invalid output, missing tool input, approval gates, timeout/rate-limit failures, partial tool success, direct transfer loops, transfer language mismatch, interrupted model streams, context bloat compaction, untrusted prompt lanes, tenant/workspace replay isolation, redaction, and invalid model-command targets.
- Remaining restart reconstruction, caller refusal override, and provider outage fallback can be expanded in future runtime hardening issues without changing the packet contract.

### ISSUE-138: Packet-backed OpenTelemetry and LangSmith trace export

- Priority: P0
- Area: Runtime
- Milestone: Monitoring
- Labels: runtime, observability, backend, security, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-133
- Handover: [docs/Handovers/ISSUE-138-packet-backed-opentelemetry-and-langsmith-trace-export.md](../docs/Handovers/ISSUE-138-packet-backed-opentelemetry-and-langsmith-trace-export.md)
- External: [Linear ZAR-70](https://linear.app/zara-voice/issue/ZAR-70/issue-138-packet-backed-opentelemetry-and-langsmith-trace-export)

Acceptance criteria:
- Runtime installs and configures the approved observability libraries: `langsmith`, `@opentelemetry/api`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/exporter-trace-otlp-http`, and `@opentelemetry/resources`
- Live sandbox/runtime turns emit OpenTelemetry spans for call session, turn runtime, packet creation/finalization, node visits, intent classification, tool selection/execution, transfer creation, model calls, and TTS synthesis
- LangSmith export receives only the redacted AI trace projection with trace ID, call/session/turn/packet IDs, manifest/version IDs, provider/model metadata, intent/tool/transfer facts, policy warnings, and release metadata
- Exporter failure is isolated from live calls and produces internal metrics plus warning events instead of failing runtime turns
- `docs/Architecture.md`, `docs/Runtime-Manifests.md`, `docs/Observability-Dashboards.md`, `docs/Security-Compliance.md`, and `docs/Observability-And-Evals-Standard.md` remain aligned with the implemented trace contract

TDD notes:
- Start with failing tests for trace span construction from packet facts and redacted export payload shape.
- Add failing tests proving raw transcript, raw tool output, secrets, and audio payloads are omitted from LangSmith export.
- Add exporter-failure tests proving runtime response generation continues and a dropped-span metric/warning is emitted.

Edge cases:
- LangSmith credentials may be missing locally; runtime must disable export without failing calls.
- Redaction failure must drop the trace export rather than leak sensitive content.
- Provider callbacks can finish out of order, so spans must still correlate to the correct turn ID and packet sequence.

Implemented notes:
- Added `apps/api/src/runtime-observability/runtime-observability.ts` with packet-to-span construction, redacted LangSmith projection, OpenTelemetry exporter setup, LangSmith run export, disabled-mode config, and exporter-failure isolation.
- Live sandbox typed and terminal turns record observability after cost events and publish `runtime.warning` plus `runtime.observability` events only when export work or failures actually occur.
- Focused runtime tests cover span/projection shape, redaction, disabled export, LangSmith failure isolation, and live websocket warning/metrics behavior.

### ISSUE-139: LangSmith Vitest runtime eval fixture harness

- Priority: P0
- Area: Testing
- Milestone: Runtime
- Labels: runtime, testing, observability, backend, tdd-required
- Status: Implemented
- Blocked by: ISSUE-133, ISSUE-134, ISSUE-135, ISSUE-136
- Handover: [docs/Handovers/ISSUE-139-langsmith-vitest-runtime-eval-fixture-harness.md](../docs/Handovers/ISSUE-139-langsmith-vitest-runtime-eval-fixture-harness.md)
- External: [Linear ZAR-72](https://linear.app/zara-voice/issue/ZAR-72/issue-139-langsmith-vitest-runtime-eval-fixture-harness)

Acceptance criteria:
- Repo has a separate LangSmith eval Vitest config and npm script that runs `.eval.ts` files without changing the ordinary `test` and `test:run` commands
- Runtime eval fixtures use packet and manifest projections for `zara.intent-routing.v1`, `zara.toolbelt.v1`, `zara.transfer.v1`, `zara.policy-guards.v1`, and `zara.end-to-end-call.v1`
- Deterministic evaluators score exact selected intent, selected branch/target, fallback behavior, assigned-tool-only behavior, missing-input behavior, transfer target/context, policy warnings, and redaction safety
- `openevals` LLM-as-judge evaluators cover qualitative behavior such as transfer-context acknowledgement, safe tool-output summarization, missing-input questions, and role/policy adherence
- Evals can dry-run locally without LangSmith upload and can upload named experiments with dataset version, release version, model alias, and packet schema tags when LangSmith credentials are present

TDD notes:
- Start with failing fixture-loader and deterministic evaluator tests before adding LangSmith eval config.
- Add a minimal `.eval.ts` suite with fake runtime outputs before wiring any provider-backed evaluator.
- Keep ordinary Vitest test commands green without LangSmith environment variables.

Edge cases:
- Eval datasets must be versioned so prompt/model changes can be compared against stable examples.
- LLM-as-judge failures should report score keys and explanations without blocking the normal unit suite.
- Eval fixtures must not contain unredacted production transcript, credentials, raw tool output, or audio.

Implemented notes:
- Added five versioned packet/manifest projection fixture suites for `zara.intent-routing.v1`, `zara.toolbelt.v1`, `zara.transfer.v1`, `zara.policy-guards.v1`, and `zara.end-to-end-call.v1`.
- Added deterministic scorecards for exact intent/target/fallback, assigned-tool-only behavior, missing-input behavior, transfer context, policy warnings, and redaction safety.
- Added openevals LLM-as-judge evaluator plans for transfer acknowledgement, safe tool-output summarization, missing-input questions, and role/policy adherence.
- Added `ls.vitest.config.ts` plus `npm run eval:runtime` so `.eval.ts` suites dry-run locally and upload to LangSmith only when credentials/tracing are enabled.

### ISSUE-140: Runtime eval regression gates and AI observability dashboards

- Priority: P1
- Area: Monitoring
- Milestone: Production
- Labels: runtime, observability, testing, devops, platform-admin, tdd-required
- Status: Implemented
- Blocked by: ISSUE-137, ISSUE-138, ISSUE-139
- Handover: [docs/Handovers/ISSUE-140-runtime-eval-regression-gates-and-ai-observability-dashboards.md](../docs/Handovers/ISSUE-140-runtime-eval-regression-gates-and-ai-observability-dashboards.md)
- External: [Linear ZAR-73](https://linear.app/zara-voice/issue/ZAR-73/issue-140-runtime-eval-regression-gates-and-ai-observability)

Acceptance criteria:
- CI/release workflow can run runtime evals as a separate gate for protected prompt, model, routing, tool, transfer, and policy changes
- Platform/staff observability surfaces expose AI runtime health: intent fallback rate, classifier confidence, tool use/failure rate, transfer loop prevention, policy warning count, packet truncation, LangSmith export health, and eval regression status
- Eval thresholds are documented by suite, including deterministic pass requirements and LLM-as-judge score thresholds with manual review fallback
- Failing eval runs link to LangSmith experiments and local trace IDs without exposing tenant secrets or unredacted transcript
- Staging and production runbooks include eval and LangSmith trace checks for release validation

TDD notes:
- Start with failing CI/config or script tests that prove eval commands are separate from ordinary tests.
- Add dashboard/aggregation tests for AI runtime health metrics before updating platform-admin or monitoring surfaces.
- Add docs tests or runbook checks if the existing production-devops docs test is extended for eval gate wording.

Edge cases:
- Eval gates should fail closed for protected release changes but remain manually overrideable with documented owner signoff.
- LangSmith outage should not block emergency runtime fixes when local deterministic evals pass and the release owner records the exception.
- Tenant-facing dashboards must not expose cross-tenant LangSmith links or redacted internal trace metadata meant only for Zara staff.

Implemented:
- Added a separate `Runtime eval gate` step to CI that runs `npm run eval:runtime` after ordinary tests.
- Added staff-only `GET /platform-admin/runtime/ai-observability` with AI runtime health summary, eval thresholds, protected change categories, emergency override policy, and redacted failing-run references.
- Added platform-admin runtime UI coverage for AI runtime health, LangSmith export health, eval status, and runtime eval command.
- Documented deterministic 100% pass threshold, LLM-as-judge 0.8 threshold, manual review fallback, LangSmith outage override, and staging/production trace checks.

### ISSUE-141: Sandbox runtime provider decision and call control state

- Priority: P1
- Area: Frontend
- Milestone: Sandbox
- Labels: workflow-builder, sandbox, runtime, frontend, tdd-required
- Status: Implemented
- Handover: [docs/Handovers/ISSUE-141-sandbox-runtime-provider-decision-and-call-control-state.md](../docs/Handovers/ISSUE-141-sandbox-runtime-provider-decision-and-call-control-state.md)
- External: [Linear ZAR-87](https://linear.app/zara-voice/issue/ZAR-87/issue-141-sandbox-runtime-provider-decision-and-call-control-state)

Acceptance criteria:
- Draft sandbox runtime decision display reflects a selected Gemini Live realtime provider/model instead of showing the profile-level OpenAI Realtime default.
- Premium realtime draft runs suppress stale sandwich-routing copy such as OpenAI standard profile-default decisions when the effective role runtime is Gemini Live or OpenAI Realtime.
- Start Call and typed start actions are disabled while the live sandbox is connecting, active, listening for user speech, or playing agent audio.
- End Call remains enabled while the live sandbox is connecting, active, listening for user speech, or playing agent audio.
- Focused workflow-builder regression tests cover Gemini Live runtime display and live call-control state.

TDD notes:
- Start with failing workflow-builder UI tests for the stale OpenAI runtime card and inactive End Call button.
- Keep coverage at the drawer behavior boundary; do not add broad visual tests.

Edge cases:
- Agent-level premium realtime overrides must display correctly even when the workflow profile is inherited or defaulted elsewhere.
- Text-model routing decisions remain useful for cost-optimized and balanced sandwich runs, so only premium realtime display suppresses them.
- End Call must remain available during connecting/listening/responding states even if the live-session status is not exactly `active`.

Implemented:
- Added workflow-builder tests for Gemini Live runtime display and call-control state while listening/responding.
- Added sandbox runtime display resolution from the compiled draft manifest's effective entry role realtime provider/model.
- Updated the sandbox drawer to show Gemini Live/OpenAI Realtime provider labels for premium realtime, hide stale sandwich routing copy for premium realtime, and preserve text routing copy for sandwich runs.
- Updated Start/End button disabled states to use connecting, active, voice capture, and agent playback activity instead of a collapsed idle/active status.

### ISSUE-142: Provider-neutral live call session core

- Priority: P0
- Area: Runtime
- Milestone: PSTN Live Call Runtime
- Labels: backend, runtime, architecture, testing, tdd-required
- Status: Implemented
- Blocked by: None
- Handover: [docs/Handovers/ISSUE-142-provider-neutral-live-call-session-core.md](../docs/Handovers/ISSUE-142-provider-neutral-live-call-session-core.md)
- External: [Linear ZAR-88](https://linear.app/zara-voice/issue/ZAR-88/issue-142-provider-neutral-live-call-session-core)

Acceptance criteria:
- A live call session can start from an immutable published workflow version and runtime manifest with a source mode of browser or PSTN
- The core exposes waiting, ringing, connected, listening, thinking, speaking, ending, ended, and failed states with ordered runtime events and packet IDs
- The core consumes workflow graph, turn runtime packet, routing, tools, transfer context, and policy guards without importing Twilio or sandbox-only types
- A durable session coordinator interface exists, with an in-process v1 implementation that can persist and rehydrate session metadata for tests
- Tenant, workspace, number, published version, and runtime profile isolation are covered by failing-first tests
- `docs/PSTN-Live-Call-Runtime-Standard.md`, `docs/Architecture.md`, `docs/Runtime-Manifests.md`, `docs/Telephony.md`, and `docs/Testing-Strategy.md` stay aligned with the implemented core

TDD notes:
- Start with failing core session lifecycle and manifest-pinning tests.
- Add fake provider bridge tests before adding any Twilio bridge code.
- Keep browser live sandbox contract tests green while extracting shared session concepts.

Edge cases:
- Production call code must not import browser sandbox-only state.
- Provider callbacks can arrive out of order.
- Runtime restart should rehydrate session metadata where possible or close safely with audit.

Implemented:
- Added `packages/core/src/live-call-session.ts` with provider-neutral browser/PSTN session sources, lifecycle states, snapshots, ordered `call.started` / `call.lifecycle` events, and packet-correlated turn starts.
- Added a manifest-pinned Turn Runtime Packet creation path that projects active agent and assigned toolbelt state from the compiled runtime manifest.
- Added optional transfer-context and policy-warning seeding through the existing Turn Runtime Packet reducers.
- Added a durable coordinator interface plus in-memory v1 implementation and rehydrate helper.
- Added explicit tenant, workspace, phone number, published version, and runtime profile scope validation for creation and rehydrate.
- Added lifecycle transition guards so terminal `ended` and `failed` sessions cannot reopen.
- Added failing-first core tests for source modes, lifecycle ordering, packet creation, coordinator rehydrate, scope isolation, and terminal lifecycle behavior.
- Added regression coverage proving assigned tools enter the packet as optional capabilities without creating tool calls.

### ISSUE-143: PSTN sandwich audio pipeline and synthetic media harness

- Priority: P0
- Area: Runtime
- Milestone: PSTN Live Call Runtime
- Labels: backend, runtime, integrations, observability, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-142
- Handover: [docs/Handovers/ISSUE-143-pstn-sandwich-audio-pipeline-and-synthetic-media-harness.md](../docs/Handovers/ISSUE-143-pstn-sandwich-audio-pipeline-and-synthetic-media-harness.md)
- External: [Linear ZAR-89](https://linear.app/zara-voice/issue/ZAR-89/issue-143-pstn-sandwich-audio-pipeline-and-synthetic-media-harness)

Acceptance criteria:
- The runtime can consume synthetic inbound mu-law 8 kHz media frames, create a transcript/turn input, route through the published workflow, and emit outbound mu-law 8 kHz audio frames
- Cartesia TTS is configured for a Twilio/PSTN-compatible `pcm_mulaw` 8000 output path when available, with tested fallback behavior when a provider cannot emit PSTN-ready audio
- AssemblyAI or the selected STT adapter receives telephony-safe sample-rate/config metadata and produces packet-backed transcript events
- Zara-owned PSTN sandwich v1 barge-in can interrupt non-side-effect response audio safely and emits clear/interrupt events
- Latency thresholds are enforced and observable: first response target under 1.5s after end-of-turn, model timeout 8s, STT reconnect grace 2s, TTS first-byte timeout 2s, and media no-frame timeout 5s
- Synthetic media fixtures cover clean turn, noisy/partial frame, caller interruption, provider timeout, and safe closeout paths
- Architecture, telephony, observability, and testing docs describe the PSTN sandwich path as separate from premium realtime over PSTN

TDD notes:
- Start with failing codec/frame fixture tests and a synthetic clean-turn harness.
- Add timeout and barge-in tests before wiring provider adapters.
- Keep runtime packet projection and redaction tests active for PSTN fixtures.

Edge cases:
- TTS provider cannot emit PSTN-ready audio.
- Caller interrupts during side-effect tool execution.
- STT reconnects within grace while packet events continue ordering correctly.

Implemented:
- Added `packages/core/src/pstn-sandwich-runtime.ts` with provider-neutral G.711 mu-law 8 kHz frame contracts, synthetic turn harness, telephony STT input projection, packet-backed caller turns, model-routed responses, PSTN-ready outbound frame emission, latency classifications, TTS fallback, no-frame safe closeout, and barge-in/clear events.
- Added synthetic media coverage for clean turn, noisy/partial frames, provider TTS fallback, model timeout, caller interruption, and media no-frame timeout.
- Added AssemblyAI adapter/provider support and tests for `pcm_mulaw` 8 kHz streaming metadata while preserving browser defaults.
- Added Cartesia adapter/provider support and tests for raw `pcm_mulaw` 8 kHz output requests and codec metadata while preserving browser defaults.

### ISSUE-144: Twilio bidirectional Media Streams bridge

- Priority: P0
- Area: Telephony
- Milestone: PSTN Live Call Runtime
- Labels: backend, integrations, runtime, security, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-142, ISSUE-143
- Handover: [docs/Handovers/ISSUE-144-twilio-bidirectional-media-streams-bridge.md](../docs/Handovers/ISSUE-144-twilio-bidirectional-media-streams-bridge.md)
- External: [Linear ZAR-90](https://linear.app/zara-voice/issue/ZAR-90/issue-144-twilio-bidirectional-media-streams-bridge)

Acceptance criteria:
- Twilio inbound webhooks can return safe TwiML for `<Connect><Stream>` only after signature verification, route resolution, subscription checks, and test/live route policy checks pass
- The media WebSocket accepts Twilio `connected`, `start`, `media`, `mark`, `dtmf`, and `stop` messages and converts them into provider-neutral stream events with call SID, stream SID, sequence, track, timestamp, and codec metadata
- The bridge sends outbound Twilio `media`, `mark`, and `clear` messages using base64 mu-law 8 kHz payloads and never writes Twilio-specific objects into core runtime packets
- Duplicate webhook events, malformed media messages, missing stream IDs, unsupported codecs, and stopped streams are handled with structured errors and safe call closure
- Tests include a synthetic Twilio media harness that exercises inbound audio, outbound audio, barge-in clear, DTMF, stop, and reconnect/failure cases without requiring a real Twilio call
- Twilio credential access remains tenant-scoped and provider secrets are never exposed to browser clients or runtime prompts
- Telephony and security docs document Twilio bridge boundaries, webhook/media authentication, and provider-neutral adapter contracts

TDD notes:
- Start with failing Twilio message contract tests.
- Add synthetic WebSocket harness tests before opening real provider bridge behavior.
- Verify webhook signature and idempotency paths before returning TwiML.

Edge cases:
- Twilio sends malformed media or unsupported codec metadata.
- Media WebSocket connects but no inbound frame arrives.
- Duplicate webhook event arrives after restart.

Implemented:
- Added a Twilio Media Streams bridge that normalizes `connected`, `start`, `media`, `dtmf`, `mark`, and `stop` into API-local provider events and provider-neutral `PstnAudioFrame` values.
- Added outbound Twilio `media`, `mark`, and `clear` builders that accept only active-stream mu-law 8 kHz mono frames.
- Added Twilio webhook TwiML responses so verified routed calls receive `<Connect><Stream>` while duplicate/blocked calls receive safe reject TwiML instead of internal JSON.
- Added a Nest-owned media WebSocket bridge at `/telephony/twilio/media-streams/:callSessionId` that authorizes against server-created execution sessions, rejects concurrent attachment, records DTMF through call-control state, and closes malformed streams safely.
- Added tests for invalid JSON/media, unsupported codecs, invalid payload headers, replayed sequence numbers, post-stop messages, duplicate attachment, outbound media/mark/clear, DTMF, stop, and no raw-media/custom-parameter persistence.

### ISSUE-145: Protected PSTN test route lifecycle

- Priority: P0
- Area: Telephony
- Milestone: PSTN Live Call Runtime
- Labels: backend, frontend, runtime, security, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-142, ISSUE-144
- Handover: [docs/Handovers/ISSUE-145-protected-pstn-test-route-lifecycle.md](../docs/Handovers/ISSUE-145-protected-pstn-test-route-lifecycle.md)
- External: [Linear ZAR-91](https://linear.app/zara-voice/issue/ZAR-91/issue-145-protected-pstn-test-route-lifecycle)

Acceptance criteria:
- Number routing supports separate `test_route` and `live_route` records, both pinned to exact published workflow version IDs and runtime profiles
- Creating a PSTN sandbox test requires at least one allowed caller number, an expiry, a routed number, and a published workflow version; draft graphs cannot be used for PSTN calls
- Only one active waiting PSTN test session per number is allowed in v1, while live routes remain designed for concurrent calls
- Inbound Twilio dispatch prefers an active matching `test_route` only when the caller number is allowed and the waiting session has not expired; otherwise it uses live route policy or rejects safely
- A successful PSTN sandbox test stores verified webhook, allowed caller match, media WebSocket connected, inbound frame received, transcript created, agent response generated, outbound audio sent, clean end/no fatal error, number ID, published version ID, and runtime profile
- Failed, expired, unauthorized-caller, and manually ended tests store operator-readable results without exposing raw audio or secrets
- API, repository, and policy tests cover route separation, caller gating, expiry, idempotency, and workspace/tenant isolation

TDD notes:
- Start with failing route-state tests for separate `test_route` and `live_route`.
- Add allowed-caller and expiry dispatch tests before wiring UI.
- Add successful-test checklist persistence tests from synthetic media harness events.

Edge cases:
- Caller number is withheld and cannot match allowed callers.
- Waiting session expires while Twilio webhook is in flight.
- Same number receives multiple test attempts.

Implemented:
- Added `liveRoute` and `testRoute` records to imported phone numbers and removed legacy flat phone-number route fields as runtime source of truth.
- Added protected PSTN test route creation with published-version, runtime-profile, allowed-caller, future-expiry, and one-active-waiting-session guards.
- Added inbound route precedence so matching, unexpired allowed callers enter `test_route`, other callers use `live_route` or fallback safely, and dispatch records carry route mode, runtime profile, and test session ID.
- Added phone-test checklist/result storage for verified webhook, allowed caller, media socket, inbound frame, transcript, agent response, outbound audio, clean end, and no fatal error.
- Added failed, expired, unauthorized-caller, and manually-ended result storage with sanitized operator-readable reasons and no raw audio/provider payloads.
- Added API, file/Postgres repository, schema, migration, policy, caller-gating, expiry, idempotency, and tenant-isolation coverage.

### ISSUE-146: Unified sandbox phone-test experience

- Priority: P1
- Area: Frontend
- Milestone: PSTN Live Call Runtime
- Labels: frontend, backend, runtime, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-145
- Handover: [docs/Handovers/ISSUE-146-unified-sandbox-phone-test-experience.md](../docs/Handovers/ISSUE-146-unified-sandbox-phone-test-experience.md)
- External: [Linear ZAR-92](https://linear.app/zara-voice/issue/ZAR-92/issue-146-unified-sandbox-phone-test-experience)

Acceptance criteria:
- The tenant sandbox model exposes clear modes: Draft test (browser), Published test (browser), and Phone test (Twilio/PSTN), with labels that make the correct mode obvious
- `/workflows` can deep-link into a Phone test for the selected published version and routed number, and `/sandbox` can run the same phone-test flow for existing published workflows
- `/calls` shows number states as Unassigned, Test route, Ready to activate, Live, and Paused, and can launch the Phone test without duplicating the full sandbox UI
- The Phone test UI shows waiting session state, allowed caller numbers, expiry, active PSTN session, transcript/events, checklist progress, latency/call-quality signals, and final pass/fail result
- Start/end controls remain accurate while waiting for call, connected, listening, thinking, speaking, ending, ended, or failed
- UI tests stay light and cover critical mode selection, start waiting session, active call controls, checklist rendering, and result persistence; deeper coverage remains in API/runtime tests
- `DESIGN.md`, `docs/Frontend-Architecture.md`, `docs/Feature-Flows.md`, and `docs/Telephony.md` stay aligned with the unified sandbox wording

TDD notes:
- Start with focused UI tests for sandbox mode labels and Phone test start flow.
- Add API contract tests for phone-test state before broad UI rendering work.
- Keep visual tests light and prioritize runtime/API behavior.

Edge cases:
- No published version exists.
- Number is already live or has an active waiting test session.
- Test is still active while the operator leaves the page.

Implemented:
- Added `/sandbox` Published test (browser) and Phone test (Twilio/PSTN) modes with protected waiting-session creation, allowed caller input, expiry, checklist progress, active PSTN session placeholders, latency/call-quality placeholders, and stored manually-ended results.
- Added `/calls` number state labels for Unassigned, Test route, Ready to activate, Live, and Paused plus a direct Phone test launch link for routed numbers.
- Populated `/calls` inbound destination and outbound caller-ID selectors from imported, voice-capable tenant phone numbers so imported inventory can be tested before live activation.
- Replaced the old `/workflows` routed-number dispatch simulation with Draft test (browser) and Phone test (Twilio/PSTN) mode labels plus deep links to the shared Phone test sandbox.
- Added `POST /organizations/:orgId/telephony/numbers/:numberId/pstn-test-route/:sessionId/complete` for sanitized manual phone-test completion.

### ISSUE-147: Live route activation and subscription gates

- Priority: P0
- Area: Telephony
- Milestone: PSTN Live Call Runtime
- Labels: backend, frontend, runtime, security, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-145, ISSUE-146
- Handover: [docs/Handovers/ISSUE-147-live-route-activation-and-subscription-gates.md](../docs/Handovers/ISSUE-147-live-route-activation-and-subscription-gates.md)
- External: [Linear ZAR-93](https://linear.app/zara-voice/issue/ZAR-93/issue-147-live-route-activation-and-subscription-gates)

Acceptance criteria:
- A live route can only be activated from a number/workflow/runtime profile combination with a recent successful PSTN sandbox test result, unless an authorized override is recorded
- Activation requires a confirmation summary showing number, workflow name, published version ID, runtime profile, recording posture, allowed/provider route, subscription posture, and known risks
- Hard blocks prevent activation for missing published version, failed/expired test, no active subscription, suspended tenant, unsafe recording policy, invalid provider health, missing consent requirement, or budget hard block
- Subscription loss preserves numbers, credentials, route setup, and history but stops new answering; inactive callers receive safe unavailable TwiML and a blocked dispatch record
- If subscription lapses mid-call, the active call may finish within the configured grace window; budget hard limit closes out after the current turn unless emergency/human policy says otherwise; abuse/security suspension terminates immediately when possible
- Live routes support concurrent calls while test routes remain one waiting session per number in v1
- API, billing, telephony, UI, audit, and tenant-isolation tests cover activation, pause/resume, subscription lapse, budget hard stop, and suspension paths

TDD notes:
- Start with failing activation guard tests for each hard block.
- Add mid-call subscription/budget/suspension tests before UI confirmation work.
- Keep audit and tenant isolation assertions in the backend integration layer.

Edge cases:
- Subscription lapses between confirmation render and activation submit.
- Budget hard limit is reached during model/TTS work.
- Abuse suspension occurs during an active call.

Implemented:
- Added `pending_activation`, `active`, and `paused` live-route states; saving a live route no longer makes it answer calls until activation succeeds.
- Added manual activation from a matching successful PSTN Phone test result, with audited override support for authorized exceptions.
- Added activation summaries and hard-block checks for subscription, tenant suspension, provider health, recording posture, credentials, and budget hard blocks.
- Added `/calls` activation, pause, and resume controls plus number state labels that distinguish Ready to activate, Live, and Paused.
- Added tenant-wide saved workflow routing selectors, provider-connection deletion with active inventory/credential cleanup, and live-control selectors backed by persisted dispatch/execution sessions on `/calls`.
- Added blocked inbound dispatch and safe unavailable TwiML when a live route is pending, paused, inactive by subscription, over hard budget, or tenant-suspended.
- Added mid-call policy transitions for subscription grace, budget closeout after current turn, and immediate suspension termination.
- Added API, persistence, tenant-isolation, audit, billing-policy, core, and UI smoke coverage for the activation gate.

### ISSUE-148: PSTN observability, latency evals, and production gates

- Priority: P1
- Area: Monitoring
- Milestone: PSTN Live Call Runtime
- Labels: backend, frontend, platform-admin, observability, testing, devops, tdd-required
- Status: Implemented
- Blocked by: ISSUE-143, ISSUE-144, ISSUE-147
- Handover: [docs/Handovers/ISSUE-148-pstn-observability-latency-evals-and-production-gates.md](../docs/Handovers/ISSUE-148-pstn-observability-latency-evals-and-production-gates.md)
- External: [Linear ZAR-94](https://linear.app/zara-voice/issue/ZAR-94/issue-148-pstn-observability-latency-evals-and-production-gates)

Acceptance criteria:
- PSTN calls emit OpenTelemetry spans and internal metrics for webhook receipt, route selection, media WebSocket connect, inbound first frame, transcript creation, model first token, TTS first byte, outbound first audio frame, barge-in clear, call end, and provider/runtime failures
- Platform-admin runtime health shows PSTN call quality signals including first-response latency, no-frame timeouts, STT reconnects, TTS first-byte timeouts, model timeouts, bridge errors, barge-in count, Twilio stop reasons, and successful-test rate
- Synthetic Twilio media harness scenarios run in a separate eval/test command and assert the agreed successful PSTN test checklist plus latency threshold classifications
- Redacted LangSmith traces may link PSTN turn decisions, intent/tool/transfer facts, provider/model metadata, and policy warnings, but raw audio, raw transcript, caller number, secrets, and untrusted tool output are omitted
- Release gates document when PSTN synthetic evals must pass, how emergency overrides are recorded, and how provider outages avoid blocking urgent safe fixes
- Docs and runbooks update `docs/Observability-And-Evals-Standard.md`, `docs/Observability-Dashboards.md`, `docs/Telephony.md`, `docs/Testing-Strategy.md`, and `docs/Production-Deployment.md`

TDD notes:
- Start with failing span/metric projection tests from synthetic PSTN events.
- Add redaction tests before enabling LangSmith export for PSTN traces.
- Keep PSTN eval commands separate from ordinary unit tests.

Edge cases:
- LangSmith credentials are absent or LangSmith is down.
- Provider callbacks finish out of order.
- Synthetic evals pass but real provider health is degraded.

Implemented:
- Added PSTN call trace projection for webhook receipt, route selection, media WebSocket connect, first inbound frame, transcript creation, model first token, TTS first byte, first outbound frame, barge-in clear, call end, and provider/runtime failures.
- Added PSTN quality metrics for first-response latency classification, no-frame timeouts, STT reconnects, TTS first-byte timeouts, model timeouts, bridge errors, barge-ins, Twilio stop reasons, and successful Phone test rate.
- Added redacted LangSmith PSTN trace projection that omits raw audio, raw transcript, caller numbers, provider credentials, secrets, and untrusted tool output.
- Wired Twilio webhook and media WebSocket lifecycle points into the PSTN observability recorder without blocking live calls on exporter failures.
- Added platform-admin PSTN call-quality posture to the staff-only AI runtime observability API and UI.
- Added `npm run eval:pstn`, `pstn.vitest.config.ts`, deterministic `zara.pstn-media.v1` fixtures, and a separate CI PSTN eval gate.
- Updated observability, dashboard, telephony, testing, deployment, roadmap, backlog, and standard docs for the implemented gate.

### ISSUE-149: Premium realtime over PSTN provider slice

- Priority: P1
- Area: Runtime
- Milestone: PSTN Live Call Runtime
- Labels: backend, runtime, integrations, observability, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-142, ISSUE-144, ISSUE-148
- Handover: [docs/Handovers/ISSUE-149-premium-realtime-over-pstn-provider-slice.md](../docs/Handovers/ISSUE-149-premium-realtime-over-pstn-provider-slice.md)
- External: [Linear ZAR-95](https://linear.app/zara-voice/issue/ZAR-95/issue-149-premium-realtime-over-pstn-provider-slice)

Acceptance criteria:
- PSTN premium realtime is blocked by default until this slice adds an explicit provider capability check, tenant entitlement check, runtime profile policy, and call-start gate
- At least one approved premium realtime provider path can receive PSTN media through Zara's bridge, stream provider-native audio output back to the telephony media stream, and write turn packet facts compatible with existing intent/tool/transfer/policy observability
- Provider-native interruption and barge-in semantics are normalized into Zara runtime events without duplicating the PSTN sandwich v1 interruption implementation
- The UI labels premium realtime PSTN separately from Phone test sandwich mode so operators know which sandbox/live mode they are exercising
- Latency, cost, provider failure, and fallback behavior are observable and evaluated separately from cost-optimized and balanced PSTN sandwich calls
- Tests cover provider unavailable, entitlement denied, premium route selected, interruption, provider fallback/blocking, and redacted trace export
- Architecture, runtime manifest, telephony, observability, and sandbox docs clearly label premium realtime over PSTN as a separate runtime path

TDD notes:
- Start with failing call-start gate tests proving PSTN premium realtime is blocked before this slice is enabled.
- Add provider capability and interruption-normalization contract tests before provider-specific implementation.
- Keep sandwich PSTN tests separate so premium behavior cannot silently change the cost-optimized path.

Edge cases:
- Tenant selects premium profile on a phone route before entitlement exists.
- Premium provider supports interruption differently from Zara sandwich.
- Premium provider outage should not silently downgrade to sandwich without explicit policy.

Implementation summary:
- Added `pstn-premium-realtime` runtime path, call-start gate policy, and provider-neutral premium realtime PSTN turn harness in `@zara/core`.
- Routed premium PSTN test/live dispatch through explicit provider capability, provider availability, entitlement, budget, and fallback-policy checks.
- Preserved `runtimePath` through dispatch records, Twilio stream metadata, observability projections, LangSmith redacted traces, and PSTN eval fixtures.
- Labeled premium realtime PSTN separately in the unified Phone test sandbox while keeping one sandbox surface.
- Added regression coverage for blocked-by-default premium calls, approved premium route selection, provider unavailable, interruption normalization, provider failure blocking, redacted trace export, and the premium PSTN eval fixture.

### ISSUE-150: Server-owned auth context contract

- Priority: P1
- Area: Auth
- Milestone: Auth Flow Hardening
- Labels: auth, backend, frontend, security, testing, tdd-required
- Status: Implemented
- Blocked by: None
- Handover: [docs/Handovers/ISSUE-150-server-owned-auth-context-contract.md](../docs/Handovers/ISSUE-150-server-owned-auth-context-contract.md)
- External: [Linear ZAR-96](https://linear.app/zara-voice/issue/ZAR-96/issue-150-server-owned-auth-context-contract)

Acceptance criteria:
- API exposes a server-owned auth context endpoint with user, active tenant organization, memberships, platform role, permissions summary, and active/default workspace metadata where available
- Unauthenticated requests receive a safe unauthenticated context or 401 according to the documented contract, without leaking tenant or platform data
- Tenant and platform-admin auth boundaries can consume the context without weakening existing frontend gates
- API, shared auth-client, and docs tests cover signed-out, tenant member, tenant-without-active-org, and platform role contexts
- `docs/API.md`, `docs/Frontend-Architecture.md`, `docs/Roadmap.md`, and `docs/Issue-Backlog.md` describe the implemented baseline

TDD notes:
- Start with failing API contract tests for signed-out and authenticated contexts.
- Add shared auth-client tests before frontend consumption.
- Keep existing Better Auth session and organization restoration tests green.

Edge cases:
- Better Auth session exists with no active organization.
- User has tenant membership and platform role at the same time.
- Workspace restore points at an inaccessible or archived workspace.

Implementation notes:
- `GET /api/auth/context` returns the server-owned auth context with a safe signed-out shape, tenant organization membership context, default workspace metadata, platform role authority, and flattened permission summaries.
- `packages/auth-client` exposes `getContext()` and includes cookies when reading the server-owned context.

### ISSUE-151: Atomic tenant onboarding signup

- Priority: P1
- Area: Auth
- Milestone: Auth Flow Hardening
- Labels: auth, backend, frontend, security, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-150
- Handover: [docs/Handovers/ISSUE-151-atomic-tenant-onboarding-signup.md](../docs/Handovers/ISSUE-151-atomic-tenant-onboarding-signup.md)
- External: [Linear ZAR-97](https://linear.app/zara-voice/issue/ZAR-97/issue-151-atomic-tenant-onboarding-signup)

Acceptance criteria:
- Signup creates or resumes the complete tenant onboarding state without leaving users stranded after partial Better Auth organization failures
- A new owner lands in an active organization with a default workspace and owner membership after signup
- Blank/duplicate unsafe tenant names return actionable errors before irreversible writes where possible
- Failed partial onboarding is visible as a recoverable state with safe retry behavior
- API, auth-client, workspace, and tenant UI smoke tests cover success, partial failure, retry, and duplicate-name paths
- Auth, workspace, API, and roadmap docs describe the new onboarding contract

TDD notes:
- Start with failing server onboarding tests for user/org/workspace creation as one product action.
- Add partial failure and retry tests before changing the tenant signup UI.
- Keep tenant mirror tests green while moving orchestration server-side.

Edge cases:
- Better Auth user creation succeeds but organization creation fails.
- Organization slug collides with an existing tenant.
- Workspace creation fails after the organization was mirrored.

Implementation notes:
- `POST /api/auth/onboarding/signup` is the server-owned signup action. It validates tenant names, creates or resumes the Better Auth user, checks tenant slug availability, creates the tenant organization, sets it active, initializes workspace state, grants owner access to `workspace-support`, and returns the tenant context needed by the app.
- Partial failures after user creation return a recoverable onboarding response; retrying the same payload can finish setup instead of stranding the user.
- Duplicate tenant names from either known onboarding state or Better Auth slug collisions return the standardized `tenant_name_unavailable` response and keep the tenant UI on the signup form.
- `packages/auth-client` now calls the onboarding endpoint for tenant signup and preserves duplicate/recoverable server messages for the UI.

### ISSUE-152: Tenant organization and workspace chooser

- Priority: P2
- Area: Auth
- Milestone: Auth Flow Hardening
- Labels: auth, frontend, backend, security, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-150
- Handover: [docs/Handovers/ISSUE-152-tenant-organization-and-workspace-chooser.md](../docs/Handovers/ISSUE-152-tenant-organization-and-workspace-chooser.md)
- External: [Linear ZAR-98](https://linear.app/zara-voice/issue/ZAR-98/issue-152-tenant-organization-and-workspace-chooser)

Acceptance criteria:
- Sign-in auto-enters the only available tenant organization when there is exactly one membership
- Multi-tenant users see an organization chooser before tenant routes render
- The chosen organization is set active through Better Auth and the last active workspace is restored only when accessible
- Tenant-only, no-tenant, archived-workspace, and membership-revoked states render safe actionable UX
- API/auth context, auth-client, and tenant UI tests cover single-org, multi-org, no-org, and inaccessible-workspace cases
- Frontend architecture and auth docs describe the chooser rules

TDD notes:
- Start with shared auth-client/context tests proving first-org restoration is no longer silent for multi-tenant users.
- Add focused UI tests for the chooser and workspace restore behavior.
- Keep single-org sign-in frictionless.

Edge cases:
- User belongs to no tenant organizations.
- Last workspace was archived or revoked.
- Active organization changes in another tab.

Implementation notes:
- Tenant email sign-in auto-enters only when Better Auth returns exactly one organization membership; multi-tenant sign-in no longer chooses the first organization silently.
- The shared auth client exposes explicit tenant organization selection through Better Auth `set-active`, then refreshes server-owned context for the tenant shell.
- `GET /api/auth/context` returns membership summaries even when no active organization is selected, and active workspace is returned only when the signed-in user has an active workspace membership.
- The tenant UI renders a tenant chooser for multi-tenant users before tenant routes, scopes last active workspace storage by tenant organization, and ignores stored workspaces that are archived or inaccessible.
- Workflow builder sandbox launches now inherit the active organization and signed-in actor from the tenant shell, preventing draft sandbox runs from using the seeded demo actor against another accessible workspace.
- `GET /api/auth/context` now repairs legacy or partial tenant owner/admin sessions that have an active tenant organization but no product workspace membership by granting default workspace access before returning the active workspace.
- The tenant shell now treats the server-owned active workspace from auth context as authoritative during initial workspace resolution, so stale workspace membership responses cannot push sandbox runs back to seeded `workspace-operations`.

### ISSUE-153: Tenant invitation acceptance flow

- Priority: P2
- Area: Auth
- Milestone: Auth Flow Hardening
- Labels: auth, backend, frontend, security, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-150, ISSUE-152
- Handover: [docs/Handovers/ISSUE-153-tenant-invitation-acceptance-flow.md](../docs/Handovers/ISSUE-153-tenant-invitation-acceptance-flow.md)
- External: [Linear ZAR-99](https://linear.app/zara-voice/issue/ZAR-99/issue-153-tenant-invitation-acceptance-flow)

Acceptance criteria:
- Tenant owners/admins can create and revoke invitations with tenant role and optional workspace access intent
- Invite acceptance supports existing users and new users through the auth flow
- Accepted users land in the invited organization and only assigned accessible workspaces
- Expired, revoked, already-accepted, cross-tenant, and wrong-email invites fail safely
- API, auth-client, workspace, tenant UI, and audit tests cover invitation lifecycle and tenant isolation
- API, frontend, and security docs describe invitation authority and audit behavior

TDD notes:
- Start with failing API invitation lifecycle tests.
- Add acceptance tests for existing and new users before tenant UI controls.
- Include audit and tenant-isolation assertions in backend tests.

Edge cases:
- Invite email differs from signed-in email.
- Invitation expires during signup.
- Workspace access grant fails after organization membership is accepted.

Implementation notes:
- `POST /api/auth/invitations`, `GET /api/auth/invitations?organizationId=...`, `POST /api/auth/invitations/:invitationId/revoke`, and `POST /api/auth/invitations/:invitationId/accept` wrap Better Auth invitation authority in a Zara-owned contract.
- Invitation creation validates tenant role, invited email, active workspace intent, and Better Auth organization invitation permissions before returning a normalized pending invitation with audit entries.
- Invitation acceptance supports signed-in existing users and new users that provide email/password/name; it rejects wrong-email, revoked, already-accepted, expired, and cross-tenant attempts with stable product error codes.
- Accepted invitations set the Better Auth organization active and grant only the configured workspace role when workspace access intent was present.
- The shared auth client exposes invitation create/list/revoke/accept helpers, and the tenant Settings workspace screen can invite teammates into the selected workspace and revoke pending invitations.
- Invitation lists now load only on `/settings`, so workflow and sandbox pages do not trigger unrelated invitation-provider reads or surface invitation conflicts.
- The durable auth schema includes `invitation.workspaceId` and `invitation.workspaceRole` via `0005_auth_invitation_workspace_intent.sql`.

### ISSUE-154: Account security flows and session controls

- Priority: P1
- Area: Auth
- Milestone: Auth Flow Hardening
- Labels: auth, backend, frontend, security, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-150
- Handover: [docs/Handovers/ISSUE-154-account-security-flows-and-session-controls.md](../docs/Handovers/ISSUE-154-account-security-flows-and-session-controls.md)
- External: [Linear ZAR-100](https://linear.app/zara-voice/issue/ZAR-100/issue-154-account-security-flows-and-session-controls)

Acceptance criteria:
- Email verification is required or clearly staged for risky account actions according to the product rule
- Password reset email flow is wired through server-owned email delivery and returns no account-enumeration leaks
- Auth endpoints have configured rate limiting and proxy-safe secure cookie behavior for production
- Users can view and revoke sessions, and sign-out reliably clears active tenant/platform context
- Tests cover verification, reset, rate-limit, session revoke, account enumeration resistance, and production env configuration
- Deployment and security docs list required auth env variables and operational checks

TDD notes:
- Start with Better Auth configuration tests for verification/reset/rate-limit behavior.
- Add no-account-enumeration tests before exposing reset UX.
- Keep deployment env documentation synchronized with config tests.

Edge cases:
- Reset requested for unknown email.
- Verification link is expired or reused.
- Session revoked in another browser while a live sandbox is open.

Implementation notes:
- Production database-backed Better Auth rate limiting uses the durable `rateLimit` table added by `0006_auth_rate_limit_table.sql`; the migration is idempotent so live deployments patched ahead of the new image can still run it safely.
- Follow-up hardening on 2026-06-04 keyed tenant shell auth-context reads by stable session primitives and raised the default global auth bucket to 300 requests per 60 seconds so normal session/org reads do not trip production 429s. Better Auth's stricter built-in sign-in, sign-up, password-reset, and verification-email limits remain in force.
- Coolify production and preview `ZARA_AUTH_RATE_LIMIT_MAX` variables were updated to `300` and redeployed on 2026-06-04; a live 70-request `/api/auth/get-session` probe returned all HTTP 200 responses. A follow-up client hardening pass also removed normal tenant shell subscriptions to Better Auth active-organization/member hook readers, so the server-owned auth context carries active tenant/workspace restoration without extra Better Auth read fan-out during render.
- Follow-up hardening on 2026-06-04 removed normal tenant/platform shell dependency on Better Auth `useSession()` reads, moved tenant email sign-in auto-entry to Zara auth-context memberships instead of Better Auth organization list reads, and made production `/api/auth/context` load organization memberships from the Better Auth Postgres tables with one query after the single session read.
- Follow-up hardening on 2026-06-04 removed the Better Auth React client and organization plugin from the browser auth boundary entirely. Tenant/platform app bundles keep server-owned `/api/auth/context` as the only shell auth read, while sign-in, organization selection, and sign-out call the mounted Better Auth REST endpoints directly with cookies.
- Coolify production packaging keeps deterministic `npm ci --no-audit --fund=false` installs without BuildKit npm cache mounts or `--prefer-offline`, because cache-backed installs can wedge helper deployments after the underlying build process exits.
- Coolify frontend packaging serves SPA document routes with `Cache-Control: no-store, max-age=0` while keeping hashed assets immutable, so browser tabs pick up new auth/runtime bundles after deployment instead of continuing old code that can fan out Better Auth reads.

### ISSUE-155: Platform admin MFA and staff auth hardening

- Priority: P1
- Area: Platform Admin
- Milestone: Auth Flow Hardening
- Labels: auth, backend, frontend, platform-admin, security, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-150, ISSUE-154
- Handover: [docs/Handovers/ISSUE-155-platform-admin-mfa-and-staff-auth-hardening.md](../docs/Handovers/ISSUE-155-platform-admin-mfa-and-staff-auth-hardening.md)
- External: [Linear ZAR-101](https://linear.app/zara-voice/issue/ZAR-101/issue-155-platform-admin-mfa-and-staff-auth-hardening)

Acceptance criteria:
- Platform-admin sign-in has its own actionable form/state and never reuses tenant organization membership as staff authority
- Platform roles require MFA/passkey posture for mutating staff operations, with readonly/support behavior explicitly defined
- Admin auth context exposes platform role, auth assurance level, session age, and impersonation-safe posture
- Staff sign-out, session expiry, and tenant-only access attempts render safe states and write/emit audit facts where required
- API, platform-admin UI, auth-client, and security tests cover staff role, tenant-only, MFA-required, and session-expired cases
- Platform-admin, security, and deployment docs describe the hardened staff auth rules

TDD notes:
- Start with platform-admin auth-context tests for assurance and role posture.
- Add tenant-only denial tests before changing staff UI.
- Keep platform-admin routes guarded server-side, not only in React.

Edge cases:
- Platform role exists but MFA/passkey posture is missing.
- Tenant admin attempts to use the staff origin.
- Staff session expires during impersonation or a mutating staff operation.

Implementation notes:
- `GET /api/auth/context` now includes `platformAuth` with role, assurance level, session age, MFA/passkey flags, mutation/support/impersonation posture, and stable reason codes.
- Platform staff role authority resolves from `ZARA_PLATFORM_STAFF_ROLES` signed-in email mappings in production. Non-production tests/local trusted-proxy paths can still provide `x-zara-platform-role`.
- Platform-admin APIs reject expired staff sessions, reject tenant-only sessions, allow password-only reads according to role, and require MFA/passkey assurance in a fresh step-up window for core mutations, support actions, and impersonation.
- Platform audit entries include auth assurance and session age facts for staff mutations.
- `packages/auth-client` normalizes platform auth posture and restores platform-admin session state from the server-owned context after sign-in.
- The platform-admin app renders a dedicated sign-in form, tenant-only restricted state, expired-session sign-in-again state, sign-out control, assurance badge, and disabled mutation controls when MFA/passkey step-up is missing.

### ISSUE-156: Provider registry and API-served catalog foundation

- Priority: P1
- Area: Integrations
- Milestone: Integration Registry and Knowledge Expansion
- Labels: integrations, backend, frontend, security, testing, tdd-required
- Status: Implemented
- Blocked by: None
- Handover: [docs/Handovers/ISSUE-156-provider-registry-and-api-served-catalog-foundation.md](../docs/Handovers/ISSUE-156-provider-registry-and-api-served-catalog-foundation.md)
- External: [Linear ZAR-110](https://linear.app/zara-voice/issue/ZAR-110/issue-156-provider-registry-and-api-served-catalog-foundation)

Acceptance criteria:
- Registry metadata represents provider IDs, labels, categories, capabilities, setup schema, logo tokens, tool IDs/names, risk posture, and knowledge-source flags without exposing provider base URLs, auth headers, secret schemas, or executor details to the frontend
- API exposes a tenant-safe catalog endpoint for supported providers and capabilities
- Existing provider docs references and docs-verified dates are represented in registry metadata
- Tests cover catalog serialization, hidden server-only metadata, unsupported provider rejection, and tenant-safe response shape
- Architecture, roadmap, and backlog docs describe the registry contract

TDD notes:
- Start with failing catalog API and registry serialization tests.
- Add frontend catalog-consumption contract tests before replacing local provider constants.
- Keep secret/server-only registry metadata covered by explicit non-exposure tests.

Edge cases:
- Unsupported provider IDs must fail safely.
- Frontend catalog responses must not include provider base URLs, auth headers, or executor metadata.
- Registry changes must not break existing tenant connections.

### ISSUE-157: Migrate current connectors to the registry catalog

- Priority: P1
- Area: Integrations
- Milestone: Integration Registry and Knowledge Expansion
- Labels: integrations, backend, frontend, workflow-builder, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-156
- Handover: [docs/Handovers/ISSUE-157-migrate-current-connectors-to-registry-catalog.md](../docs/Handovers/ISSUE-157-migrate-current-connectors-to-registry-catalog.md)
- External: [Linear ZAR-111](https://linear.app/zara-voice/issue/ZAR-111/issue-157-migrate-current-connectors-to-the-registry-catalog)

Acceptance criteria:
- Current Zendesk, HubSpot, Google Workspace, Notion, and webhook providers appear from the API-served catalog with their existing capabilities and provider logo tokens
- Workflow tool provider/tool dropdowns are populated from the catalog and still list Zendesk search/create/update ticket options
- Tenant integrations page displays catalog tools from the registry response and keeps provider API URLs and auth metadata hidden
- Existing configured connections and workflow tool nodes continue to load after migration
- Tests cover catalog-backed integrations page rendering, workflow inspector provider/tool dropdowns, existing node compatibility, and no exposed server-owned endpoint metadata

TDD notes:
- Start with failing tests that prove the integrations page and builder consume the API catalog instead of local hardcoded provider lists.
- Add compatibility tests for already-saved workflow tool nodes before changing catalog mapping.
- Keep existing Zendesk tool ID tests green.

Edge cases:
- Loaded workflow nodes may reference a connection not returned by the current integrations API.
- Webhook tools remain user-configurable while built-in provider tools keep request metadata hidden.
- Catalog load failures should not corrupt existing workflow drafts.

### ISSUE-158: Capability grants and connection scope setup UX

- Priority: P1
- Area: Integrations
- Milestone: Integration Registry and Knowledge Expansion
- Labels: integrations, frontend, backend, security, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-157
- Handover: [docs/Handovers/ISSUE-158-capability-grants-and-connection-scope-setup-ux.md](../docs/Handovers/ISSUE-158-capability-grants-and-connection-scope-setup-ux.md)
- External: [Linear ZAR-112](https://linear.app/zara-voice/issue/ZAR-112/issue-158-capability-grants-and-connection-scope-setup-ux)

Acceptance criteria:
- Connections can be organization-wide or workspace-owned, with clear tenant UI labels and audited workspace-to-organization promotion
- Agent tools, knowledge sources, and post-call sync each require explicit scoped grants behind simple capability toggles
- Grant creation validates tenant, workspace, workflow, role, capability, and provider OAuth scopes before save and before publish
- Setup presets for support, sales, and ecommerce are previewable/editable before saving and default risky write tools to approval-required
- Workspace setup templates can be copied without silently cloning credentials, OAuth grants, or workspace-owned source access
- Revoke/delete behavior prevents deleting connections with active dependencies and pauses dependent tools/syncs safely
- Tests cover grant scope validation, insufficient-scope reconnect prompts, workspace-owned visibility, promotion audit, preset preview, setup copy, revoke/delete dependency handling, and publish blocking for invalid grants

TDD notes:
- Start with failing API tests for capability grants and connection scope boundaries.
- Add UI tests for the guided setup path after the domain/API contract is green.
- Keep tenant/workspace isolation tests close to grant creation and runtime validation.

Edge cases:
- A connection can be available to a workspace but still lack the grant or OAuth scope required by a specific tool.
- Promotion changes connection availability only and must not create automatic capability grants.
- Revoked connections should pause sync and invalidate publish without deleting imported approved knowledge snapshots.

Implemented notes:
- Added organization-wide and workspace-owned connection availability, tenant UI scope labels, audited promotion, scoped agent-tool grants, revoke/delete dependency handling, and publish-time grant validation.
- Added backend workflow publish validation, tenant-builder publish API wiring with non-destructive grant-validation errors, and a published sandbox startup guard for connector tool bindings with missing grants, revoked/unavailable connections, missing provider scopes, or missing role-specific `agent-tool` coverage.
- Added capability-aware grant coexistence, provider capability validation, agent-tool-only runtime authorization, HubSpot post-call-sync catalog metadata, catalog-driven tenant capability setup status lanes, safe preset preview/template helpers, and dashboard metrics that count only active agent-tool grants.
- Added inline tenant integrations controls to save scoped capability grants against a published workflow, provider connection, provider tool, and approval posture through the real integrations grant endpoint.
- Added editable support, sales, and ecommerce setup preset previews to the tenant integrations page, plus a display-ready safe setup-copy preview helper that omits credentials, OAuth grants, connection IDs, grant IDs, source IDs, and workspace-owned source access.
- Added tenant setup-copy preview UI that shows required target selections, provider connection/grant review, source category/risky-write confirmations, capability rows, and the not-cloned safety list before any tenant action.
- Added safe required-scope metadata to catalog tools and tenant reconnect prompts that disable grant saves when selected connections lack provider scopes and request only the missing scopes during reconnect.
- ISSUE-158 acceptance criteria are implemented.

### ISSUE-159: Provider contract tests and runtime side-effect safety

- Priority: P1
- Area: Integrations
- Milestone: Integration Registry and Knowledge Expansion
- Labels: integrations, runtime, backend, security, testing, tdd-required
- Status: Implemented
- Blocked by: ISSUE-157
- Handover: [docs/Handovers/ISSUE-159-provider-contract-tests-and-runtime-side-effect-safety.md](../docs/Handovers/ISSUE-159-provider-contract-tests-and-runtime-side-effect-safety.md)
- External: [Linear ZAR-113](https://linear.app/zara-voice/issue/ZAR-113/issue-159-provider-contract-tests-and-runtime-side-effect-safety)

Acceptance criteria:
- Built-in provider tools have mocked contract tests that assert provider method, path, query/body shape, auth headers, input validation, normalized output, error mapping, rate-limit handling, tenant/workspace isolation, and secret redaction
- Registry metadata carries provider documentation references and docs-verified dates for implemented tools
- Runtime tool failures classify auth revoked, permission denied, not found, rate limited, provider unavailable, timeout, and validation errors
- Tool failure outcomes appear in live monitor, call summaries, integration health, and trace events with safe fallback language
- Write tools use a Zara side-effect ledger and provider idempotency keys where supported
- Post-send timeouts become unknown outcomes and are not blindly retried; post-call sync consults the ledger before emitting external writes
- Tests cover duplicate-write prevention, unknown write status, manual retry posture, runtime fallback classification, and secret redaction

TDD notes:
- Start with failing mocked contract tests for one existing provider tool before generalizing the harness.
- Add side-effect ledger tests before wiring runtime/post-call sync write behavior.
- Use optional live provider smoke tests only when credentials are configured; do not make ordinary CI depend on provider availability.

Edge cases:
- Provider timeout after request send must become unknown instead of failed/retryable.
- Post-call sync must not duplicate side effects already attempted during the live call.
- Provider error payloads must not leak secrets to logs, traces, or tenant responses.

### ISSUE-160: Knowledge base add/import snapshot workflow

- Priority: P1
- Area: Memory
- Milestone: Integration Registry and Knowledge Expansion
- Labels: memory, integrations, frontend, backend, testing, tdd-required
- Status: Pending
- Blocked by: ISSUE-158
- Handover: [docs/Handovers/ISSUE-160-knowledge-base-add-import-snapshot-workflow.md](../docs/Handovers/ISSUE-160-knowledge-base-add-import-snapshot-workflow.md)
- External: [Linear ZAR-114](https://linear.app/zara-voice/issue/ZAR-114/issue-160-knowledge-base-addimport-snapshot-workflow)

Acceptance criteria:
- Tenant memory/knowledge UI exposes an Add source flow for manual text, single URL, PDF, and one-time provider imports that are actually supported end to end
- Knowledge records support the expanded taxonomy: FAQ, policy, procedure, troubleshooting, pricing, escalation, legal/compliance, and general reference
- Imported sources produce source snapshots and extracted record-level review drafts rather than exposing embedding chunks to users
- Manual entries choose a record type directly and imported records receive suggested types that require confirmation for high-risk categories
- Default scope is active workspace with optional workflow selection; runtime retrieval uses only approved records
- Published workflow manifests freeze allowed knowledge scope while newly approved records inside that scope become available to new calls
- Tests cover source creation, snapshot creation, extracted record review, high-risk classification confirmation, workspace/workflow scope, publish manifest scope, and no unapproved runtime retrieval

TDD notes:
- Start with failing memory API tests for source snapshots and extracted record review.
- Add frontend tests for Add source only after the source/review API contract exists.
- Keep retrieval tests proving unapproved draft records never enter runtime knowledge.

Edge cases:
- Imported PDFs, URLs, and provider documents may produce no usable extracted records.
- High-risk type suggestions must require explicit confirmation.
- Active calls keep the retrieval snapshot they started with.

### ISSUE-161: Recurring knowledge sync review and safety gates

- Priority: P1
- Area: Memory
- Milestone: Integration Registry and Knowledge Expansion
- Labels: memory, integrations, backend, frontend, security, testing, tdd-required
- Status: Pending
- Blocked by: ISSUE-160
- Handover: [docs/Handovers/ISSUE-161-recurring-knowledge-sync-review-and-safety-gates.md](../docs/Handovers/ISSUE-161-recurring-knowledge-sync-review-and-safety-gates.md)
- External: [Linear ZAR-115](https://linear.app/zara-voice/issue/ZAR-115/issue-161-recurring-knowledge-sync-review-and-safety-gates)

Acceptance criteria:
- Knowledge sources support snapshot and recurring modes, with recurring sync limited to manual refresh plus daily scheduled sync in v1
- Sync creates review-gated update drafts and never changes active runtime knowledge automatically
- Confirmed source deletions create deletion/stale review drafts while the current approved snapshot remains active until approved deletion or manual disable
- Auth or permission failures degrade source sync and pause refresh without deleting active knowledge
- Conflict handling uses source priority plus conflict warnings and blocks publish only for unresolved high-risk conflicts
- Ingestion scans extracted records for PII, credentials, payment, health, legal, and internal-only signals; credentials/secrets cannot be activated into runtime knowledge
- Approval authority uses existing tenant/workspace roles assigned in Settings and audits actor, role, workspace, reason, before/after state, and timestamp
- Tests cover daily scheduling, manual refresh, update drafts, deletion drafts, degraded auth state, conflict blocking, sensitivity labels, admin approval requirements, and active-call snapshot stability

TDD notes:
- Start with failing tests for manual/daily sync state transitions and update draft creation.
- Add conflict/sensitivity tests before enabling runtime retrieval from synced records.
- Keep role-authorization tests aligned with existing Settings roles.

Edge cases:
- Provider deletion is different from credential revocation or permission failure.
- Obvious secrets, API keys, and passwords must never become runtime knowledge.
- Conflict warnings should not block low-risk FAQ updates unless a high-risk rule applies.

### ISSUE-162: Salesforce connector v1 for support and sales follow-up

- Priority: P1
- Area: Integrations
- Milestone: Integration Registry and Knowledge Expansion
- Labels: integrations, crm, runtime, backend, frontend, testing, tdd-required
- Status: Pending
- Blocked by: ISSUE-158, ISSUE-159
- Handover: [docs/Handovers/ISSUE-162-salesforce-connector-v1-for-support-and-sales-follow-up.md](../docs/Handovers/ISSUE-162-salesforce-connector-v1-for-support-and-sales-follow-up.md)
- External: [Linear ZAR-116](https://linear.app/zara-voice/issue/ZAR-116/issue-162-salesforce-connector-v1-for-support-and-sales-follow-up)

Acceptance criteria:
- Salesforce appears in the provider catalog with connection, agent tool, and post-call sync capabilities plus required scopes and docs references
- Tenant admins can connect Salesforce through the existing integrations setup flow with organization or workspace scope
- Workflow builder can grant/select Salesforce lookup tools and additive write tools with approval-required posture by default
- Runtime execution supports account/contact/case lookup, create task, create case, and add call note through curated Zara tool schemas
- Pipeline stage mutation, owner changes, destructive updates, deletes, and broad object mutation are not exposed in v1
- Contract tests assert documented Salesforce request shapes, scope validation, error mapping, idempotency behavior for writes, tenant/workspace isolation, and secret redaction
- Post-call sync can write an approved Salesforce task/note without duplicating side effects

TDD notes:
- Start with mocked Salesforce contract tests for the first lookup and additive write tool.
- Add grant/scope tests before exposing Salesforce tools in the builder.
- Keep write tools approval-required by default.

Edge cases:
- Salesforce org/object permissions may allow lookup but deny task/case creation.
- Additive writes may time out after provider receipt and must use unknown side-effect status.
- No pipeline, owner, destructive, or delete operations should leak into the catalog.

### ISSUE-163: Slack connector v1 for bounded escalation and summaries

- Priority: P1
- Area: Integrations
- Milestone: Integration Registry and Knowledge Expansion
- Labels: integrations, runtime, monitoring, backend, frontend, testing, tdd-required
- Status: Pending
- Blocked by: ISSUE-158, ISSUE-159
- Handover: [docs/Handovers/ISSUE-163-slack-connector-v1-for-bounded-escalation-and-summaries.md](../docs/Handovers/ISSUE-163-slack-connector-v1-for-bounded-escalation-and-summaries.md)
- External: [Linear ZAR-117](https://linear.app/zara-voice/issue/ZAR-117/issue-163-slack-connector-v1-for-bounded-escalation-and-summaries)

Acceptance criteria:
- Slack appears in the provider catalog with connection, post-call sync, and bounded agent-notification capabilities plus required scopes and docs references
- Tenant admins can connect Slack and select allowed channels/user groups during setup with organization or workspace scope
- Workflows can use Slack escalation and summary-post tools only for configured destinations
- Runtime and post-call sync use bounded templates for escalation, failed-call/provider-health alerts, and call summaries
- Arbitrary agent-generated messages, arbitrary DMs, and channel history reads are not available in v1
- Contract tests assert Slack request shapes, destination scoping, scope validation, provider error mapping, rate-limit handling, idempotency/side-effect ledger behavior, and secret redaction
- Tenant UI shows Slack sync failures and destination misconfiguration without dropping summaries silently

TDD notes:
- Start with destination-scoped Slack post contract tests.
- Add runtime/post-call sync tests for template-bounded messages before adding UI affordances.
- Keep arbitrary message and channel-history reads absent from the catalog.

Edge cases:
- A Slack workspace can be connected but no destination selected.
- Summary posts must not duplicate when post-call sync retries.
- Rate limits should surface visibly instead of silently dropping notifications.

### ISSUE-164: Microsoft 365 Outlook Calendar connector v1

- Priority: P1
- Area: Integrations
- Milestone: Integration Registry and Knowledge Expansion
- Labels: integrations, scheduling, backend, frontend, testing, tdd-required
- Status: Pending
- Blocked by: ISSUE-158, ISSUE-159
- Handover: [docs/Handovers/ISSUE-164-microsoft-365-outlook-calendar-connector-v1.md](../docs/Handovers/ISSUE-164-microsoft-365-outlook-calendar-connector-v1.md)
- External: [Linear ZAR-118](https://linear.app/zara-voice/issue/ZAR-118/issue-164-microsoft-365-outlook-calendar-connector-v1)

Acceptance criteria:
- Microsoft 365 appears in the provider catalog with Outlook calendar read/create capabilities, required scopes, and docs references
- Tenant admins can connect Microsoft 365 with organization or workspace scope and see required calendar scopes before OAuth
- Workflow tools support availability lookup and event creation through curated Zara input/output schemas
- Event creation is approval-aware and uses side-effect ledger/idempotency behavior where possible
- Email send/read, mailbox search, Teams notification, and broad Graph scopes are not exposed in v1
- Contract tests assert Microsoft Graph request shapes, scope validation, calendar timezone handling, provider error mapping, rate-limit behavior, tenant/workspace isolation, and secret redaction
- Runtime handles unavailable calendar provider responses with safe fallback and optional human scheduling handoff

TDD notes:
- Start with mocked Graph contract tests for availability read and event create.
- Add timezone and insufficient-scope tests before UI wiring.
- Keep Graph scope exposure minimal.

Edge cases:
- Calendar provider timezone and tenant timezone may differ.
- Event creation is a write side effect and must avoid duplicate events.
- Email and mailbox scopes must not appear in v1 catalog or OAuth requests.

### ISSUE-165: Intercom connector v1 with Articles knowledge ingestion

- Priority: P1
- Area: Integrations
- Milestone: Integration Registry and Knowledge Expansion
- Labels: integrations, memory, support, backend, frontend, testing, tdd-required
- Status: Pending
- Blocked by: ISSUE-159, ISSUE-161
- Handover: [docs/Handovers/ISSUE-165-intercom-connector-v1-with-articles-knowledge-ingestion.md](../docs/Handovers/ISSUE-165-intercom-connector-v1-with-articles-knowledge-ingestion.md)
- External: [Linear ZAR-119](https://linear.app/zara-voice/issue/ZAR-119/issue-165-intercom-connector-v1-with-articles-knowledge-ingestion)

Acceptance criteria:
- Intercom appears in the provider catalog with connection, agent tool, post-call sync, and knowledge-source capabilities plus required scopes and docs references
- Tenant admins can connect Intercom with organization or workspace scope and configure selected Articles sources for snapshot or daily sync
- Workflow tools support user, company, and open-conversation lookup through curated Zara schemas
- Runtime/post-call sync supports internal note or call-summary creation with approval posture and side-effect ledger behavior
- Articles ingestion produces review-gated extracted records and obeys workspace/workflow scope, conflict, sensitivity, and deletion-draft rules
- External replies, conversation closing, assignment changes, and user/company field mutation are not exposed in v1
- Contract and ingestion tests cover Intercom request shapes, scope validation, Articles sync, internal note idempotency, provider errors, secret redaction, and no live provider knowledge search during calls

TDD notes:
- Start with Intercom lookup and Articles ingestion contract tests.
- Add no-external-reply catalog tests before exposing Intercom in the UI.
- Keep Articles ingestion routed through the review-gated knowledge pipeline.

Edge cases:
- Intercom app permissions may allow lookup but not Articles access or internal-note creation.
- Deleted/unpublished Articles must create review drafts instead of deleting active records.
- External customer replies must not be exposed as v1 tools.

### ISSUE-166: Shopify connector v1 for read-only commerce support

- Priority: P2
- Area: Integrations
- Milestone: Integration Registry and Knowledge Expansion
- Labels: integrations, ecommerce, backend, frontend, testing, tdd-required
- Status: Pending
- Blocked by: ISSUE-158, ISSUE-159
- Handover: [docs/Handovers/ISSUE-166-shopify-connector-v1-for-read-only-commerce-support.md](../docs/Handovers/ISSUE-166-shopify-connector-v1-for-read-only-commerce-support.md)
- External: [Linear ZAR-120](https://linear.app/zara-voice/issue/ZAR-120/issue-166-shopify-connector-v1-for-read-only-commerce-support)

Acceptance criteria:
- Shopify appears in the provider catalog with connection and read-only agent tool capabilities plus required scopes and docs references
- Tenant admins can connect Shopify with organization or workspace scope and grant lookup tools to selected workflows
- Runtime tools support customer lookup by phone/email and order/fulfillment/shipping-status lookup by safe identifiers
- No Shopify write or mutation tools are exposed in v1
- Lookup failures classify not found, permission denied, rate limited, provider unavailable, timeout, and validation errors with safe caller fallback
- Contract tests assert Shopify request shapes, scope validation, output normalization, provider error mapping, rate-limit behavior, tenant/workspace isolation, and secret redaction
- Workflow/publish validation blocks Shopify tool nodes bound to revoked or insufficiently scoped connections

TDD notes:
- Start with mocked Shopify read-only lookup contract tests.
- Add catalog absence tests for refunds, cancellations, address edits, draft orders, discount changes, and inventory changes.
- Keep runtime fallback tests focused on caller-facing order support.

Edge cases:
- Caller may provide an order identifier that belongs to another customer.
- Shopify store access may be workspace-owned for agencies or regional storefronts.
- Provider rate limits should not cause the agent to invent order status.

### ISSUE-167: Stripe connector v1 for read-only billing lookup

- Priority: P2
- Area: Integrations
- Milestone: Integration Registry and Knowledge Expansion
- Labels: integrations, billing, backend, frontend, security, testing, tdd-required
- Status: Pending
- Blocked by: ISSUE-158, ISSUE-159
- Handover: [docs/Handovers/ISSUE-167-stripe-connector-v1-for-read-only-billing-lookup.md](../docs/Handovers/ISSUE-167-stripe-connector-v1-for-read-only-billing-lookup.md)
- External: [Linear ZAR-121](https://linear.app/zara-voice/issue/ZAR-121/issue-167-stripe-connector-v1-for-read-only-billing-lookup)

Acceptance criteria:
- Stripe appears in the provider catalog with connection and read-only agent tool capabilities plus required scopes and docs references
- Tenant admins can connect Stripe with organization or workspace scope and grant lookup tools to selected workflows
- Runtime tools support customer, subscription, invoice, and payment-status lookup through curated Zara schemas
- Refunds, cancellations, payment-method changes, invoice creation, coupon changes, payment retries, and other write actions are not exposed in v1
- Billing/payment lookup failures prefer safe fallback and human escalation for high-risk calls
- Contract tests assert Stripe request shapes, scope validation, output normalization, provider error mapping, rate-limit behavior, tenant/workspace isolation, and secret redaction
- UI and publish validation show read-only risk posture and block revoked or insufficiently scoped connection bindings

TDD notes:
- Start with mocked Stripe read-only lookup contract tests.
- Add catalog absence tests for all payment-modifying actions.
- Keep high-risk billing fallback and escalation tests explicit.

Edge cases:
- A customer lookup may return multiple possible matches.
- Payment/billing facts can be sensitive and should not be over-exposed in UI or logs.
- Stripe write actions remain out of v1 even if the token technically permits them.

### ISSUE-168: Full website crawling knowledge source after registry stabilization

- Priority: P2
- Area: Memory
- Milestone: Integration Registry and Knowledge Expansion
- Labels: memory, integrations, backend, frontend, testing, tdd-required
- Status: Pending
- Blocked by: ISSUE-161
- Handover: [docs/Handovers/ISSUE-168-full-website-crawling-knowledge-source-after-registry-stabilization.md](../docs/Handovers/ISSUE-168-full-website-crawling-knowledge-source-after-registry-stabilization.md)
- External: [Linear ZAR-122](https://linear.app/zara-voice/issue/ZAR-122/issue-168-full-website-crawling-knowledge-source-after-registry)

Acceptance criteria:
- Tenant admins can configure an allowed website root, crawl limits, exclude paths, and workspace/workflow scope
- Crawler fetches allowed pages, normalizes readable content, deduplicates pages, and stores source snapshots with source URLs
- Crawled content produces extracted record-level drafts that obey taxonomy, conflict, sensitivity, and review rules
- Daily/manual recurring sync detects added, changed, and removed pages as review-gated diffs
- Robots, redirects, canonical URLs, auth-required pages, large pages, binary files, and crawl failures are handled with visible per-source status
- Runtime retrieval uses only approved indexed records and never performs live website search during calls
- Tests cover crawl limits, path allow/deny rules, dedupe, failed pages, deletion drafts, sensitivity labels, tenant isolation, and no activation before approval

TDD notes:
- Start with crawler boundary tests for allow/deny paths and crawl limits.
- Add source snapshot/diff tests before adding UI controls.
- Keep no-live-search runtime tests in place.

Edge cases:
- Crawlers can accidentally leave the intended site or collect irrelevant binary content.
- Robots/auth failures need visible status rather than silent missing knowledge.
- Full crawling should not appear in source pickers until end-to-end ingestion works.

### ISSUE-169: Confluence and SharePoint knowledge-source connectors

- Priority: P2
- Area: Memory
- Milestone: Integration Registry and Knowledge Expansion
- Labels: memory, integrations, backend, frontend, testing, tdd-required
- Status: Pending
- Blocked by: ISSUE-161, ISSUE-164
- Handover: [docs/Handovers/ISSUE-169-confluence-and-sharepoint-knowledge-source-connectors.md](../docs/Handovers/ISSUE-169-confluence-and-sharepoint-knowledge-source-connectors.md)
- External: [Linear ZAR-123](https://linear.app/zara-voice/issue/ZAR-123/issue-169-confluence-and-sharepoint-knowledge-source-connectors)

Acceptance criteria:
- Confluence and SharePoint appear in the provider catalog with knowledge-source capability, required scopes, docs references, and safe setup schemas
- Tenant admins can connect each provider with organization or workspace scope and select spaces/sites/pages/folders for snapshot or daily sync
- Sync produces extracted record-level drafts that obey taxonomy, source priority, conflict, sensitivity, and approval rules
- Permission/auth failures degrade sync and do not delete active approved snapshots
- Confirmed deleted/unpublished provider content creates deletion/stale review drafts
- Runtime retrieval uses only approved indexed records and does not perform live Confluence or SharePoint search during calls
- Contract and ingestion tests cover provider request shapes, scope validation, pagination, permission errors, deleted content, tenant/workspace isolation, secret redaction, and no activation before approval

TDD notes:
- Start with provider contract tests for one Confluence source and one SharePoint source.
- Add pagination and permission failure tests before UI source selection.
- Keep SharePoint scopes separate from Microsoft 365 Outlook calendar v1 scopes.

Edge cases:
- SharePoint and Confluence permissions can vary by page, folder, site, or space.
- Deleted/unpublished content should not immediately remove active approved records.
- Provider pagination and rate limits must not create partial silent sync success.

### ISSUE-170: Freshdesk Solutions and Salesforce Knowledge connectors

- Priority: P2
- Area: Memory
- Milestone: Integration Registry and Knowledge Expansion
- Labels: memory, integrations, crm, backend, frontend, testing, tdd-required
- Status: Pending
- Blocked by: ISSUE-161, ISSUE-162
- Handover: [docs/Handovers/ISSUE-170-freshdesk-solutions-and-salesforce-knowledge-connectors.md](../docs/Handovers/ISSUE-170-freshdesk-solutions-and-salesforce-knowledge-connectors.md)
- External: [Linear ZAR-124](https://linear.app/zara-voice/issue/ZAR-124/issue-170-freshdesk-solutions-and-salesforce-knowledge-connectors)

Acceptance criteria:
- Freshdesk and Salesforce Knowledge appear in the provider catalog with knowledge-source capability, required scopes, docs references, and safe setup schemas
- Tenant admins can select article/category sets for snapshot or daily sync with workspace/workflow scope
- Sync produces extracted records that obey taxonomy, source priority, conflict, sensitivity, approval, deletion-draft, and degraded-auth rules
- Existing approved snapshots remain active until operator approval when source articles are removed or permissions change
- Runtime retrieval uses only approved indexed records and does not perform live provider knowledge search during calls
- Contract and ingestion tests cover provider request shapes, pagination, scope validation, deleted/unpublished articles, auth failures, secret redaction, tenant/workspace isolation, and no activation before approval
- Docs clarify how these CRM help-center connectors differ from agent operational tools

TDD notes:
- Start with Freshdesk and Salesforce Knowledge mocked ingestion contract tests.
- Add source deletion and degraded-auth tests before UI source selection.
- Keep CRM help-center ingestion separate from operational ticket/case tools.

Edge cases:
- Salesforce operational CRM scopes may not imply Salesforce Knowledge access.
- Freshdesk article visibility/status can differ from public availability.
- Help-center connectors must not perform live provider knowledge search during calls.
