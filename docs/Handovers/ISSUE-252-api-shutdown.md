# ISSUE-252: Signal-driven API shutdown and database drain ordering

Status: Implemented
External: https://github.com/tuzzy08/zara/issues/131

## Work completed

- Enabled SIGTERM and SIGINT hooks in the real API entry point. Nest exits after lifecycle hooks complete.
- Moved Postgres pool closure from module destruction to the final application-shutdown phase. Drain handlers retain database access.
- Kept worker lifecycle behavior unchanged.

## Tests run

- Existing focused baseline: 6 files, 16 tests passed, including retained telephony and billing lifecycle checks.
- RED: the real Nest/Postgres drain query failed with `Cannot use a pool after calling end on the pool`. Evidence: `artifacts/e2e/zara-e2e-5924-1792086494244/`.
- Signal RED: the real API required forced termination, with exit 137 after 14,702 ms. Evidence: `artifacts/e2e/zara-e2e-19860-1792087156825/results/durable-control-plane-API--a9f59-session-works-after-restart/sigterm-result.json`. The trace retains the original exit-code assertion; a subsequent readiness setup failure did not replace this evidence.
- GREEN: real SIGTERM exit 0 and session recovery passed. The real Nest/Postgres probe completed its drain write and verified the pool was closed after shutdown. Evidence: `artifacts/e2e/zara-e2e-18604-1792088180575/`.
- Scoped lint passed.

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

- The signal test uses a real API process. The pool probe uses real Nest lifecycle and Postgres, but is integration evidence rather than active-provider call E2E evidence.
- The isolated network cannot hold a real voice-provider call. Existing telephony lifecycle checks remain; no live-call shutdown qualification or deployment occurred.

## Decisions

- Identified failure modes: missing signal hooks, database closure before drain writes, forced termination, and lost session state after restart.
- Use the process boundary for signal behavior and a real database lifecycle probe for drain ordering and final pool closure.
- The owner selected GitHub after Linear reached its issue limit.

## Next step

Review the local changes for release. Before deployment, complete the workspace data export/import plan and apply migration 0044. No deployment was performed. See the standalone PR section for commit and review status.

## Standalone PR verification, 2026-10-15

- The owner requested a Stage 1 commit and PR, with existing signup work kept separate.
- Branch `codex/stage1-reliability` is based on `origin/dev` at `4b3cab4`. The signup UI, email, completion endpoints, user fields, tests and migration are excluded. The shared onboarding service includes only the asynchronous workspace access change.
- The standalone branch uses `0044_durable_workspaces`, generated after migration 0043. The earlier combined-tree evidence used 0045 after the uncommitted signup migration. The original combined workspace is preserved; the future signup branch must reconcile its migration number after this branch merges.
- The E2E fixture uses the existing verified credential recovery flow. The full standalone run passed all 10 tests with no failures or skips in 170.73 seconds. Test and cleanup exit codes are 0. Exact command: `npm run test:e2e`. Evidence: `artifacts/e2e/zara-e2e-37092-1792093073482/` in the `zara-stage1-pr` checkout. It contains run metadata, source hashes, image IDs, reports, traces and service logs. All 862 source hashes match the verified tree.
- Archive cleanup removed source directories through shared workspace links. Recovery used retained Git objects and the Docker source cache. All 865 final-run source hashes match after recovery. No missing tracked file remains. This PR checkout has its own dependencies and no shared directory links.
- Migration generation, scoped lint, runner syntax, diff checks and independent separation review passed. The generated standalone SQL exactly matches the prior verified workspace SQL. The ignored runner file was checked with `node --check scripts/run-e2e.mjs`.
- Pending work: commit, push, open the PR and synchronize its link.
