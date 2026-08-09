# ISSUE-228: Contract live-call snapshot persistence

- Status: Implemented
- External: [Linear ZAR-230](https://linear.app/zara-voice/issue/ZAR-230/pstn-capacity-712-contract-whole-tenant-persistence-out-of-the-live)
- Parent: [Linear ZAR-223](https://linear.app/zara-voice/issue/ZAR-223/pstn-capacity-qualification-admission-control-and-horizontally)

## Work Completed

- Contracted inbound and outbound dispatch, Twilio webhook replay, call setup, media authorization, phone-test projection/checkpoints, call controls, lifecycle and policy transitions, status callbacks, handoff, fallback, and termination onto tenant-and-call scoped incremental repository methods.
- Removed runtime-row replacement from the Postgres snapshot repository. The remaining queue and method are explicitly configuration-only.
- Added atomic connection, imported-number, and retention deletion operations with tenant isolation and dependent-row handling.
- Added tenant-composite identities for execution commands and call-control events, plus migration `0011_telephony_tenant_composite_identities.sql` and its guarded rollback.
- Retained the obsolete processed-webhook compatibility table through migration `0012_superb_stellaris.sql` so the immediately preceding application revision remains operable during a rolling deploy. Its rollback is now a matching no-op.
- Added migration `0013_telephony_outbound_abuse_posture.sql` to repair databases where the original destructive `0012` already ran and to add the durable outbound-abuse ownership marker.
- Added explicit safe rollbacks through `0013`. Migration CI now executes strict reverse order `0013`, `0012`, `0011`, `0010`, then `0009`. The `0011` rollback locks both command/control tables in one transaction, rejects cross-tenant duplicate IDs before restoring global primary keys, and the CI compatibility probe verifies both restored key shapes plus previous-revision command and control writes.
- Prevented configuration snapshots from updating incrementally owned `test_route` and `phone_test_results` columns on existing phone numbers while preserving inserts and legitimate configuration-field updates.
- Prevented configuration saves and healthy provider heartbeats from undoing an atomic outbound-abuse `disabled`/`failed` posture. The database-owned `outbound_abuse_blocked` marker is set in the same transaction as the blocked dispatch.
- Prevented a stale replica from queuing outbound work after that durable pause by locking and checking the tenant-owned connection row before creating any outbound dispatch, session, or command.
- Moved phone-test start and completion off whole-tenant snapshot saves onto the incrementally owned phone-number projection with compare-and-swap conflict handling. In-memory state changes only after the durable projection accepts the transition, and provider termination follows the durable completion.
- Added pool acquisition, transaction duration, row-lock wait, deadlock, and accepted-retry observability without making exporter failure fatal.
- Fixed isolated inbound projection commit so unauthorized or expired phone-test attempts that fall back to a live route return the durable phone-test result rather than stale state.
- Added dependency guards preventing live-call entry points from invoking snapshot persistence or restoring legacy token/webhook fallback state.
- Qualified 50 concurrent calls for one tenant plus 10 concurrent calls for another tenant against real Postgres, including identity isolation, monotonic terminal lifecycle, idempotent replay, and number/checkpoint cascade.
- Replaced provider validation and heartbeat aggregate saves with one tenant-scoped transactional health observation that updates connection posture and inserts health/heartbeat rows without touching live-call rows.
- Preserved the durable outbound-abuse block when a healthy observation arrives and returned the effective database posture to the in-process projection.
- Removed retention cleanup's unnecessary whole-tenant save; the explicit tenant-scoped deletion operation is now its sole durable mutation.
- Ensured failures after durable inbound call setup terminalize the persisted call before returning safe unavailable TwiML.
- Restricted retention to terminal execution sessions whose durable `updated_at` predates the cutoff; old active calls and their webhook events, controls, commands, tokens, and dispatches remain intact.
- Bound webhook retention to the same eligible terminal call graph, while allowing an old blocked dispatch and its webhook to be removed without a session; webhook events for old active calls remain intact.
- Added a tenant-scoped incremental read for connection admission posture so live inbound admission consults the current durable connection row instead of a process-local snapshot.
- Prevented configuration snapshots from overwriting database-owned provider `status` and `health_status` on existing connections, so a stale replica cannot reopen admission after a newer blocking health observation.
- Aligned the in-process retention projection with durable terminal-only eligibility instead of removing every old call row by timestamp.

## Tests Run

- RED: `node_modules\.bin\vitest.cmd run apps/api/src/telephony/postgres-telephony-state.repository.test.ts` failed exactly two new stale-snapshot tests: phone-test state was erased and abuse-disabled connections were restored to active/healthy.
- RED: `node_modules\.bin\vitest.cmd run apps/api/src/database/schema.test.ts` failed because the schema lacked `outboundAbuseBlocked` and migration `0012` still dropped the compatibility table.
- RED: `ZARA_TEST_POSTGRES_URL=... vitest run apps/api/src/database/migration-0012-rolling.postgres.test.ts` failed the recovery case because migration `0013` did not recreate a table already dropped by the original `0012`.
- RED: focused phone-test service and persistence tests failed four assertions because start/completion still invoked snapshot persistence and stale completion conflicts were not surfaced.
- RED: `npm.cmd exec -- vitest run apps/api/src/database/schema.test.ts` failed 1 of 11 tests because the required `rollback-0013-telephony-outbound-abuse-posture.sql` artifact did not exist.
- RED: with `ZARA_TEST_POSTGRES_URL` pointing at the isolated test database, `npm.cmd exec -- vitest run apps/api/src/database/migration-0012-rolling.postgres.test.ts` failed 1 of 3 tests for the same missing rollback artifact, after the other two real-Postgres rolling compatibility cases passed.
- RED: `npm.cmd exec -- vitest run apps/api/src/database/schema.test.ts` failed 1 of 11 tests at the expected missing `rollback-0011-telephony-tenant-composite-identities.sql` workflow reference, proving migration CI skipped `0011`.
- RED: the outbound service/repository suites failed two stale-replica cases, and the real-Postgres suite failed one row-lock race, before execution creation checked the durable abuse marker.
- GREEN/REFACTOR: focused schema, snapshot, incremental repository, and telephony persistence suite: 48 passed.
- GREEN/REFACTOR: phone-test incremental service and persistence suites: 38 passed after start/completion switched to row-owned projection updates.
- GREEN/REFACTOR: real Postgres migration compatibility and incremental repository suites: 18 passed, including stale configuration ownership, 50 same-tenant plus 10 cross-tenant calls, strict reverse-order rollback through `0011`, migration/rollback write compatibility, safe `0013` rollback, and recovery after the original destructive migration.
- GREEN/REFACTOR: `npm.cmd exec -- vitest run apps/api/src/database/schema.test.ts` passed all 11 tests after the rollback contract and reverse-order CI assertions were implemented.
- GREEN/REFACTOR: the real-Postgres migration compatibility suite passed all 3 tests against `zara_test`, including rejection of an active abuse block, removal of only the cleared marker, a successful previous-revision write to the retained compatibility table, and restoration of migration `0013` during cleanup.
- GREEN/REFACTOR: with `ZARA_TEST_POSTGRES_URL` pointing at the isolated test database, `npm.cmd exec -- vitest run apps/api/src/database/schema.test.ts apps/api/src/database/migration-0012-rolling.postgres.test.ts` passed 2 files and 15 tests, including strict `0013 -> 0012 -> 0011 -> 0010 -> 0009` workflow order, atomic guarded `0011` rollback, exact global primary-key restoration, previous-revision command/control writes, and current-schema restoration during test cleanup.
- GREEN/REFACTOR: applied the full migration chain through `0013` to a fresh disposable Postgres database, extracted and executed the actual Node rollback program embedded in `.github/workflows/migration-check.yml`, and completed its strict reverse-order rollback plus previous-revision compatibility assertions successfully.
- GREEN/REFACTOR: focused ESLint and `git diff --check` passed for the migration rollback remediation.
- GREEN: fresh real-Postgres migration chain through `0013`: passed with `npm run db:migrate`.
- GREEN: API TypeScript check passed with `npm run typecheck --workspace @zara/api`.
- GREEN: Drizzle generation reported no remaining schema changes with `npm run db:generate`.
- Real Postgres incremental repository: 14 passed, including 50 same-tenant plus 10 cross-tenant calls.
- GREEN/REFACTOR: the focused repository/service suites passed 73 tests and the real-Postgres repository suite passed 16 tests after the cross-replica outbound guard was added.
- Final real-Postgres migration and repository qualification: 2 files and 20 tests passed.
- Real migration application: migrations `0011`, `0012`, and `0013` applied successfully.
- Real rollback application: rollback scripts for `0013`, `0012`, `0011`, `0010`, then `0009` applied successfully through the actual CI program.
- Focused persistence and schema suite: 77 passed.
- Incremental repository, inbound, and persistence regression suite after final review: 49 passed.
- Telephony suite: 175 passed and 13 real-Postgres tests skipped in the non-DB run; one auth test exceeded the machine-constrained default five-second timeout and passed alone with a 30-second ceiling.
- Telephony controller suite: 22 passed.
- API TypeScript check: passed with `tsc -p apps/api/tsconfig.json`.
- Focused ESLint pass: passed after removing unused helper bindings.
- Drizzle generation: no unexplained schema drift after migration generation.
- Final integrated review-remediation qualification:
  - the 20-file changed surface passed 278 tests against real Redis 7 and PostgreSQL 16 with pgvector;
  - the focused file-backed persistence suite passed 9 tests after its incremental-repository fixture was aligned with production ownership;
  - API TypeScript, three focused ESLint batches, `git diff --check`, and Drizzle generation passed;
  - Drizzle reported no schema changes.
- Staged-review remediation qualification:
  - the complete 28-file telephony suite contributed 351 tests to a 31-file, 387-test qualification with real Redis 7 and PostgreSQL 16 enabled;
  - retention regression coverage proves that an expired terminal call graph and an old blocked dispatch are removed while an older active graph and its webhook remain addressable;
  - real-Postgres retention coverage proves routed pre-session dispatches and other-tenant rows remain addressable while terminal graphs and genuinely blocked orphan dispatches are removed;
  - stale configuration regression coverage proves provider labels still update while newer blocking provider health remains authoritative;
  - configuration snapshots no longer delete or insert incrementally owned health checks or provider heartbeats; stale and omitted evidence leaves the operational rows unchanged while credentials and provider labels remain configuration-owned;
  - fresh tenant-scoped provider posture is covered in both the Postgres repository and inbound admission suites;
  - API TypeScript, focused ESLint, and `git diff --check` passed.

## Pending Work

- Run the exact migration-check and API CI jobs after integration.
- Do not remove `telephony_processed_webhook_events` until the immediately preceding application revision is outside the rolling-deploy and rollback window.

## Risks

- The legacy snapshot repository still serves configuration workflows and cannot be removed wholesale.
- `outbound_abuse_blocked` deliberately has no ordinary configuration or heartbeat clearing path. A future reviewed platform-admin reinstatement operation must clear the marker explicitly in the same transaction as restoring connection posture.
- Rolling back `0013` is intentionally blocked while any connection has `outbound_abuse_blocked = true`; the operator must review and explicitly clear or otherwise resolve those abuse postures before retrying rollback.
- The retained processed-webhook table is compatibility-only and receives no writes from the current revision; `telephony_webhook_events` remains the sole current runtime authority.
- This remediation establishes durable database ownership. Outbound execution creation now rechecks the abuse marker under a row lock; other configuration projections still do not use general cross-process cache invalidation.
- The full serial telephony run is sensitive to local machine pressure; its only timeout passed on an isolated rerun and did not expose a behavioral failure.
- This qualification proves persistence correctness at the tested concurrency. It does not certify end-to-end media capacity, CPU headroom, provider quotas, or a production admission limit.

## Decisions

- No dual-write or snapshot fallback is allowed on a migrated live-call path.
- Database rows, uniqueness constraints, transactions, and compare-and-swap transitions are the concurrency authority.
- In-memory state may remain a read projection for the current process but is not durable authority for active-call mutations.
- `telephony_webhook_events` is the single durable webhook deduplication authority.
- Retry counters attach to the accepted transaction so compare-and-swap rollback attempts do not inflate the metric.
- Phone-test `test_route` and `phone_test_results` columns are insertable by configuration persistence for new numbers but incrementally owned thereafter.
- Outbound-abuse status and health posture are database-owned while the abuse marker is set; ordinary provider health observations use the tenant-scoped transactional operation and cannot reactivate the connection.
- Historical migration `0012` is non-destructive. Additive migration `0013` repairs already-affected databases without restoring obsolete rows.
- Migration rollbacks execute in strict reverse order. The `0013` rollback preserves `telephony_processed_webhook_events` for the previous application revision and drops only `telephony_connections.outbound_abuse_blocked` after a locked safety preflight.
- The `0011` rollback acquires both affected table locks before duplicate-ID preflight and restores both primary keys in one transaction; any unsafe identity state aborts the whole rollback.

## Next Recommended Step

Deploy through migration `0013`, verify the compatibility table and abuse marker exist, and defer final compatibility-table removal to a later release after the rollback window closes.
