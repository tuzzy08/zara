# ISSUE-244: Durable Polar billing outbox and reconciliation

External: [Linear ZAR-265](https://linear.app/zara-voice/issue/ZAR-265/deliver-billing-events-through-a-durable-polar-outbox-and)

## Status

Implemented. ISSUE-241 through ISSUE-244 are implemented. Customer charge delivery stays disabled until ISSUE-248 records a release decision.

## Work Completed

- Created the Linear issue and local backlog record.
- Defined transactional delivery, stable event IDs, retry, dead-letter, replay, config validation, and reconciliation scope.
- Started the implementation pass after the trusted ledger producer became available.
- Confirmed that customer charge delivery must remain disabled during this slice.
- Added an atomic repository operation that commits one ledger fact and its outbox row in one Postgres transaction.
- Added tenant-scoped outbox reads and stable external event payloads for subscription usage.
- Connected complete subscription shadow facts to the atomic outbox path.
- Kept incomplete, non-billable, and PAYG usage facts out of the subscription meter path. PAYG still requires one `payg_charge_minor` session debit.
- Added a bounded Polar outbox worker seam with stable external IDs, successful delivery state, exponential retry, and preserved ledger facts during Polar outages.
- Added processing leases and automatic recovery for rows left by a crashed worker.
- Added bounded dead-letter state after the configured attempt limit.
- Added tenant-scoped operator replay with successful and rejected audit records.
- Added fail-closed production configuration checks for the Polar token, production server, webhook secret, catalog, products, prices, benefits, credit pack, and all four approved meters.
- Registered the worker and replay service in `BillingModule`. Delivery is disabled by default.
- Added one atomic PAYG repository operation that commits the durable session debit and one credits-only outbox event in the same transaction.
- Added `session_id` to PAYG credit entries through migration `0017_sparkling_blackheart.sql`.
- Restricted PAYG delivery to the `payg_charge_minor` meter. The event includes stable credit-entry and session IDs and does not send the subscription usage meters.
- Added tenant-cycle reconciliation for missing, duplicate, late, and quantity-mismatched Polar events.
- Added PAYG reconciliation for the durable $5 grant, session debits, local balance, and Polar meter balance.
- Added a 30-second application lifecycle scheduler. It prevents overlapping passes and waits for an active pass during shutdown.
- Added low-cardinality counters and fixed alert signals for dead-letter delivery and late reconciliation events. Metric dimensions do not contain tenant or event IDs.

## Tests Run

- RED: repository test failed because `appendLedgerEntryWithOutbox` did not exist.
- GREEN: `npm.cmd test -- --run apps/api/src/billing/postgres-billing-ledger.repository.test.ts` - passed: 13 tests.
- RED: trusted producer test failed because no outbox events existed.
- GREEN: the focused trusted producer transaction test passed.
- RED: worker test failed because the worker module did not exist.
- GREEN: the worker delivery test passed.
- RED: outage test failed because the Polar error escaped the worker.
- GREEN: worker delivery and retry tests passed: 2 tests.
- `npm.cmd test -- --run apps/api/src/billing` - passed: 6 files, 38 tests.
- `npm.cmd run build --workspace @zara/api` - passed.
- RED/GREEN: stale processing claim recovery test now passes.
- RED/GREEN: dead-letter and audited replay test now passes.
- RED/GREEN: rejected cross-tenant replay audit test now passes.
- RED/GREEN: four production configuration validation tests now pass.
- RED/GREEN: production module registration test now passes.
- RED/GREEN: the PAYG repository test failed before `appendPaygSessionDebitWithOutbox` and now proves one idempotent debit and outbox commit.
- RED/GREEN: the PAYG worker test first retried the event because it required subscription metadata, then passed with the credits-only contract.
- RED/GREEN: tenant-cycle and PAYG balance reconciliation tests now pass.
- RED/GREEN: the scheduler test first failed because the scheduler did not exist, then passed after lifecycle scheduling was added.
- RED/GREEN: the module test first failed because the scheduler was not registered, then passed after production registration.
- RED/GREEN: the observability test first failed because the observability module did not exist, then passed with delivery, reconciliation, and alert counters.
- RED/GREEN: worker and reconciliation tests first showed no observability activity, then passed after production integration.
- `npm.cmd test -- --run apps/api/src/database/billing-schema.test.ts apps/api/src/billing` - passed: 11 files, 53 tests.
- `npm.cmd run build --workspace @zara/api` - passed.
- `npm.cmd run test:api` - passed: 174 files and 1,139 tests; 3 files and 41 tests skipped by the configured layer.
- `git diff --check` - passed with line-ending warnings only.

## Pending Work

- No ISSUE-244 acceptance work remains.
- ISSUE-245 must add Polar order, subscription, invoice, refund, webhook, and customer-state synchronization.

## Risks

- Production delivery has not been enabled or qualified. ISSUE-248 owns the shadow-to-live release decision.
- Late delivery can move usage into a later Polar billing cycle. Reconciliation reports this class but does not repair it automatically.
- Replay audit and outbox state are not one database transaction because the current audit repository is a separate boundary.

## Decisions

- Local ledger commit is authoritative.
- Polar delivery uses a durable outbox and never runs as the only copy of a usage fact.
- Credits-only PAYG debit events use the same durable outbox and reconcile to Zara session debits and Polar meter balances.
- Subscription usage and PAYG session debits must not share the same Polar meter contract.
- Shadow outbox rows can be created, but production delivery remains disabled until the release gate.

## Next Recommended Step

Start ISSUE-245 with RED webhook idempotency and out-of-order payment-state tests. Keep customer charge delivery disabled.
