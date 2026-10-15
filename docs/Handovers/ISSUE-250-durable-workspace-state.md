# ISSUE-250: Durable workspace state and access records

Status: Implemented
External: https://github.com/tuzzy08/zara/issues/129
Pull request: https://github.com/tuzzy08/zara/pull/132

## Work completed

- Added migration 0044 on the standalone branch and normalized workspace, membership, membership-history and audit tables. The uncommitted signup migration and feature changes are excluded from this branch.
- Workspace mutations use tenant-scoped Postgres transactions. All production callers await reads and writes.
- New workspace IDs use UUIDs. Renaming a workspace cannot cause a later create to reuse its ID.
- Membership history is independent of native organization membership. Removing and restoring a native member does not restore revoked workspace access.
- Updated the API and data model contracts, including rollout requirements.

## Tests run

- Existing focused baseline: 6 files, 16 tests passed.
- RED: two API instances returned different workspace lists after concurrent creates. Command: `npm run test:e2e -- tests/e2e/durable-control-plane.spec.ts`. Evidence: `artifacts/e2e/zara-e2e-5924-1792086494244/`.
- Additional RED: rename/recreate reused a workspace ID; native-member replacement restored revoked default access. Evidence: `artifacts/e2e/zara-e2e-30948-1792087748110/`.
- GREEN: shared state, concurrent writes, lifecycle/audit persistence, last-owner protection, revoked access, tenant denial, rename/recreate and native-member replacement passed in `artifacts/e2e/zara-e2e-18604-1792088180575/`.
- Focused workspace/auth-context/onboarding checks: 19 passed. Sandbox controller checks: 27 passed. API typecheck and scoped lint passed.
- A pre-existing invitation cookie assertion failed in the baseline. It is unrelated to this change. An existing-user invitation test timed out under load, then passed alone with its original time limit.

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

- Apply migration 0044 before the new API starts. SQL cannot recover old process-local workspace data. Export each deployed tenant's current state and use a reviewed import or restoration before replacement.
- No production deployment or import was performed.

## Decisions

- Use normalized records and transaction locks to retain database constraints and prevent lost writes.
- Keep durable access history even when a native membership is removed. Do not infer authorization from the absence of current membership rows.
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
