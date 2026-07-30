# ISSUE-233: Establish layered test commands and baseline metrics

External: [Linear ZAR-237](https://linear.app/zara-voice/issue/ZAR-237/establish-layered-test-commands-and-baseline-metrics)

Status: Implemented

## Work completed

- Ticket published with no blockers as the implementation frontier.
- Started the implementation pass and confirmed the public seams are the root test-layer commands and baseline metrics command.
- Added independently runnable unit, API/integration, UI-smoke, and tracked-inventory commands.
- Added disjoint Vitest configurations for the three ordinary layers while preserving the aggregate ordinary command and separate runtime/PSTN eval lanes.
- Documented layer selection and recorded static plus executed baseline evidence in `docs/Test-Suite-Baseline.md`.
- Completed the required standards and spec reviews. Both reviewers identified that the first contract did not verify actual Vitest environments or file selection; the contract now imports all three configurations, asserts Node/jsdom environments, and compares their tracked-file sets with inventory classifications.

## Tests run

- RED: `npx.cmd vitest run packages/core/src/test-layer-config.test.ts --reporter=default` failed because the four new root commands were absent.
- First GREEN attempt reached the inventory command but exceeded Vitest's default five-second timeout on Windows.
- GREEN: the focused configuration-contract test passed after adding the commands/configurations and a bounded 15-second repository-inventory contract timeout.
- `npm.cmd run test:inventory` passed: 189 tracked files, 1,522 declared tests, and 97,399 lines with no duplicate or unclassified files.
- `npm.cmd run test:unit -- --reporter=default` passed: 45 files and 304 tests in 16.49 seconds.
- `npm.cmd run test:ui-smoke -- --reporter=default` completed with the existing landing-copy failure: 8 files passed, 1 failed; 132 tests passed, 1 failed; 132.35 seconds.
- `npm.cmd run test:api -- --reporter=default` completed with existing unrelated failures: 130 files passed, 3 failed, 3 skipped; 1,093 tests passed, 12 failed, 41 skipped; 272.21 seconds.
- `npm.cmd run typecheck:core` passed.
- Targeted ESLint passed with no errors; the inventory script is outside the configured lint file set and produced one ignored-file warning.
- `git diff --check` passed.
- Post-review focused configuration-contract test passed: 1 test in 10.41 seconds.
- Post-review inventory, targeted ESLint with zero warnings, and `git diff --check` passed.
- After staging the new contract, `npm.cmd run test:inventory` passed with 190 tracked files, 1,523 declared tests, and 97,505 lines; the pre-change 189-file baseline remains recorded separately.
- Final focused configuration-contract rerun passed: 1 test in 3.42 seconds.

## Pending work

- None for ISSUE-233.

## Risks

- Existing suite failures or timeouts must be recorded rather than hidden by the new commands.
- The UI and API layers are not green because of unrelated active working-tree failures documented in the baseline.
- Static declared-test counts are intentionally approximate for parameterized tests; executed Vitest totals remain the runtime authority.

## Decisions

- Runtime and PSTN evals remain separate from ordinary deterministic layers.
- TypeScript component tests define the UI-smoke file boundary; browser-specific non-component helpers can retain per-file jsdom directives in the unit layer.
- The aggregate `test:run` command remains available for compatibility and complete ordinary-suite execution.

## Next recommended step

- Work any of the now-unblocked ISSUE-234 through ISSUE-239 migration tickets, then run final qualification in ISSUE-240.
