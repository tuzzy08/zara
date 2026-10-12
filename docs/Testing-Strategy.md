# Testing Strategy

## E2E-First Policy

The 2026-10-12 rules in `AGENTS.md` supersede the earlier unit-first guidance. Highly prefer E2E tests as the sole testing mechanism for new work. Exercise a representative medium-to-hard scenario across real application boundaries, including relevant failure, recovery, authorization, or state transitions. Do not choose only the simplest happy path.

Never write unit tests after production code. Before an isolated test is necessary, list all identified failure modes and why E2E cannot cover them reliably, then write a failing behavior test before implementation. Do not write tautological tests or tests that merely detect source, styling, private-call, or implementation-shape changes. A bug fix needs a new regression test only when existing behavior tests have a genuine gap.

Every E2E run must produce repeatable evidence: revision, exact command, environment and fixture setup, assertions, outcomes, and an inspectable trace or report. Use synthetic data and redact credentials and personal data. Screenshots alone are not behavior proof.

Current commands below describe existing coverage, not a requirement to add tests at every layer. The Playwright runner in `tests/e2e/` covers signup and workspace tenant isolation against disposable real services. Its scope is not equivalent to the full existing behavior suite. Mocked DOM smoke tests and isolated service tests must not be called E2E. Keep genuine behavior checks until equivalent E2E coverage exists. Record deletion reasons and concrete retained coverage; do not remove tests merely to lower the count.

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

## Ordinary Test Commands

- `npm run test:e2e`: build production targets, migrate a fresh PostgreSQL database, run Chromium signup and tenant-isolation journeys over local HTTPS, save reports/traces and remove the isolated stack. See [E2E setup](../tests/e2e/README.md).
- `npm run test:unit`: domain/package tests plus non-component tenant and platform-admin client logic.
- `npm run test:api`: Nest API and PSTN protocol simulator tests, including integration, contract, runtime, telephony, security, and tenant-isolation coverage.
- `npm run test:ui-smoke`: tenant and platform-admin React component smoke tests.
- `npm run test:boundaries`: enforce the approved DOM smoke-file allowlist and 15-25 declared-test range.
- `npm run test:run`: aggregate compatibility command for every ordinary test.
- `npm run test:inventory`: tracked ordinary test file, declared-test, and line counts by layer.

Choose the highest real application boundary that can verify the behavior, with E2E as the default. Existing isolated domain/client and API tests remain when they catch failures absent from E2E coverage. Per-file Vitest environment directives may opt a browser-specific unit helper into jsdom; this does not make it an E2E test.

Runtime evals, PSTN evals, and PSTN capacity load tests remain separate from all ordinary commands.

## Public Seams And UI-Smoke Boundary

- Add isolated domain/client checks only for documented E2E coverage gaps, through exported behavior rather than implementation details.
- Test server authority, persistence, integration, security, tenancy, runtime, and telephony behavior through public service, controller, HTTP, WebSocket, or provider protocol seams in the API layer.
- Use DOM smoke tests only for critical journeys whose accessible behavior cannot be protected below React rendering. Assert roles, accessible names, user input, navigation, and durable state transitions.
- Do not assert decorative classes, CSS selectors, literal colors, layout geometry, marketing copy, documentation prose, source text, Dockerfile text, Compose text, or private collaborator calls.
- `config/ui-smoke-allowlist.json` is the reviewed list of permitted tenant and platform-admin DOM suites. Adding a `.test.tsx` file requires an intentional allowlist change and must keep the declared DOM total within 15-25 tests.
- The guardrail intentionally does not impose blanket presentation-code coverage. Prefer E2E journeys; use isolated client, API, contract, security, or tenant-isolation checks only where a documented behavior gap remains.

## Executable Repository Contracts

Configuration, deployment, documentation, and architectural boundaries must be validated by executable commands rather than tests that search source files for expected phrases.

