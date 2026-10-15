# ISSUE-251: Atomic concurrent workflow publishing

Status: Implemented
External: https://github.com/tuzzy08/zara/issues/130
Pull request: https://github.com/tuzzy08/zara/pull/132

## Work completed

- Publication now checks the expected version and stores the immutable manifest in one Postgres transaction under a tenant/workflow lock.
- Competing or stale requests receive HTTP 409. Version allocation uses stored manifests. The response contains the stored publication.
- The client sends `expectedVersion`. Legacy snapshots provide only a compatibility expected-version value.
- Grant creation runs only after the version and workspace checks. Rejected stale requests cannot create grants. The memory adapter serializes asynchronous publication too.
- Updated API and runtime-manifest contracts.

## Tests run

- Existing publication baseline: 4 files, 10 tests passed.
- RED: concurrent different edits both returned 201 instead of one 201 and one 409. Evidence: `artifacts/e2e/zara-e2e-19860-1792087156825/`.
- Additional RED: a stale 409 request created an active Zendesk grant. Evidence: `artifacts/e2e/zara-e2e-18604-1792088180575/`.
- The latter run passed concurrent version checks but its final SQL read timed out in piped Docker stdin. A direct SQL argument returned in 2.6 seconds; no blocked database query was found. The harness now uses noninteractive command arguments. That incomplete test is not reported as GREEN.
- Initial publication implementation: 42 regression tests passed. Latest grant-fix regression: 41 passed and one unchanged 15-second controller test timed out. The controller file then passed alone, all 6 tests, with unchanged assertions and time limits. Command: `npm.cmd run test:run -- apps/api/src/workflows/workflows.controller.test.ts`; duration 55.22 seconds, exit 0. Log: `.zara-data/stage1/publication-controller-recheck.log`.
- Scoped lint and diff checks passed. Main API typecheck passed before the final grant change; the final Docker build passed on the final source.

## Historical combined-workspace verification context

- Base revision: `0d2d90ea7bebc75d05ed90f4647892bd6ad93ac2`, with existing uncommitted signup changes preserved. These results apply to the recorded working tree, not the base commit alone.
- Disposable Docker services use real Postgres, Redis, two API instances and HTTPS. Fixtures use synthetic accounts and local email verification. Billing and live provider calls are off.
- Each E2E artifact contains the exact command, setup metadata, reports and traces. Final run input hashes are in `artifacts/e2e/zara-e2e-19392-1792089998685/executed-source-inputs.json`. All 865 recorded inputs match the recovered combined workspace. The separate PR tree is verified below.
- Docker storage errors initially blocked setup. The owner approved a Docker Desktop restart. A scoped Docker WSL restart restored the engine and unrelated local containers. No shared data was reset or deleted.
- First full command: `npm run test:e2e`. Result: 9 passed, 1 failed; cleanup exited 0. All seven Stage 1 scenarios passed. The existing signup browser test met the shared signup rate limit after API fixture traffic. Log: `stage1-final-e2e.log`. Artifact: `artifacts/e2e/zara-e2e-17256-1792088974662/`.
- Installed Better Auth applies a special signup limit of three requests in 10 seconds. Test setup now respects that window with an 11-second backoff and a pause after the API suite. Production limits, existing browser assertions and browser test time limits remain unchanged. The full repeat passed with `npm run test:e2e`: 10 passed, 0 failed, 0 skipped, in 156.37 seconds. API/web builds and migration succeeded. Test and cleanup exit codes are both 0. Log: `stage1-final-e2e-paced.log`. Artifact: `artifacts/e2e/zara-e2e-19392-1792089998685/`. The JUnit report, HTML report, traces, service logs, image IDs, revision and input hashes are retained.

## Pending work

- No Stage 1 acceptance work remains. Deployment and live-provider qualification are outside this issue.

## Risks

- Tool grants remain file-backed. A later database failure after an accepted grant write can leave that grant; atomic storage across those two systems is outside this change.
- Broader browser draft synchronization is outside this change. No deployment occurred.

## Decisions

- Keep expected-version checks, allocation and immutable storage in one transaction.
- Delay publication grant writes until after conflict checks. Do not create grants for rejected stale requests.
- The owner selected GitHub after Linear reached its issue limit.

## Next step

Review PR #132 for release. Before deployment, complete the workspace data export/import plan and apply migration 0044. No deployment was performed. See the standalone PR section for commit and review status.

## Standalone PR verification, 2026-10-15

- The owner requested a Stage 1 commit and PR, with existing signup work kept separate.
- Branch `codex/stage1-reliability` is based on `origin/dev` at `4b3cab4`. The signup UI, email, completion endpoints, user fields, tests and migration are excluded. The shared onboarding service includes only the asynchronous workspace access change.
- The standalone branch uses `0044_durable_workspaces`, generated after migration 0043. The earlier combined-tree evidence used 0045 after the uncommitted signup migration. The original combined workspace is preserved; the future signup branch must reconcile its migration number after this branch merges.
- The E2E fixture uses the existing verified credential recovery flow. The full standalone run passed all 10 tests with no failures or skips in 170.73 seconds. Test and cleanup exit codes are 0. Exact command: `npm run test:e2e`. Evidence: `artifacts/e2e/zara-e2e-37092-1792093073482/` in the `zara-stage1-pr` checkout. It contains run metadata, source hashes, image IDs, reports, traces and service logs. All 862 source hashes match the verified tree.
- Archive cleanup removed source directories through shared workspace links. Recovery used retained Git objects and the Docker source cache. All 865 final-run source hashes match after recovery. No missing tracked file remains. This PR checkout has its own dependencies and no shared directory links.
- Migration generation, scoped lint, runner syntax, diff checks and independent separation review passed. The generated standalone SQL exactly matches the prior verified workspace SQL. The ignored runner file was checked with `node --check scripts/run-e2e.mjs`.
- Implementation commit: `9ced8cd`. PR [#132](https://github.com/tuzzy08/zara/pull/132) is open against `dev`. The GitHub issues remain completed because their acceptance work is implemented; merge and deployment remain separate.
- Pending work: PR review and merge. No Stage 1 implementation work remains.
