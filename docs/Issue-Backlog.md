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
- Telephony hardening gate: ISSUE-107 and ISSUE-038. Implemented baseline: durable telephony state and encrypted provider-secret envelopes before broader provider expansion.
- Telephony MVP: ISSUE-026 through ISSUE-038. Implemented baseline: telephony connection model, platform-managed connection, BYO SIP, BYO Twilio, Twilio number routing, webhooks, inbound/outbound dispatch, recording policy, failover handling, and provider health checks.
- Integrations and tools: ISSUE-039 through ISSUE-046. Implemented baseline: OAuth connection framework, encrypted credentials, Zendesk, HubSpot, Google Workspace, Notion, webhook HTTP tools, connector health/revocation, and tool permission grants.
- Memory and knowledge: ISSUE-047 through ISSUE-054. Implemented baseline: session memory, caller/account memory, tenant knowledge, pgvector retrieval, extraction, approval, edit/delete APIs, ingestion, and privacy/retention enforcement.
- Monitoring and escalation: ISSUE-055 through ISSUE-063. Implemented baseline: live monitor, transcript/event timeline, cost telemetry, escalation queue, human takeover callback fallback, post-call summary, CRM sync status, quality flags, and tenant isolation tests.
- Security, compliance, billing, and production: ISSUE-064 through ISSUE-082. Implemented baseline: tenant isolation and audit, consent, retention, secrets rotation, prompt-injection defense, abuse controls, DNC/timezone controls, redaction, compliance readiness, usage and cost metering, tenant budgets, deployment plans, observability, backup/DR, provider fallback, and final production readiness gates.
- Platform admin: ISSUE-084 through ISSUE-097. Implemented baseline: staff roles, admin app, admin auth gate, dashboard, tenant/user support, telephony/integration/runtime/billing operations, audit, impersonation, abuse review, and deployment config.
- Workspace product layer: ISSUE-099 through ISSUE-102. Implemented baseline: workspace domain model, workspace switcher/creation, workspace-scoped workflows and sandbox runs, and workspace settings/access management.
- Workflow builder enhancements: ISSUE-116 and ISSUE-117. Implemented baseline: reusable workspace-scoped specialist templates, agent/handoff template selection, snapshot-safe published versions, multi-language role controls, language validation, and runtime-facing language prompt metadata.
- Tenant app pages and payments: ISSUE-118 through ISSUE-121. Implemented baseline: tenant integrations, memory, and billing pages plus Polar checkout, customer portal, webhook, subscription/customer-state, invoice/order, entitlement, and usage-event billing APIs.
- Workflow builder relationship rules: ISSUE-122 and ISSUE-123 are implemented. Current baseline: canonical node relationship policy, shared validation, builder add/connect/reconnect/target controls, policy-aware toolbar affordances, and repair UX all consume the same source, target, edge-kind, and handle-role rules.
- Live sandbox architecture deepening: ISSUE-124 is implemented. Live sandbox turn routing now sits behind a focused module interface while preserving the public live-session API contract.
- Workflow builder architecture deepening: ISSUE-125 is implemented. Workbench relationship decisions, selected-node action state, route-target eligibility, and handle mapping now sit behind a focused module interface while preserving visual builder behavior.
- Tenant JSON state architecture deepening: ISSUE-126 is implemented. Billing, integrations, memory, and telephony file repositories now share tenant-scoped JSON persistence mechanics while preserving feature-specific validation.
- Agent model provider selection: ISSUE-127 is implemented. Agent role nodes now preserve text model provider/model ID through publish, route live sandbox text turns to OpenAI or Google Gemini, and expose provider/model metadata in sandbox routing events.
- Marketing landing and dedicated auth: ISSUE-130 is implemented. Signed-out visitors now see a voice-agent agency landing page at `/`, while sign-in and sign-up live on dedicated auth routes.
- Tenant auth reactivation: ISSUE-131 is implemented. Tenant email sign-in restores an active Better Auth organization for existing members before app navigation, mirrors Better Auth organizations into the product `tenants` table, treats Better Auth refetch windows as loading instead of missing tenancy, and signup rejects blank tenant organization names before account creation.
- Runtime-aware builder inspector controls: ISSUE-132 is implemented. Builder startup, workflow naming, runtime-specific model controls, language selection, and intent fallback-to-caller handling now match runtime expectations.
- Runtime orchestration standardization: ISSUE-133 through ISSUE-135 are implemented; ISSUE-136 and ISSUE-137 are pending. Current baseline: turn runtime packet v1 exists in shared core, live sandbox routing emits packet-backed turn metadata, intent routes use a guarded Gemini classifier that writes `IntentRouteResult`, and assigned tools compile/run as discretionary agent toolbelt capabilities with structured packet results. Remaining target: structured transfer context and policy guard coverage across runtime, builder, sandbox, and architecture docs.
- Runtime observability and evals: ISSUE-138 through ISSUE-140 are pending. Target baseline: OpenTelemetry runtime spans, redacted LangSmith AI trace export, LangSmith/Vitest packet eval fixtures, and regression scorecards for intent, tools, transfers, policy guards, and end-to-end turns.

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

TDD notes:
- Write the failing test first for each production behavior.
- Verify the RED failure is for the expected missing behavior.
- Implement the smallest GREEN change, then REFACTOR with tests green.
- Keep UI tests light unless the issue is a critical user flow.

Edge cases:
- OAuth callback returns after the page has refreshed
- Connector is revoked while a workflow still references a tool
- Non-admin tenant user opens the page

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
- Publishing lets users edit the workflow name before release, never appends visible version suffixes, validates that a workflow name exists before publish or sandbox run, and asks for confirmation before overwriting an existing workflow with the same name
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
- Status: Pending
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
- Status: Pending
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

### ISSUE-138: Packet-backed OpenTelemetry and LangSmith trace export

- Priority: P0
- Area: Runtime
- Milestone: Monitoring
- Labels: runtime, observability, backend, security, testing, tdd-required
- Status: Pending
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

### ISSUE-139: LangSmith Vitest runtime eval fixture harness

- Priority: P0
- Area: Testing
- Milestone: Runtime
- Labels: runtime, testing, observability, backend, tdd-required
- Status: Pending
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

### ISSUE-140: Runtime eval regression gates and AI observability dashboards

- Priority: P1
- Area: Monitoring
- Milestone: Production
- Labels: runtime, observability, testing, devops, platform-admin, tdd-required
- Status: Pending
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
