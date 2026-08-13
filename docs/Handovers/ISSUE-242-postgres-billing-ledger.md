# ISSUE-242: Tenant-safe Postgres billing ledger and price-catalog persistence

External: [Linear ZAR-263](https://linear.app/zara-voice/issue/ZAR-263/build-the-tenant-safe-postgres-billing-ledger-and-price-catalog)

## Status

Implemented.

## Work Completed

- Added migration 0016 with tenant-owned billing customer, subscription, cycle, budget, entitlement, invoice, ledger, adjustment, PAYG order, PAYG credit, webhook, outbox, and read-model tables.
- Added global immutable price-catalog and Polar mapping tables.
- Added database immutability triggers for catalog, ledger, adjustment, and PAYG credit records.
- Added a guarded rollback that refuses to remove any populated billing table.
- Added a Postgres billing ledger repository with tenant-scoped reads, integer-value validation, catalog corruption checks, immutable catalog publication, and concurrent idempotency handling.
- Added the Postgres tenant billing read-model repository and production dependency wiring.
- Removed fake plan, subscription, usage, balance, invoice, entitlement, and checkout state for new tenants.
- Updated tenant billing and dashboard UI code to show the no-plan state safely.
- Replaced telephony and compliance test dependencies on production fake billing data with explicit test-only Growth subscriptions and premium entitlements.
- Verified migration apply, immutable triggers, guarded rollback, and empty rollback with PostgreSQL 16 in a temporary container.

## Tests Run

- `11` Postgres billing ledger repository tests passed.
- Focused billing, schema, migration, module, controller, and persistence run: `6` files and `26` tests passed.
- Tenant billing UI no-plan test passed.
- API and web TypeScript checks passed.
- API production build and production ESM import check passed.
- Real PostgreSQL 16 migration, immutable update rejection, populated rollback rejection, and empty rollback checks passed.
- Full API suite after the production build: `169` files and `1,111` tests passed; `3` files and `41` tests were skipped.

## Pending Work

- ISSUE-243 must connect trusted server usage facts to the ledger. Customer charges remain disabled.

## Risks

- The public read-model cache still contains legacy billing response shapes. It must never become the source of financial truth.
- Provider product and meter mappings must be validated before charge delivery is enabled in ISSUE-244.

## Decisions

- Production billing cannot use tenant JSON files as its source of truth.
- Money cannot use binary floating-point storage.
- The ledger must store paid PAYG orders, credit grants, reservations, debits, releases, refunds, reversals, and remaining balances as tenant-owned durable facts.
- Zero values in an unconfigured budget policy do not block telephony. Live credit and reservation enforcement belongs to ISSUE-246.
- The approved catalog and provider mapping configuration are global; all customer financial facts are tenant-owned.

## Next Recommended Step

Start ISSUE-243 with a failing trusted-usage producer test. Use the ledger repository and never accept a client-supplied price or charge amount.
