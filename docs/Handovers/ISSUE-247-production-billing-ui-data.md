# ISSUE-247: Production billing data for tenant and platform displays

External: [Linear ZAR-268](https://linear.app/zara-voice/issue/ZAR-268/replace-hardcoded-tenant-and-platform-billing-displays-with-production)

## Status

Implemented. Charge delivery stays disabled. ISSUE-248 owns shadow qualification and controlled release.

## Work Completed

- Added a tenant-qualified Postgres billing read model for subscription, effective catalog, current cycle, ledger usage, budget policy, invoices, entitlements, and PAYG service credit.
- Added the approved $5 PAYG checkout from the current effective `credit_pack` mapping.
- Added paid, total, consumed, reserved, and available PAYG credit plus per-session debits.
- Required a paid order before credit is labelled paid. Promotional and manual grants remain available service credit but are not paid-pack credit.
- Made delivered outbox state authoritative for posted charges. Posted, shadow, blocked, and incomplete facts remain separate.
- Kept missing-price usage incomplete instead of showing a false USD 0.00 charge.
- Added honest no-subscription, no-plan-price, no-budget-policy, no-active-cycle, no-usage, and unknown-invoice states.
- Added currency-aware tenant billing and dashboard formatting.
- Added a guarded platform billing read API with tenant and aggregate Postgres projections.
- Replaced platform hardcoded spend, plan, budget, and PAYG values with delivered, shadow, incomplete, blocked, paid, total, consumed, reserved, and available values.
- Netted PAYG refunds per order so one refunded pack cannot erase another live pack.
- Disabled the legacy in-memory platform billing-control mutation until a durable writer exists. Read-only staff remain blocked.
- Removed the temporary workflow USD 80 budget and seeded sandbox spend/rate values.
- Labelled browser sandbox cost as non-billable. Missing estimates show `Estimate unavailable`.
- Replaced outbound placeholder budget evidence with durable server posture and removed client budget fields from server and web request contracts.
- Removed placeholder Polar product IDs and hardcoded subscription fee/included-unit tables from BillingService.
- Made checkout and webhook plan identity use current catalog and ledger mappings.
- Deleted three tracked local billing seed records that assigned fake subscriptions, usage, invoices, and provider IDs.
- Kept charge delivery disabled.

## Tests Run

- Tenant billing repository: 4 passed.
- Tenant billing/controller/dashboard/UI group: 26 passed.
- Billing controller catalog-mapping group: 18 passed.
- Platform billing repository/service/UI group: 12 passed.
- Platform controller regression: 10 passed. Read-only mutation is 403; unavailable durable mutation is 503.
- Workflow, default sandbox, and sandbox display tests: 8 passed.
- Web outbound billing-evidence regression: 1 passed.
- Core outbound durable budget policy test: 1 passed.
- API outbound durable budget policy test: 1 passed.
- Merged ISSUE-247 run: 53 passed; one unrelated Workflow Builder test timed out under grouped load and passed in isolation.
- Core build passed.
- API, tenant web, and platform-admin type checks passed.
- `git diff --check` passed before the final status update.
- Independent merged code review completed with no open finding.

## Pending Work

None for ISSUE-247.

## Risks

- New read-model SQL has contract and pg-mem coverage but was not run against an external PostgreSQL service in this local environment.
- When one billing class has mixed delivery states, the UI shows separate rows with the same metric label and explicit state text.
- Platform billing-control mutation is intentionally unavailable until a tenant-qualified durable writer and audit transaction exist.
- Charge delivery remains disabled until ISSUE-248 has canary evidence and recorded approval.

## Decisions

- Missing billing data is unavailable, not zero.
- Paid PAYG credit and total service credit are different values.
- A delivered outbox record, not ledger metadata, makes a charge posted.
- Browser sandbox use is non-billable in V1.
- Operational clients cannot submit budget evidence.
- Demo and marketing numbers cannot enter operational read models.

## Next Recommended Step

Start ISSUE-248 shadow qualification. Keep live charge delivery disabled until reconciliation, canary, drill, approval, and rollback evidence are complete.
