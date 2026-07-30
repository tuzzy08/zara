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
