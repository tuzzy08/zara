# ISSUE-237: Replace presentation and source-text tests with executable validation

External: [Linear ZAR-241](https://linear.app/zara-voice/issue/ZAR-241/replace-presentation-and-source-text-tests-with-executable-validation)

Status: Implemented

## Work completed

- Removed eight brittle source/presentation test files covering CSS, marketing copy, platform deployment text, Dockerfile text, CI workflow text, deployment prose, DevOps prose, and telephony source strings.
- Replaced important contracts with `npm run validate:contracts`, which parses platform-admin env/JSON configuration, checks local Markdown links, enforces the telephony persistence boundary through the TypeScript AST, validates the resolved Coolify Compose service model, and runs the complete production build.
- Added CI construction of the API, realtime-worker, web, and platform-admin production container targets, with `docker build --check .` retained as a Dockerfile lint gate.
- Kept provider branding coverage at its accessible label and logo-token seam while removing CSS class coupling.
- Fixed the layered-test configuration test to load root Vitest configs dynamically so the production build no longer compiles imports outside `@zara/core`'s `rootDir`.
- Made test inventory ignore tracked files deleted in the working tree so cleanup passes can measure their post-removal state.

## Tests run

- Candidate baseline passed: 8 files and 39 tests in 6.18 seconds.
- Failing contract check written / RED: the new executable repository-contract command was specified first, and `npm.cmd run validate:contracts` failed because the command did not exist.
- The first executable build exposed the root Vitest config import failure in `@zara/core`.
- `packages/core/src/test-layer-config.test.ts` passed after the dynamic-import correction.
- `npm.cmd run validate:contracts` passed, including all production workspace builds, in 71.5 seconds.
- REFACTOR verification: the final `npm.cmd run validate:contracts` rerun passed after the checks were organized into named validators.
- Unit lane passed: 42 files and 300 runtime cases in 64.98 seconds.
- UI-smoke lane passed: 8 files and 23 tests in 30.89 seconds.
- Targeted ESLint completed with no errors.
- Inventory passed: 184 ordinary files, 1,367 static declarations, and 88,772 lines.

## Pending work

- None for repository implementation.
- Synchronize Linear ZAR-241 when the connector is available.

## Risks

- Local Docker Compose parsing does not require a running daemon; complete production target-image builds run in CI where the daemon is available.
- The production build still reports the existing web bundle-size warning, but completes successfully.
- Existing unrelated worktree changes must remain outside this issue's commit.

## Decisions

- Copy, styling, and decorative implementation details are excluded from ordinary unit-test contracts.
- Documentation integrity is a link/existence contract, not a prose-copy contract.
- Deployment configuration is validated by its native parser, build, and container tools.
- Architectural source boundaries may use AST validation, not substring searches.

## Next recommended step

- Continue with ISSUE-238 control-plane suite modularization.
