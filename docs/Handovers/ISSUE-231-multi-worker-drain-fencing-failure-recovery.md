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
- Corrected sandbox runtime module ownership: `SandboxLiveSessionsModule` now re-exports the owning tool-execution module instead of directly exporting its provider, and retains the integration control/runtime module required by sandbox grant APIs and checks.
- Kept compliance controller tests isolated from production PostgreSQL by overriding the incremental telephony repository with the existing in-memory implementation and synchronizing projections when test configuration state is saved.
- Stabilized Twilio capacity verification by waiting for the server-side local-close accounting callback after the client observes socket closure; production socket ordering remains unchanged.
- Closed final review findings before replacement-branch commit: mapped all four production-required admission CPS variables into the realtime worker, exposed tracked reservation and pending-release posture to the load harness, and aligned canonical Redis-outage language with the last-confirmed-lease fencing decision.
- Closed the standards re-review follow-ups: sandwich media now obeys the same lease-expiry fail-stop contract as premium media, separate Dockerfile worker documentation names `PSTN_WORKER_PUBLIC_MEDIA_URL`, and the ISSUE-229 handover no longer promises unfenced outage continuity.

## Tests Run

- `npm.cmd run typecheck --workspace=@zara/api` passed.
- Focused schema, worker host/lifecycle/module/reconciler, observability, repository, admission, premium execution, Twilio media, and deployment-documentation suite passed: 202 tests across 11 files.
- Real PostgreSQL incremental repository qualification passed: 22 tests, including concurrent stale-owner reconciliation.
- Redis client, admission unit, and two-client real-Redis qualification passed: 39 tests.
- `npm.cmd run eval:pstn` passed: 25 tests.
- `docker compose -f compose.coolify.yml config --quiet` passed after programmatically populating all 22 required variables with validation-only values.
- Targeted `git diff --check` passed.
- GitHub PR #120 head `2c283bd` passed quality gates, migration compatibility and rollback, GitGuardian, and Vercel.
- RED: `npm.cmd exec -- vitest run apps/api/src/database/telephony-migration-rollback-chain.test.ts` failed with `ENOENT` for the missing rollback-0015 runbook. The fresh-database rollback workflow then reproduced the production dependency failure when rollback 0009 tried to drop the tenant session identity index while the premium dispatch snapshot foreign key still depended on it.
- GREEN: `npm.cmd exec -- vitest run apps/api/src/database/telephony-migration-rollback-chain.test.ts` passed after adding rollback 0015 and 0014 in strict reverse order.
- REFACTOR: strengthened the regression to assert actual rollback execution order and the premium snapshot postcondition; the focused test and `npm.cmd exec -- eslint apps/api/src/database/telephony-migration-rollback-chain.test.ts` passed.
- GREEN: the full local migration workflow passed on isolated PostgreSQL databases: fresh migration, 26 migration/PostgreSQL tests, rollback through 0015 to 0009, and legacy compatibility validation.
- RED: `npm.cmd exec -- vitest run packages/core/src/deployment-docs.test.ts -t "migration CI database fixture"` failed because the migration workflow did not contain isolated `POSTGRES_HOST_AUTH_METHOD: trust` and still embedded the fixed fixture password.
- RED: `npm.cmd exec -- vitest run packages/core/src/deployment-docs.test.ts -t "production Redis fail-closed"` failed because the Coolify Redis requirement still used scanner-hostile placeholder copy instead of the required fail-closed form.
- GREEN: the deployment contract passed with passwordless trust authentication limited to the ephemeral GitHub Postgres service and the production Redis password remaining mandatory.
- REFACTOR: focused ESLint passed for the three CI-reported files; the affected reconciler, Twilio media, and deployment suites passed with 46 tests; API typecheck, migration drift, Compose validation, and targeted `git diff --check` passed.
- RED: PR #119 full-suite CI failed 95 startup tests because `SandboxLiveSessionsModule` exported a provider owned by another module and omitted the integration module required by direct sandbox dependencies.
- GREEN: runtime tool module and app-module verification passed with 13 tests after restoring Nest module ownership and imports.
- RED: the first full clean-candidate run exposed 9 sandbox WebSocket tests returning `404` from integration grant setup because the sandbox module retained runtime services but not the integration controller module.
- GREEN: the sandbox module now imports `IntegrationsModule`, which re-exports runtime grants while preserving the control-plane routes used by sandbox integration setup.
- RED: the compliance controller suite failed 2 of 4 tests when its test module resolved the production incremental PostgreSQL repository during live-route activation.
- GREEN: the compliance controller suite passed 4 tests and the telephony controller regression suite passed 24 tests with the in-memory incremental override.
- RED: PR #119 full-suite CI observed the client close before the server capacity callback, so the Twilio test inspected events before `close:local` was recorded.
- GREEN: the Twilio websocket suite passed 32 tests, and the concurrent telephony/capacity regression set passed 386 tests with 37 environment-gated skips after adding the bounded wait.
- The clean replacement candidate full-suite run reached 1,527 passing tests with 41 environment-gated skips; 12 tests exceeded their five-second timeout under parallel Windows host pressure. Every affected test passed when rerun with one worker: 38 tests across five focused files and 99 tests across the two heavier web files.
- `npm.cmd run lint`, `npm.cmd run typecheck`, and `npm.cmd run db:check` passed for the clean replacement candidate.
- `npm.cmd run eval:runtime` passed: 5 tests.
- `npm.cmd run eval:pstn` passed: 25 tests.
- The real-Redis suite was selected locally but skipped its 15 tests because `ZARA_TEST_REDIS_URL` is not configured in this shell; PR #120's CI quality gate supplied Redis and passed the authoritative integration result.
- `docker compose -f compose.coolify.yml config --quiet` passed after populating every required variable with validation-only process values.
- Final `git diff --check` passed.
- RED: final spec review found that production worker Compose omitted the four required admission CPS variables and that drain recovery ignored reservation debt; standards review found canonical docs still promised media survival beyond the last confirmed lease.
- GREEN: production worker compilation, deployment contracts, admission posture propagation, capacity client validation, and reservation-debt drain rejection passed in a focused 80-test suite.
- GREEN: the broader simulator, capacity, platform-admin, worker, and admission regression set passed 134 tests across 18 files.
- REFACTOR: full lint, full typecheck, schema drift, deployment contracts, runtime evals (5), PSTN evals (25), and Compose validation with all 22 required variables passed.
- RED: standards re-review found sandwich ownership loss was ignored, the separate-worker deployment guide named only the Compose URL alias, and ISSUE-229 retained superseded outage wording.
- GREEN: focused premium/sandwich ownership-loss and Dockerfile-worker documentation contracts passed; the final eight-file regression set passed 122 tests.
- REFACTOR: full lint and full typecheck passed after the ownership-loss and deployment-documentation corrections.

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

Deploy PR #120 head `2c283bd` without overlapping same-worker identities and execute the ISSUE-231 two-worker staging checklist before starting the blocked capacity control-surface issue.
