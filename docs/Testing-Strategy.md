# Testing Strategy

## Test Layers

- Unit: domain policies, validators, manifest compiler, routing, memory filters, cost estimation.
- Integration: NestJS modules, database, auth, connectors, telephony webhooks, queues.
- Contract: public API routes, runtime event schemas, connector tool schemas.
- Security: tenant isolation, RBAC, secrets, webhook signatures, prompt injection.
- Runtime: STT/model/TTS adapter contracts, event ordering, idempotency, fallback.
- Telephony: BYO Twilio, BYO SIP, platform routing, DTMF, voicemail, failover.
- Evals: packet fixture scorecards, LangSmith/Vitest runtime evals, deterministic evaluators, and LLM-as-judge evaluators for qualitative agent behavior.
- UI: light smoke tests for builder, sandbox, monitor, memory management.
- Platform admin UI: light smoke tests for login gate, dashboard load, AI runtime observability, runtime eval status, and impersonation banner.

## Required For Completion

Each issue must include tests appropriate to its layer. If tests are deferred, the handover must explain why and record the risk.

## Architecture Deepening Tests

When an architecture-deepening pass extracts a module, the first regression target is the new module interface. Keep the feature-level contract tests as confirmation that the public behavior stayed stable.

- Live sandbox routing changes should cover the route resolver directly for condition traversal, handoff events, agent toolbelt availability, terminal exits, and stale frontier fallback, then rerun the live-session HTTP and websocket contract tests.
- Workflow builder changes should cover `workflowBuilderWorkbench.ts` for selected-node affordances, route-target eligibility, connection decisions, companion edges, and handle-role mapping before rerunning the light builder screen tests.
- Tenant JSON persistence changes should cover `tenant-json-state.repository.ts` for listing, validated load, atomic save, corrupt quarantine, encoded filenames, and newline options, then rerun the billing, integrations, memory, or telephony persistence tests that consume the adapter.
- Runtime orchestration standardization should cover the turn runtime packet reducer/projection, intent classifier output validation, discretionary tool-call validation, structured transfer context creation, and packet-backed event emission before rerunning live-session HTTP/websocket contract tests. ISSUE-133 covers packet creation, reducer events, safe model projection, packet size bounding, warning diagnostics, route packet facts, and live websocket packet metadata. ISSUE-134 adds core classifier guard tests, live-router classifier/fallback tests, Gemini adapter tests, runtime-manifest preservation tests, and builder inspector coverage for intent descriptions/examples and classifier settings. ISSUE-135 adds compiler/router tests for assigned-but-unused tools, prompt/action parser tests for `respond` and `call_tool`, and live-session tests for successful, skipped, approval-required, and zero-tool-call turns. ISSUE-136 adds route and websocket tests for handoff/direct transfer context, source/target transfer events, and target-agent model projection. ISSUE-137 hardens the documented policy table, including transfer-loop prevention, explicit empty-toolbelt regression coverage for agents with no assigned tools, unsupported structured agent-command rejection, transfer language mismatch, tool timeout/rate-limit classification, partial tool success projection, tenant-scoped redacted replay, untrusted prompt lanes, interruption handling, and context bloat compaction.
- Runtime observability and evals should cover OpenTelemetry span creation, redacted LangSmith export payloads, exporter failure isolation, packet fixture dataset loading, deterministic scorecards, LLM-as-judge evaluator logging, separate CI eval gating, platform-admin AI health aggregation, and staff-only redacted failing-run links.
- PSTN live call runtime should cover provider-neutral live session lifecycle, synthetic G.711 mu-law 8 kHz media fixtures, Twilio Media Streams message contracts, protected `test_route` caller gating, successful phone-test checklist persistence, live activation hard blocks, subscription/budget mid-call behavior, PSTN redaction, and latency threshold classification before any real Twilio test is considered sufficient. ISSUE-142 adds the first provider-neutral core coverage for browser/PSTN source starts, lifecycle ordering, packet creation, coordinator rehydrate, scope isolation, and terminal transition guards.

## Eval Tests

Runtime evals run through `npm run eval:runtime`, a separate Vitest config, `.eval.ts` files, `langsmith/vitest`, and `langsmith/vitest/reporter` when LangSmith tracking is enabled. Regular unit, integration, contract, and security test commands must pass without LangSmith credentials.

Deterministic evals must cover exact routing and policy outcomes. LLM-as-judge evals through `openevals` are reserved for qualitative behavior such as transfer-context acknowledgement, safe tool-output summarization, missing-input questions, and role/policy adherence.

Protected prompt, model, routing, tool, transfer, and policy changes run `npm run eval:runtime` as a separate gate. Deterministic suites require a 100% pass rate. LLM-as-judge suites require a minimum score of 0.8 and fall back to manual release-owner review when qualitative scores are below threshold. LangSmith outages can be overridden only when local deterministic evals pass and the exception is recorded.

## Auth And Admin Tests

- Tenant users cannot access platform-admin APIs.
- Tenant admins are not platform admins.
- Tenant users cannot access platform-admin AI runtime observability or internal LangSmith/eval metadata.
- Platform readonly users cannot mutate tenant status, impersonate, or change plans.
- Platform admin actions create audit records.
- Both Vite apps can establish Better Auth sessions against the NestJS API with trusted origins configured.

## Tenant Isolation Regression Tests

Automated controller tests now cover cross-tenant ID guessing across live call sessions, memory, integrations, and telephony. These tests assert that another tenant cannot read or mutate session events, quality reports, CRM sync state, memory drafts, knowledge ingestion jobs, connector state, webhook tools, tool grants, telephony numbers, or call-control records by guessing IDs.
