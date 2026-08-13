# ISSUE-246: Live budget reservations and charge finalization

External: [Linear ZAR-267](https://linear.app/zara-voice/issue/ZAR-267/enforce-live-budgets-with-charge-reservations-and-finalization)

## Status

Implemented. Charge delivery stays disabled. ISSUE-248 owns the controlled shadow-to-live release.

## Work Completed

- Added tenant-qualified, atomic PAYG and subscription call reservations.
- Added the single approved $5 PAYG credit-pack flow. A reservation cannot exceed paid available credit or create debt.
- Added the subscription funding order: included runtime, paid PAYG credit, then approved overage.
- Added tenant-wide serialization and budget checks across standard runtime, premium runtime, and platform telephony.
- Made start, release, finalization, and expiry use one database lock order.
- Added safe expiry, failed-start release, actual-use finalization, unused-value release, and idempotent replay.
- Pinned catalog, plan, commercial mode, route identity, rate, charge context, and terminal outcome to durable reservation records.
- Added durable terminal-recovery jobs with lease fencing, bounded retry, dead-letter alerts, and expiry protection.
- Connected live inbound, outbound, premium, terminal, and mid-call policy seams to durable billing authority.
- Replaced billing-cache authority with a durable commercial-mode and availability resolver.
- Added durable tenant-status authority. Public requests cannot supply billing, budget, clock, or tenant-security posture.
- Blocked standard PAYG calls until a production sandwich turn executor supplies the required safe segment boundary.
- Blocked platform-managed inbound calls until an approved V1 route identity exists.
- Kept funded active calls running against their own reservation. A call closes at the next safe boundary when its reservation cannot fund the next segment.
- Added recovery and reservation migrations through `0026_terminal_billing_recovery.sql`, guarded rollback files, snapshots, journal entries, and migration-check coverage.
- Added a worker-safe billing runtime module without delivery schedulers, outbox workers, or provider network clients.
- Added a traceable `premium.policy_stop_failed` event with retained reason and failure code.
- Kept Polar charge delivery disabled.

## Tests Run

- Subscription lifecycle and concurrency: 19 passed; 3 conditional PostgreSQL tests skipped because `ZARA_TEST_POSTGRES_URL` is not set.
- Durable commercial resolver: 1 passed, including cross-meter actual overage in both directions.
- Billing lifecycle, recovery, producer, and migration groups: 39 passed; 3 conditional PostgreSQL tests skipped.
- Worker production graph: 6 passed.
- Focused telephony admission, authority, active-call, terminal-recovery, setup-release, and replay groups passed after durable fixture corrections.
- Premium stop-failure emission test: 1 passed.
- PSTN trace-projection test: 1 passed.
- `npm.cmd run build --workspace @zara/core` passed.
- `npm.cmd run build:raw --workspace apps/api` passed.
- `npm.cmd run db:generate` reported no schema changes.
- `git diff --check` passed.
- Independent code review completed with no open finding.

## Pending Work

None for ISSUE-246.

## Risks

- Conditional real-PostgreSQL race and migration tests require `ZARA_TEST_POSTGRES_URL`; they were not run in this local environment.
- Standard PAYG calls remain unavailable until the production sandwich runtime has a trusted completed-turn boundary.
- Platform-managed inbound billing remains unavailable until an approved route exists in the price catalog.
- Live provider charge delivery remains disabled until ISSUE-248 has external canary evidence and recorded approval.

## Decisions

- Zara is the real-time billing authority, including when Polar is unavailable.
- New-call admission uses durable available value after active reservations, not a display cache.
- Active-call continuation uses the call's own durable reservation.
- Subscription overage limits are tenant-wide across all runtime meters.
- PAYG-netted subscription usage is recorded for audit but blocked from provider delivery until an atomic provider settlement exists.

## Next Recommended Step

Start ISSUE-247. Replace every operational billing display with tenant-qualified production read models and explicit empty states.
