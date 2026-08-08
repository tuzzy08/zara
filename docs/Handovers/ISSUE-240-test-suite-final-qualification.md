# ISSUE-240: Enforce the UI-smoke boundary and qualify the complete suite

External: [Linear ZAR-244](https://linear.app/zara-voice/issue/ZAR-244/enforce-the-ui-smoke-boundary-and-qualify-the-complete-suite)

Status: Implemented

## Work completed

- Documented public seams, layer rules, prohibited presentation assertions, and the reviewed DOM allowlist in `docs/Testing-Strategy.md`.
- Added `config/ui-smoke-allowlist.json`, `npm run test:boundaries`, and a CI gate that rejects unapproved DOM files or totals outside 15-25 declarations.
- Stabilized unit and aggregate Vitest execution with one worker after parallel unit execution failed to start three fork workers.
- Recorded final metrics and baseline comparison in `docs/Test-Suite-Baseline.md`.
- Verified ZAR-238 through ZAR-243 are Done before parent reconciliation.

## Tests run

- RED: `npm.cmd run test:boundaries` failed because the guardrail command did not exist.
- GREEN: `npm.cmd run test:boundaries` passed with 8 approved files and 23 declared DOM tests.
- `npm.cmd run test:inventory` — 216 files, 1,367 declarations, 85,558 lines; unit 42/288/16,569, API 166/1,056/66,646, UI 8/23/2,343.
- First `npm.cmd run test:unit` — assertions passed but the command failed when three fork workers timed out during startup.
- GREEN/refactor verification: final `npm.cmd run test:unit` passed 42 files and 300 runtime cases in 37.57 seconds.
- `npm.cmd run test:ui-smoke` — passed 8 files and 23 tests in 27.80 seconds.
- `npm.cmd run test:api` — passed in 161.2 seconds.
- `npm.cmd run test:run` — complete ordinary suite passed in 404.4 seconds.
- `npm.cmd run validate:contracts` — passed, including every production workspace build.
- `npm.cmd run typecheck` — passed.
- Batched ESLint across every tracked JavaScript/TypeScript source — passed.
- Repository-wide `npm.cmd run lint` reaches only 14 errors in the user's unrelated untracked `docs/system-design/system-design.js`; tracked/changed sources are clean.
- `npm.cmd run eval:runtime` — 5/5 passed.
- `npm.cmd run eval:pstn` — 25/25 passed.

## Pending work

- None for the tracked test-rationalization work.

## Risks

- Local global lint remains sensitive to the unrelated untracked `docs/system-design/` browser artifact; it is absent from a clean checkout and was not modified.

## Decisions

- The final 23 DOM tests are inside target. The 114 frontend/admin total is a safer documented variance: 91 tests remain at cheaper pure-client seams rather than being deleted for a numeric target.
- No blanket presentation-code coverage percentage is imposed.

## Next recommended step

- Maintain the allowlist and layer rules as the product evolves.
