# Test Suite Baseline

Baseline captured for ISSUE-233 on 2026-07-30 against the current working tree before test-suite contraction.

## Static tracked inventory

Command: `npm run test:inventory`

The inventory uses `git ls-files`, so it reports tracked ordinary `.test.ts` and `.test.tsx` files. Test counts are static `it()` and `test()` declarations; parameterized runtime cases can produce higher executed counts.

| Layer | Files | Declared tests | Lines |
| --- | ---: | ---: | ---: |
| Unit | 44 | 302 | 16,659 |
| API/integration | 136 | 1,071 | 70,173 |
| UI smoke | 9 | 149 | 10,567 |
| Total ordinary | 189 | 1,522 | 97,399 |

The new ISSUE-233 configuration-contract test was untracked when this pre-change inventory was captured and is intentionally excluded from these baseline counts.

## Executed layer baseline

### Unit

Command: `npm run test:unit -- --reporter=default`

- Result: 45 files passed.
- Runtime-expanded tests: 304 passed.
- Duration: 16.49 seconds.
- The executed count includes the new ISSUE-233 configuration-contract test.

### UI smoke

Command: `npm run test:ui-smoke -- --reporter=default`

- Result: 8 files passed, 1 failed.
- Runtime-expanded tests: 132 passed, 1 failed.
- Duration: 132.35 seconds.
- Existing failure: the signed-out landing-page test expects the edited page to render `Voice strategy`.

### API/integration

Command: `npm run test:api -- --reporter=default`

- Result: 130 files passed, 3 failed, 3 skipped.
- Runtime-expanded tests: 1,093 passed, 12 failed, 41 skipped.
- Duration: 272.21 seconds.
- Existing failure file: production ESM output validation.
- Existing failure file: compliance controller, covering recording notices and retention deletion.
- Existing failure file: sandbox live-session WebSocket coverage, with nine tool-execution and approval/failure-path cases returning unexpected setup results.

## Interpretation

- The layers are disjoint at the file level and together cover every tracked ordinary test.
- Unit feedback is already bounded and green.
- UI smoke is dominated by broad component suites and currently takes more than two minutes.
- API/integration provides the highest-value coverage but currently takes more than four minutes and contains active unrelated failures.
- Runtime evals, PSTN evals, and PSTN capacity load tests are separate and were not run for this configuration-only issue.

This is baseline evidence, not a claim that the pre-existing suite is green. Later rationalization issues must compare their final inventory and execution results against this document without hiding existing failures.

## ISSUE-234 tenant application-shell contraction

The tenant application-shell pass removed presentation assertions and the embedded API/WebSocket reimplementation from `apps/web/src/app.test.tsx`.

| Measure | Before | After | Change |
| --- | ---: | ---: | ---: |
| `app.test.tsx` executed tests | 73 | 4 | -69 |
| `app.test.tsx` lines | 6,609 | 332 | -6,277 |
| UI-smoke static declared tests | 149 | 66 | -83 |
| UI-smoke lines | 10,567 | 4,290 | -6,277 |

The static declared-test delta is larger than the executed-test delta because the inventory intentionally uses approximate source-pattern counting. Runtime-expanded Vitest totals remain authoritative.

The four retained shell tests cover signed-out authentication entry, protected-route authentication and sign-out, multi-organization selection, and tenant entry from server-owned auth context. Workflow builder, sandbox, telephony, agents, and live-session hook coverage remains in focused component suites. Backend policy, persistence, provider state, authorization, tenant isolation, and runtime behavior remains owned by the API/integration layer.

Command: `npm run test:ui-smoke -- --reporter=default`

- Result: 9 files and 64 runtime-expanded tests passed.
- Duration: 47.57 seconds.
- The previous incidental landing-copy failure was removed with the presentation assertions rather than accommodated in product code.

## ISSUE-235 workflow-builder and sandbox contraction

The workflow-builder and sandbox pass retained complete operator journeys while relying on existing pure workflow, workbench, publishing, tool-catalog, registry, manifest, and runtime-hook seams for detailed decisions.

