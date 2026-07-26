# ISSUE-231: Multi-worker drain, fencing, and failure recovery

- Status: In Progress
- External: [Linear ZAR-233](https://linear.app/zara-voice/issue/ZAR-233/pstn-capacity-1012-qualify-multi-worker-drain-fencing-and-failure)

## Decisions

- Established premium media is never migrated or replayed to another worker.
- Redis lease authority defines the maximum continuity window. Zara does not add an unfenced grace period after the last confirmed lease expiry.
- Worker-owned durable lifecycle mutations must carry immutable worker and ownership-epoch fencing context.
- A drain deadline terminates remaining calls with a distinct terminal reason and reports the forced count.
- PostgreSQL terminal persistence uses bounded, idempotent retry and exposes exhaustion for reconciliation.
- Resource posture remains an eligibility gate. Eligible workers are selected by available slots and current load rather than an opaque weighted algorithm.

## Work Completed

- Reconciled Linear ZAR-233 with local ISSUE-231 and started the issue.
- Audited ISSUE-230 staging promotion gates. Local worker, deployment, simulator, and PSTN eval contracts pass; deployed exact-worker ingress, live provider smoke, and active-call API-restart evidence remain blocked until a candidate release is deployed.
- Added durable premium ownership fencing to worker-owned lifecycle mutations. Worker ID, ownership epoch, and lease deadline are checked before a worker may advance call state; stale owners fail closed without mutating lifecycle.
- Bound Redis outage continuity to the last successfully confirmed active lease. Renewal or durable-fence rejection stops the media owner and releases admission instead of extending authority locally.
- Added explicit drain-deadline shutdown. Remaining media and provider sessions terminate with `worker_drain_deadline`, the forced call count is logged, and `zara.pstn.worker.forced_drain_terminations` records the affected calls.
- Added bounded idempotent terminal persistence retries. Non-applied repository outcomes are not treated as success, exhausted writes are observable, and a scheduled worker reconciler terminates nonterminal calls whose durable owner lease expired.
- Added recovery metrics for confirmed lease expiry, pending admission releases, duplicate media claims, finalization outcomes, forced drains, and admission backend readiness. The production checklist defines the corresponding low-cardinality OTel alert conditions.
- Documented the supported Coolify topology as two separate realtime-worker applications with immutable worker identities, distinct endpoints, no overlapping same-ID rolling instances, and a serial drain-and-replace procedure.
- Corrected the real-Postgres concurrency qualification to establish a valid ownership fence before explicitly expiring it, preventing wall-clock drift from silently skipping the reconciliation assertion.
- Added explicit reverse-order rollback runbooks for the premium dispatch ownership and owner-lease migrations. The migration workflow now removes those dependencies before restoring pre-incremental call identities instead of relying on cascading index removal.
- Unblocked the candidate PR quality gates by removing three branch-local lint defects, replacing the migration workflow's fixed test password with isolated-container trust authentication, and retaining fail-closed Coolify Redis authentication without scanner-hostile placeholder copy.

## Tests Run

- `npm.cmd run typecheck --workspace=@zara/api` passed.
- Focused schema, worker host/lifecycle/module/reconciler, observability, repository, admission, premium execution, Twilio media, and deployment-documentation suite passed: 202 tests across 11 files.
- Real PostgreSQL incremental repository qualification passed: 22 tests, including concurrent stale-owner reconciliation.
- Redis client, admission unit, and two-client real-Redis qualification passed: 39 tests.
- `npm.cmd run eval:pstn` passed: 25 tests.
- `docker compose -f compose.coolify.yml config --quiet` passed after programmatically populating all 22 required variables with validation-only values.
- Targeted `git diff --check` passed.
- RED: `npm.cmd exec -- vitest run apps/api/src/database/telephony-migration-rollback-chain.test.ts` failed with `ENOENT` for the missing rollback-0015 runbook. The fresh-database rollback workflow then reproduced the production dependency failure when rollback 0009 tried to drop the tenant session identity index while the premium dispatch snapshot foreign key still depended on it.
- GREEN: `npm.cmd exec -- vitest run apps/api/src/database/telephony-migration-rollback-chain.test.ts` passed after adding rollback 0015 and 0014 in strict reverse order.
- REFACTOR: strengthened the regression to assert actual rollback execution order and the premium snapshot postcondition; the focused test and `npm.cmd exec -- eslint apps/api/src/database/telephony-migration-rollback-chain.test.ts` passed.
- GREEN: the full local migration workflow passed on isolated PostgreSQL databases: fresh migration, 26 migration/PostgreSQL tests, rollback through 0015 to 0009, and legacy compatibility validation.
- RED: `npm.cmd exec -- vitest run packages/core/src/deployment-docs.test.ts -t "migration CI database fixture"` failed because the migration workflow did not contain isolated `POSTGRES_HOST_AUTH_METHOD: trust` and still embedded the fixed fixture password.
- RED: `npm.cmd exec -- vitest run packages/core/src/deployment-docs.test.ts -t "production Redis fail-closed"` failed because the Coolify Redis requirement still used scanner-hostile placeholder copy instead of the required fail-closed form.
- GREEN: the deployment contract passed with passwordless trust authentication limited to the ephemeral GitHub Postgres service and the production Redis password remaining mandatory.
- REFACTOR: focused ESLint passed for the three CI-reported files; the affected reconciler, Twilio media, and deployment suites passed with 46 tests; API typecheck, migration drift, Compose validation, and targeted `git diff --check` passed.
- The repository-wide local lint command remains obstructed only by the unrelated untracked `docs/system-design/system-design.js`; that file is not part of the candidate branch or PR.

## Pending Work

- Deploy the exact candidate release to two separate Coolify realtime-worker applications and capture evidence for unique worker/release identities, exact endpoints, heartbeat freshness, and slot accounting.
- Run deployed exact-worker ingress, sibling rejection, long-running WebSocket idle, serial drain-and-replace, forced deadline, abrupt worker-stop, and active-call API-restart scenarios.
- Run live OpenAI and Gemini provider smoke calls against the deployed candidate.
- Configure and exercise the documented OTel alerts in the staging observability backend.

## Risks

- Local tests cannot prove Coolify reverse-proxy WebSocket timeout, external routing affinity, process replacement order, or effective container file-descriptor limits.
- The checked-in Compose service remains the single-worker baseline; production HA depends on the documented pair of separately configured Coolify applications.
- Alert metric contracts exist in code, but alert delivery and paging remain unverified until the staging OTel backend is configured.

## Next Recommended Step

Obtain green candidate PR gates, then deploy without overlapping same-worker identities and execute the ISSUE-231 two-worker staging checklist before starting the blocked capacity control-surface issue.