- `npm run validate:contracts` parses platform-admin environment and Vercel security-header configuration, checks tracked local Markdown links, enforces the live-call persistence boundary through the TypeScript AST, validates the resolved Coolify Compose service model, and builds every production workspace.
- CI additionally runs `docker build --check .` and constructs the `api`, `realtime-worker`, `web`, and `platform-admin` targets so Dockerfile semantics and every production image are validated by the container toolchain.
- Ordinary tests must not assert CSS selectors, decorative classes, literal colors, marketing copy, documentation prose, workflow YAML text, Dockerfile text, or Compose text.
- Accessible names and critical interactions may remain UI-smoke contracts when they are the public user interface.
- Provider branding tests may verify accessible labels and catalog tokens, but not CSS class strings.

## Architecture Deepening Tests

When a pass extracts a module, first run the existing feature-level behavior tests. Add an isolated module test only for a documented behavior gap after listing failure modes. The coverage examples below describe existing risk areas, not a mandate to duplicate them at each layer.

- Existing live sandbox coverage includes route traversal, handoff events, tool availability, terminal exits, stale frontier fallback, and HTTP/WebSocket contracts. For changes, start with the feature-level flow; extend isolated resolver coverage only for a documented gap.
- Existing workflow builder coverage includes selected-node actions, route eligibility, connection decisions, companion edges, and handle roles. Start with the workflow creation/publish journey; extend isolated workbench coverage only for a documented gap.
- Existing tenant JSON persistence coverage includes listing, validated load, atomic save, corrupt quarantine, encoded filenames, and newline options. Start with the consuming feature's persistence flow; extend isolated repository coverage only for a documented gap.
- Runtime orchestration standardization should cover the turn runtime packet reducer/projection, intent classifier output validation, discretionary tool-call validation, structured transfer context creation, and packet-backed event emission before rerunning live-session HTTP/websocket contract tests. ISSUE-133 covers packet creation, reducer events, safe model projection, packet size bounding, warning diagnostics, route packet facts, and live websocket packet metadata. ISSUE-134 adds core classifier guard tests, live-router classifier/fallback tests, Gemini adapter tests, runtime-manifest preservation tests, and builder inspector coverage for intent descriptions/examples and classifier settings. ISSUE-135 adds compiler/router tests for assigned-but-unused tools, prompt/action parser tests for `respond` and `call_tool`, and live-session tests for successful, skipped, approval-required, and zero-tool-call turns. ISSUE-136 adds route and websocket tests for handoff/direct transfer context, source/target transfer events, and target-agent model projection. ISSUE-137 hardens the documented policy table, including transfer-loop prevention, explicit empty-toolbelt regression coverage for agents with no assigned tools, unsupported structured agent-command rejection, transfer language mismatch, tool timeout/rate-limit classification, partial tool success projection, tenant-scoped redacted replay, untrusted prompt lanes, interruption handling, and context bloat compaction.
- Runtime observability and evals should cover OpenTelemetry span creation, OTel/LangSmith config separation, redacted LangSmith export payloads, exporter failure isolation, provider latency aggregation, packet fixture dataset loading, deterministic scorecards, LLM-as-judge evaluator logging, separate CI eval gating, platform-admin AI health aggregation, and staff-only redacted failing-run links.
- PSTN live call runtime should cover provider-neutral live session lifecycle, synthetic G.711 mu-law 8 kHz media fixtures, Twilio Media Streams message contracts, protected `test_route` caller gating, successful phone-test checklist persistence, live activation hard blocks, subscription/budget mid-call behavior, PSTN redaction, and latency threshold classification before any real Twilio test is considered sufficient. ISSUE-142 adds the first provider-neutral core coverage for browser/PSTN source starts, lifecycle ordering, packet creation, coordinator rehydrate, scope isolation, and terminal transition guards. ISSUE-143 adds synthetic PSTN sandwich coverage for clean mu-law turns, noisy/partial frames, PSTN-ready STT/TTS metadata, TTS fallback, model timeout safe closeout, no-frame timeout, and barge-in/clear events. ISSUE-144 adds Twilio message contract tests for `connected`, `start`, `media`, `dtmf`, `mark`, and `stop`; outbound `media`, `mark`, and `clear`; unsupported codecs; invalid payloads; replayed sequences; post-stop messages; verified webhook TwiML; and a local WebSocket harness for inbound media, outbound audio, barge-in clear, DTMF, stop, duplicate attachment, malformed media, and no raw-media persistence. ISSUE-145 adds route-state, route-mode dispatch, caller gating, expiry, duplicate waiting-session, tenant isolation, sanitized phone-test result, repository, schema, and migration coverage for protected PSTN tests. ISSUE-148 adds PSTN OpenTelemetry/LangSmith redaction coverage, platform-admin call-quality signals, `npm run eval:pstn`, and deterministic `zara.pstn-media.v1` eval coverage for successful phone-test checklist and latency classification. ISSUE-149 adds premium realtime PSTN coverage for blocked-by-default call-start gates, approved premium provider routing, provider unavailable, entitlement denial, provider-native interruption normalization, provider failure blocked-fallback behavior, redacted trace export, and a separate premium runtime-path eval fixture.

