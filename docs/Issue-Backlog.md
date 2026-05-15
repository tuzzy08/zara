# Issue Backlog

This is the canonical local backlog. GitHub issues should mirror these items. Every item has a matching handover document in docs/Handovers.

## Feature Slices

Issues should be completed in feature slices so each group leaves one capability working end to end.

- Foundation and access base: ISSUE-001 through ISSUE-008, plus ISSUE-083, ISSUE-098, and ISSUE-099.
- Basic workflow builder: ISSUE-009, ISSUE-010, and ISSUE-015. Implemented baseline: React Flow canvas, agent role inspector, deterministic graph serialization, and shared publish-blocking validation.
- Publishable workflow draft: ISSUE-011 through ISSUE-014, ISSUE-016, and ISSUE-017. Implemented baseline: connector-aware tool nodes, specialist handoff nodes, condition routes, exit nodes, escalation lanes, immutable version publishing, and draft runtime manifest preview.
- Sandbox runtime: ISSUE-018 through ISSUE-025.
- Telephony hardening gate: ISSUE-107 and ISSUE-038. This makes telephony state durable and secrets encrypted before broader provider expansion.
- Telephony MVP: ISSUE-026 through ISSUE-038.
- Integrations and tools: ISSUE-039 through ISSUE-046.
- Memory and knowledge: ISSUE-047 through ISSUE-054.
- Monitoring and escalation: ISSUE-055 through ISSUE-063.
- Security, compliance, billing, and production: ISSUE-064 through ISSUE-082.
- Platform admin: ISSUE-084 through ISSUE-097.
- Workspace product layer: ISSUE-099 through ISSUE-102.

### ISSUE-001: Project workspace setup

- Priority: P0
- Area: Setup
- Milestone: Foundation
- Labels: setup, tdd-required
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
- Handover: [docs/Handovers/ISSUE-004-postgres-schema-and-migration-setup.md](../docs/Handovers/ISSUE-004-postgres-schema-and-migration-setup.md)

Acceptance criteria:
- Migration tool is configured
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

### ISSUE-084: Platform role and permission model

- Priority: P0
- Area: Security
- Milestone: Foundation
- Labels: platform-admin, auth, security, tdd-required
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
