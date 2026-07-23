# ISSUE-225: Incremental telephony persistence contracts

- Status: In Progress
- External: [Linear ZAR-226](https://linear.app/zara-voice/issue/ZAR-226/pstn-capacity-412-expand-incremental-telephony-persistence-contracts)
- Parent: [Linear ZAR-223](https://linear.app/zara-voice/issue/ZAR-223/pstn-capacity-qualification-admission-control-and-horizontally)

## Work Completed

- Confirmed this ticket is an expansion-only persistence slice: existing snapshot callers remain unchanged until the dedicated webhook/session and lifecycle migration tickets.
- Chosen a separate typed incremental repository with database-enforced identities, explicit retry/conflict outcomes, versioned compare-and-swap transitions, and one atomic call-setup operation.
- Confirmed the existing execution-session row remains the single authoritative call lifecycle; a second lifecycle table would duplicate state and is intentionally not introduced.
- Started the RED/GREEN/REFACTOR pass for additive schema, migration, and Postgres-compatible repository coverage.
- Added a separate incremental repository for immutable webhook insertion, atomic call setup, versioned execution-lifecycle transitions, one-time media-token claim/expiry cleanup, and append-only phone-test checkpoints. No live caller or Nest provider uses it in this expansion slice.
- Added tenant-composite provider-event, dispatch, execution-session, and checkpoint identities, execution-session versions, durable media-token storage, normalized phone-test checkpoints, and persisted dispatch runtime paths.
- Matched media-token storage to Zara's production SHA-256 base64url contract, use the database clock for claim/expiry, and rotate an unclaimed token atomically when a committed call setup must be replayed after a lost response.
- Added explicit inserted/existing/conflict/not-found-style outcomes, strict failover and recording-consent retry comparison, terminal lifecycle protection, tenant-owned connection/number validation, and tenant-scoped expired-token cleanup.
- Added a duplicate-dispatch migration preflight, Drizzle snapshot parity, and an executable rollback runbook with duplicate checks before legacy uniqueness is restored.
- Added a pgvector-enabled PostgreSQL CI service that applies the real migration chain and runs same-key retry, competing-CAS, token rotation/claim/expiry, rollback, identical cross-tenant identity, failover-conflict, and ownership tests against PostgreSQL.
- Completed an independent principal-engineer review and corrected its production token, retry, tenant, dedupe, clock, conflict-comparison, migration, and PostgreSQL coverage findings.

## Tests Run

- RED: focused Vitest failed for the missing repository, missing schema tables/version, and missing migration.
- GREEN: `npm.cmd exec -- vitest run apps/api/src/telephony/postgres-telephony-incremental.repository.test.ts apps/api/src/telephony/postgres-telephony-state.repository.test.ts apps/api/src/database/schema.test.ts` - 3 files, 19 tests passed.
- GREEN: `npm.cmd exec -- vitest run apps/api/src/telephony/telephony.persistence.test.ts apps/api/src/telephony/telephony.controller.test.ts` - 2 files, 31 tests passed.
- GREEN: latest focused persistence run - 4 files passed, 30 tests passed; 8 real-PostgreSQL tests skipped because `ZARA_TEST_POSTGRES_URL` is not available locally.
- GREEN: `npm.cmd --workspace @zara/api run typecheck`.
- GREEN: focused ESLint for repository, tests, schema, and legacy runtime-path persistence.
- GREEN: `npm.cmd run db:generate` - no schema changes remained.
- GREEN: post-commit `npm.cmd run db:check` - migration generation is current with no tracked drift.
- PARTIAL: API-wide run passed 90 files and 688 tests; only the pre-existing fixed 20-second `production-esm-imports.test.ts` build scan timed out.

## Pending Work

- Push the commit so the PostgreSQL-backed migration and MVCC job can run in CI; the local machine has neither a PostgreSQL server nor a Docker daemon.
- Keep ZAR-226/ISSUE-225 In Progress until that real-Postgres CI job passes.
- Adopt the repository in ZAR-228 and ZAR-229, then remove live-call snapshot writes in ZAR-230. These migration tickets must ship as one release train so snapshot and incremental writes never run concurrently in production.

## Risks

- Registering or adopting the new repository in live paths during this ticket would mix expansion and migration and could create partial dual-write behavior.
- The existing snapshot save path still replaces tenant telephony rows; later migration tickets must remove it from live-call persistence before horizontal scaling is safe.
- Database emulators do not reproduce every Postgres locking behavior, so SQL must rely on portable unique constraints, transactions, and compare-and-swap predicates rather than process-local locks.
- Deploying ZAR-228 without ZAR-229 and ZAR-230 would let a remaining snapshot save cascade-delete incremental tokens/checkpoints or reset lifecycle state; partial mixed-mode deployment is prohibited.
- The local PostgreSQL integration suite is intentionally skipped without `ZARA_TEST_POSTGRES_URL`; CI is the required real-MVCC gate.
- A rollback after different tenants have reused the same provider/domain IDs is intentionally blocked by duplicate preflights because the legacy global primary keys cannot represent that valid expanded state.

## Decisions

- Keep the existing snapshot repository contract and its callers unchanged in this ticket.
- Create call dispatch, execution session, and hashed media credential in one transaction.
- Return explicit inserted/existing/conflict and transition/claim outcomes instead of relying on thrown unique-key errors for normal retries.
- Scope every read and mutation by tenant plus resource identity; cross-tenant probes return only a non-success outcome and never expose the foreign row.
- Use tenant-composite primary and foreign keys for dispatch, execution-session, webhook-event, and checkpoint storage so identical provider call identities remain independent across tenants without changing live domain IDs.
- Persist the initial dispatch/session recording-consent state and treat consent plus failover configuration as material idempotency fields.
- Preserve one authoritative execution-session lifecycle row and reject transitions out of terminal states.
- Treat provider receipt time and the legacy `duplicate` marker as local metadata, not immutable webhook identity.
- Store only the production 43-character base64url SHA-256 token hash and rotate it only while the previous token remains unclaimed.
- Keep the incremental repository unregistered until ZAR-228 begins the coordinated adoption train.

## Next Recommended Step

Run the PostgreSQL CI gate, then hand the verified contract to ZAR-228 for coordinated webhook/session-path adoption.