## Eval Tests

Runtime evals run through `npm run eval:runtime`, a separate Vitest config, `.eval.ts` files, `langsmith/vitest`, and `langsmith/vitest/reporter` when LangSmith tracking is enabled. Regular unit, integration, contract, and security test commands must pass without LangSmith credentials.

The deterministic runtime executor receives fixture inputs only. It executes production adapters and guards with scripted provider responses. Expected answers stay in the scorer. Live prompt checks use the separate `npm run eval:prompts` command and synthetic data. They require provider credentials and cover assigned tools, missing inputs, instruction injection, tool failure, history, and language policy. See `docs/Observability-And-Evals-Standard.md` for model selection and evidence limits.

PSTN media evals run through `npm run eval:pstn`, a separate Vitest config, `.pstn.eval.ts` files, `langsmith/vitest`, and `langsmith/vitest/reporter` when LangSmith tracking is enabled. They use synthetic Twilio media harness scenarios and must remain separate from ordinary tests and non-PSTN runtime evals.

PSTN capacity load runs are a third, separate layer. `npm run load:pstn:ci` exercises a bounded deterministic smoke, while `npm run load:pstn:release -- <stepped|burst|failure|soak>` requires explicit operator approval and an external load-generator host. Release load must fail on missing capacity telemetry, absent scenario traffic, call-identity leakage, resource exhaustion, hard SLO breach, or failure to drain calls, sockets, reservations, queues, and memory. A local workstation run is not release capacity evidence.

Deterministic evals must cover exact routing and policy outcomes. LLM-as-judge evals through `openevals` are reserved for qualitative behavior such as transfer-context acknowledgement, safe tool-output summarization, missing-input questions, and role/policy adherence.

Protected prompt, model, routing, tool, transfer, and policy changes run `npm run eval:runtime` as a separate gate. Deterministic suites require a 100% pass rate. LLM-as-judge suites require a minimum score of 0.8 and fall back to manual release-owner review when qualitative scores are below threshold. LangSmith outages can be overridden only when local deterministic evals pass and the exception is recorded.

Telephony, Twilio bridge, PSTN sandwich, premium PSTN realtime, latency, call-quality, and production activation changes run `npm run eval:pstn` as a separate gate. Deterministic PSTN media suites require a 100% pass rate. Provider outages can be overridden only when local deterministic PSTN evals pass, the outage is recorded, and the release owner signs off.

## Provider Benchmark Tests

Provider benchmark harness changes should cover fake-provider execution, missing-credential skips, normalized errors, redacted artifact output, percentile summaries, and PSTN transcode/non-mu-law warnings before any live provider run is trusted. Live benchmark commands are `npm run bench:tts`, `npm run bench:realtime`, and `npm run bench:providers`; they are not substitutes for unit tests or runtime eval gates.

## Auth And Admin Tests

- Tenant users cannot access platform-admin APIs.
- Tenant admins are not platform admins.
- Tenant users cannot access platform-admin AI runtime observability or internal LangSmith/eval metadata.
- Platform readonly users cannot mutate tenant status, impersonate, or change plans.
- Platform admin actions create audit records.
- Both Vite apps can establish Better Auth sessions against the NestJS API with trusted origins configured.

## Tenant Isolation Regression Tests

Automated controller tests now cover cross-tenant ID guessing across live call sessions, memory, integrations, and telephony. These tests assert that another tenant cannot read or mutate session events, quality reports, CRM sync state, memory drafts, knowledge ingestion jobs, connector state, webhook tools, tool grants, telephony numbers, or call-control records by guessing IDs.
