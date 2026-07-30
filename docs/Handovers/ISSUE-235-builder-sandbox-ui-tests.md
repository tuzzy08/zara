# ISSUE-235: Contract workflow builder and sandbox UI coverage

External: [Linear ZAR-239](https://linear.app/zara-voice/issue/ZAR-239/contract-workflow-builder-and-sandbox-ui-coverage)

Status: Implemented

## Work completed

- Contracted `WorkflowBuilder.test.tsx` from 26 tests and 1,898 lines to three complete builder journeys and 590 lines.
- Contracted `SandboxScreen.test.tsx` from four tests and 266 lines to two published-workflow selection journeys and 134 lines.
- Retained saved-workflow loading, node creation with a valid React Flow connection and validation recovery, publish-before-sandbox execution, organization-scoped workflow listing, and published-version deep-link selection.
- Confirmed route eligibility, workflow relationships, node identity, publishing decisions, tool catalogs, registry behavior, manifest compilation, and live-session behavior remain covered at pure core/client seams.
- Removed visual-affordance, decorative-style, panel-expansion, placeholder-copy, layout-absence, and duplicate product-policy assertions.
- Standards review identified residual copy assertions, duplicated sandbox fixtures, and unused fetch-mock configurability; all three findings were resolved.
- Spec review identified missing rendered voice-session startup wiring; the retained publish journey now clicks the sandbox call control and verifies the published manifest reaches `startSession`.

## Tests run

- Focused builder and sandbox tests passed: 2 files and 5 tests in 30.71 seconds.
- Focused builder, sandbox, core workflow, workbench, publishing, tool-catalog, registry, manifest, and runtime-hook suites passed: 11 files and 74 tests in 25.43 seconds.
- The first default-timeout UI-smoke run passed 36 of 39 tests; three unrelated tests exceeded five seconds under parallel load.
- `npm.cmd run test:ui-smoke -- --reporter=default --testTimeout=15000` passed: 9 files and 39 tests in 44.89 seconds.
- `npm.cmd run typecheck --workspace @zara/web` passed.
- Targeted ESLint passed with zero warnings.
- `npm.cmd run test:inventory` passed: UI smoke now contains 9 files, 39 statically declared tests, and 2,850 lines.
- `git diff --check` passed for the contracted suites.
- Post-review focused builder and sandbox suites passed: 2 files and 5 tests in 22.81 seconds.
- Post-review frontend typecheck and targeted ESLint passed.

## Pending work

- None.

## Risks

- The remaining 39 UI-smoke tests still exceed the final 15-25 target; ISSUE-236 and ISSUE-237 own the remaining operational/admin and presentation contraction.
- Several rendered suites exceed the default five-second ceiling under parallel load even though the bounded rerun passes; final qualification should decide whether to isolate workers or set an explicit UI-smoke timeout.

## Decisions

- Visual and incidental presentation assertions are not test contracts.
- Detailed workflow, manifest, registry, and runtime decisions remain authoritative below the DOM.
- Hook-level voice-session tests remain protected as client logic even though they currently require a TSX harness.

## Next recommended step

- Proceed to ISSUE-236 to contract operational and platform-admin UI coverage.
