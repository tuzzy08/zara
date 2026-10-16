# ISSUE-253: Shared durable integration state

Status: Implemented (PR #137 open; remote CI pending)
External: [GitHub #134](https://github.com/tuzzy08/zara/issues/134)

PR: [#137](https://github.com/tuzzy08/zara/pull/137). Implementation commit: `c903b9fae77124cae0e6fbde6396259542a26260`. GitHub #134 is closed as implemented. The PR targets `dev` and is ready for review. Remote CI remains pending. `npm.cmd run db:check` passed after commit. No deployment occurred.

## Scope and decisions

Stage 2 must complete one customer journey with a real connector and CRM delivery that recovers from failure. Shared credentials are its first dependency. Use Postgres for tenant integration state and preserve the existing encrypted envelopes. Reject stale writes with HTTP 409 instead of losing accepted changes. Keep provider network requests outside database transactions.

The selected data shape is one tenant integration aggregate plus an authoritative database revision. The aggregate keeps the existing encrypted credentials, connections, pending connects, grants and webhook definitions. Save compares the original loaded revision with the current revision. A stale save returns 409. An initial insert race also returns 409. Never replace the original revision with a later read.

Alternative designs were transactional aggregate mutation and normalized connection/grant tables. Transactions reduce conflicts for local mutations but must not include provider requests. Normalized tables reduce unrelated write conflicts but require a larger service rewrite. CAS is the smallest storage-only change. It is not sufficient for real OAuth code exchange; that requires a durable claim in the next slice.

## Plan and throughput checkpoint

- [x] Ground: trace all three aggregate writers and their authorization checks.
- [x] Sketch: compare CAS, transactional mutation and normalized tables with an independent review.
- [x] Agree: proceed under the user's Stage 2 instruction; no design approval gate is needed.
- [x] Implement: confirmed both RED cases, delegated the coupled change, reviewed the diff and verified GREEN.
- [x] Scrap: no redesign required for this storage slice. Real OAuth still needs durable claims in ISSUE-254.
- Blocking first steps: run existing tests and capture E2E RED before production edits.
- Independent workstreams: design review can run with test preparation. Production edits have one owner.
- Shared mutable state: all aggregate writers compare the original revision. Keep network requests outside database transactions.
- Smallest safe decomposition: one storage slice and one owner because repository, service and migration must agree. OAuth and CRM delivery follow after its checks pass.

## Completed work

- Read the integration lifecycle, persistence and permission boundaries. Found local files and a process cache in the production path.
- Created the separate Stage 2 branch from merged signup revision `f09f621075e8acb4491ed73b63f28be9db61cf2e`.
- Created the external issue before this record. The user selected GitHub after the Linear issue limit.

## Tests and coverage gap

- Existing persistence and lifecycle tests passed, 13 tests in 38.89s. Command: `npm.cmd exec -- vitest run apps/api/src/integrations/integrations.persistence.test.ts apps/api/src/integrations/integrations.lifecycle.controller.test.ts --maxWorkers=1 --reporter=dot`. Their file-backed tests do not prove shared state across two production API instances.
- RED: `npm.cmd run test:e2e -- tests/e2e/durable-integrations.spec.ts` failed at line 27. API A accepted a connection, but API B returned an empty list. Artifact `artifacts/e2e/zara-e2e-20264-1792155683063/` contains the report, trace, logs, image IDs, revision `f09f621`, and source hashes. Teardown passed. The first attempted run could not start because Docker was stopped; it is not behavior evidence. Docker was started without deleting its data.
- The E2E also covers encryption, cross-tenant denial, concurrent writes, restart, deletion, dependent grant removal and preservation of unrelated webhook writes. Its missing-key assertion must fail before the credential preservation fix.
- Second RED: the same command reached line 38 after shared storage was added. A health check with an unavailable key erased the envelope. Expected ciphertext was present before the write and absent after it. Evidence: `artifacts/e2e/zara-e2e-17468-1792156118958/`. Teardown passed.
- The production patch adds migration `0046_durable_integrations`, shared Postgres state, original-revision CAS, fresh reads and preservation of unopened envelopes.
- GREEN: `npm.cmd run test:e2e` passed all 11 tests in 2.8 minutes. Artifact `artifacts/e2e/zara-e2e-24248-1792156462744/` contains the report, traces, images, service logs and source manifest. Both run and cleanup exit codes are 0. All 869 recorded source hashes match the final source. The new integration journey passed in 25.2 seconds. Fixtures use two production API instances, disposable Postgres/Redis, local HTTPS, synthetic credentials and real auth. No real Zendesk call was made.
- `npm.cmd exec -- vitest run apps/api/src/integrations --maxWorkers=1 --reporter=dot` passed 80 tests in 15 files, 87.61 seconds.
- Full `npm.cmd run typecheck` passed. Scoped ESLint passed for the five production TypeScript files and E2E file. `npm.cmd run test:boundaries` passed. `npm.cmd run db:generate` reported no schema changes. `git diff --check` passed.
- Independent review found no material defect. The comment review found no new comments to remove. The decision trail records both failures, the fix and the real-service result. No separate refactor was needed.

## Pending work

- Review PR #137 and verify remote CI. No merge of this PR is authorized by the PR #133 merge instruction.
- Before deployment, perform a reviewed import of existing integration files with their encrypted envelopes and grants. Deployment is not authorized by this pass.

## Risks

- Existing local integration files need a reviewed import before rollout. Do not discard them.
- This issue does not complete real OAuth, token refresh or CRM delivery. Those remain Stage 2 work.
- Zendesk is the stated default for the first customer journey because ticket creation already exists. The optional CRM question remains open. This storage change is required for either proposed CRM.
- Missing-key envelope preservation now passes. It does not make an unavailable credential usable.

## Next step

Continue with ISSUE-254 on a separate dependent branch. Keep live Zendesk qualification separate from protocol fixture evidence.