| Measure | Before | After | Change |
| --- | ---: | ---: | ---: |
| Builder and sandbox rendered tests | 30 | 5 | -25 |
| Builder and sandbox rendered-test lines | 2,164 | 724 | -1,440 |
| UI-smoke static declared tests | 66 | 39 | -27 |
| UI-smoke lines | 4,290 | 2,850 | -1,440 |

The three retained builder tests cover saved-workflow loading, node creation plus a valid connection and validation recovery, and publish-before-sandbox execution. The two retained sandbox tests cover organization-scoped published-workflow listing and published-version deep-link selection. Voice-session startup and interruption/readiness behavior remains in the six-test `useLiveSandboxSession` client-logic suite.

Focused builder, sandbox, core workflow, workbench, publishing, tool-catalog, registry, manifest, and runtime-hook execution passed: 11 files and 74 tests in 25.43 seconds.

The first default-timeout UI-smoke run passed 36 of 39 tests; three unrelated tests exceeded the five-second per-test ceiling under parallel load. The same 9-file, 39-test lane passed in 44.89 seconds with an explicit 15-second ceiling, confirming resource contention rather than behavioral failures.

Post-review cleanup removed the remaining copy assertions, deduplicated the sandbox fixture, collapsed the builder fetch mock to the fixed contracts used by retained journeys, and extended the published builder journey through the rendered call control into `startSession`.

## ISSUE-236 operational and platform-admin contraction

Operational rendered coverage now retains only reusable-agent creation and tool assignment, imported-number workflow routing, platform-admin access/session gates, staff shell routing, and runtime observability/eval status. Payload construction and form hydration remain covered in a separate pure unit suite.

| Measure | Before | After | Change |
| --- | ---: | ---: | ---: |
| Operational rendered tests | 22 | 7 | -15 |
| Operational rendered-test lines | 1,194 | 723 | -471 |
| Platform-admin pure payload tests | 0 | 6 | +6 |
| Telephony pure request tests | 0 | 2 | +2 |
| UI-smoke static declared tests | 39 | 24 | -15 |
| UI-smoke lines | 2,850 | 2,379 | -471 |

The API controller suites remain authoritative for reusable-agent tenant membership, telephony provider operations and protected routes, live activation policy, platform-staff authorization, secret redaction, and audited support mutations.

## ISSUE-237 executable validation

Presentation and source-text cleanup removed CSS, marketing-copy, deployment-prose, CI-text, Dockerfile-text, and architectural substring contracts. Important guarantees now run through native parsers, AST inspection, Compose validation, production builds, Markdown-link validation, and a CI Dockerfile check.

| Measure | Before | After | Change |
| --- | ---: | ---: | ---: |
| Ordinary test files | 192 | 184 | -8 |
| Ordinary static test declarations | 1,406 | 1,367 | -39 |
| Ordinary test lines | 89,674 | 88,772 | -902 |
| UI-smoke files | 9 | 8 | -1 |
| UI-smoke static tests | 24 | 23 | -1 |
| UI-smoke lines | 2,379 | 2,343 | -36 |

`integrationProviderBranding.test.ts` remains as parameterized accessible-label coverage. Its CSS class assertions were removed.

## ISSUE-238 control-plane suite modularization

The memory, connector-contract, and integrations-controller suites were reorganized by public endpoint family or provider capability without removing behavioral assertions.

| Measure | Before | After | Change |
| --- | ---: | ---: | ---: |
| Candidate test files | 3 | 19 | +16 |
| Shared typed support files | 0 | 3 | +3 |
| Candidate runtime tests | 88 | 88 | 0 |
| Candidate/support lines | 9,624 | 9,714 | +90 |
| Largest affected file | 3,781 | 899 | -2,882 |

The modest line increase is repeated per-file imports and capability naming; application setup, repository builders, provider connections, mock responses, and schema lookup remain centralized in typed support modules. The focused memory/integrations run passed 119 tests across 25 files, including all 88 candidates. After correcting adjacent test-module persistence and controller seams, the complete API/integration lane passed serially in 257.34 seconds.
