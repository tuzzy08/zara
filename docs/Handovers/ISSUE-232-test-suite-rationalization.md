# ISSUE-232: Test suite rationalization and UI smoke-test boundary

External: [Linear ZAR-236](https://linear.app/zara-voice/issue/ZAR-236/spec-test-suite-rationalization-and-ui-smoke-test-boundary)

Status: Implemented (locally verified; authorized push and GitHub CI verification in progress)

## E2E-first cleanup — 2026-10-12

- Reopened this matching issue because Linear rejected a new issue at the workspace's free issue limit. The original implementation notes below remain historical evidence.
- User requested parallel removal of low-signal unit tests and E2E-first agent rules. Three agents own package, API/simulator, and frontend test audits. No production code or production data is changed. Signup performance and account-validation work is paused.
- Added the requested test-first, E2E-first, medium-to-hard scenario, repeatable-artifact, failure-mode, no-tautology, no-change-detector, and genuine-regression-gap rules to `AGENTS.md`. Aligned current TDD and testing guidance. Preserved the user's prior removal of the old TDD block.
- Audit reports: [packages](../testing-audit/packages.md), [API](../testing-audit/api.md), [frontend](../testing-audit/frontend.md). These distinguish executable behavior coverage from mocked components and source-text assertions. No checked-in full browser E2E runner was found; unique behavior coverage must remain.
- Cleanup verification complete: 59 declarations removed across 23 deleted files and retained-suite edits; inventory is 304 files, 1,983 declarations, 107,414 lines. Package tests passed 208; frontend tests passed 136 across focused runs with worker-start retries. Full bounded API run passed 1,836 tests, with 69 tests skipped because dedicated PostgreSQL/Redis URLs were absent (234 files passed, 17 skipped; 1,237.83 seconds). TypeScript, modified-test ESLint, test boundaries, inventory, CI file references, and diff checks pass. Skips are not passes.
- User then approved a real Playwright signup and tenant-isolation suite with CI artifacts. Cleanup and that extension are now locally verified. The suite uses an isolated environment, real auth/API/database boundaries, and no production data.
- Risk: local runs without dedicated PostgreSQL/Redis test services cannot prove database or distributed-service behavior. CI migration execution and real-service tests remain; no gate is bypassed.
- Next: user authorized a scoped commit/push and CI fixes. Use branch `codex/test-cleanup-playwright`; leave unrelated work unstaged. Observe all GitHub checks without bypassing failures. No merge or deployment is authorized in this pass. Password confirmation, signup-required email verification, and initial page-load optimization remain separate pending feature work.

## Playwright extension — 2026-10-12

- Added pinned Playwright 1.64.0, Chromium configuration, signup/email verification/sign-in journey, and two-tenant workspace isolation checks (including anonymous access and forged test-auth headers).
- Added an isolated Compose stack with real PostgreSQL migrations, Redis, production API/web images, local HTTPS, and a test email delivery endpoint. No production environment file or provider credentials are loaded; billing delivery is false.
- Added `npm run test:e2e` and `.github/workflows/e2e.yml`. Each run saves traces, HTML/JUnit reports, service logs, image IDs, source hashes and an outcome file; CI retains artifacts for seven days.
- Verification passed: test discovery (two cases), test TypeScript, ESLint, Compose and Caddy validation, JavaScript syntax, diff checks and the existing UI test boundary. Production API/web images build and empty-database migrations pass. Both Chromium journeys passed on two fresh databases: direct qualification 42.9 seconds; final `npm run test:e2e` 20.7 seconds, exit 0 and cleanup exit 0.
- Fixed test-harness defects found during qualification: the gateway needs a separate browser-facing network, IP-based HTTPS needs `default_sni`, and Playwright already starts tracing for custom browser contexts. Startup and test failures returned exit 1; automatic teardown was verified. No app defect or production-code fix was needed.
- Final artifact directory: `artifacts/e2e/zara-e2e-32648-1791832209065/`. It includes `run.json`, `images.json`, `outcome.json`, `junit.xml`, `services.log`, HTML report and both browser traces. The prior qualification trace contains 73 signup requests and 36 isolation requests, no HTTP 5xx responses, and all six expected isolation denials. Test input hashes match the saved run metadata.
- This is new coverage for existing behavior, not a production-code change. No new unit tests were written. Password confirmation and signup-required email verification remain outside this setup.
- Pending external verification: GitHub CI execution after an authorized commit/push. No remote CI, commit, push, deployment, or production change is claimed. Current implementation and local verification are complete.

## Historical implementation: work completed

- Audited the tracked automated test suite and classified frontend DOM, frontend logic, API, integration, contract, runtime, telephony, security, eval, and configuration coverage.
- Recorded an audit baseline of approximately 151 test files, 1,153 tests, and 79,755 test lines, including approximately 234 frontend/admin tests and 149 DOM/component tests.
- Approved the target seams: public domain/runtime interfaces, real Nest module/controller boundaries, and thin application-shell smoke seams for the tenant and platform-admin apps.
- Published the implementation specification as Linear ZAR-236 with the `ready-for-agent` and `Improvement` labels.
- Completed ISSUE-233 through ISSUE-240, including layered commands, UI contraction, executable contracts, backend/runtime suite modularization, the DOM allowlist, and full qualification.
- Final inventory is 216 ordinary files, 1,367 static declarations, and 85,558 lines; UI smoke is 8 files and 23 tests.

## Tests run

- Attempted `npm.cmd run test:run -- --reporter=default`; the repository-wide run exceeded the bounded 59-second audit window and did not produce a complete result.
- No production or test behavior was changed during the audit/specification pass.
- Final qualification passed unit 300/300, UI smoke 23/23, the complete API and aggregate ordinary suites, runtime eval 5/5, PSTN eval 25/25, typecheck, production builds, and repository contracts.

## Pending work

- None.

## Risks

- Unrelated working-tree changes remain preserved and unstaged.

## Decisions

- Retain comprehensive domain, API, integration, contract, runtime, telephony, security, and tenant-isolation coverage.
- Retain frontend tests for client-owned logic, browser audio, transports, manifests, formatting, and state transitions.
- Target 15-25 DOM smoke tests and approximately 95-110 frontend/admin tests overall.
- Keep runtime and PSTN evals separate from ordinary deterministic test commands.
- Do not pursue a blanket presentation-code coverage percentage.

## Next recommended step

- Maintain the documented allowlist and layer-selection rules as the product evolves.
