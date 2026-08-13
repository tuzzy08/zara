# ISSUE-245: Polar subscription, invoice, refund, and payment-state synchronization

External: [Linear ZAR-266](https://linear.app/zara-voice/issue/ZAR-266/harden-polar-subscription-invoice-refund-and-payment-state)

## Status

Implemented. ISSUE-241, ISSUE-242, and ISSUE-244 are implemented.

## Work Completed

- Created the Linear issue and local backlog record.
- Defined safe subscription states, orders, invoices, refunds, adjustments, entitlements, replay, ordering, and reconciliation scope.
- Started the implementation pass after the durable Polar outbox completed.
- Added an explicit fail-closed subscription projection for trialing, active, past-due grace, canceled, revoked, and unknown states.
- Added deterministic active-subscription selection by safe state, provider update time, and stable provider ID.
- Removed the legacy webhook fallback that converted unknown Polar states to `active`; the public billing state now reports `none` and denies access.
- Added tenant-owned Polar webhook receipts with payload hashes, processed state, exact replay detection, and changed-payload rejection.
- Proved that replay detection survives a billing-service restart without the old read-model replay list.
- Added monotonic subscription projection persistence so an older provider update cannot replace a newer state.
- Used Polar `modified_at` values to select the newest safe subscription when customer state contains more than one subscription.
- Added atomic paid-order and credit-grant persistence for only the configured `credit_pack:payg-5-usd` product.
- Enforced the approved USD 500-cent payment and one 500-cent non-cash credit grant.
- Added idempotent refund reversal for one unused $5 pack and FIFO consumption checks that reject refunding a used pack.
- Updated PAYG balance reconciliation so refund reversals remove credit.
- Connected Polar `order.refunded` to the durable PAYG refund operation with product mapping, USD currency, full 500-cent amount, and tenant checks.
- Added exact refund replay protection and rejected partial refund events before credit reversal.
- Added Polar customer-state lookup by external tenant ID through the provider client.
- Registered checkout tenants as durable reconciliation targets before the local checkout state commits.
- Added scheduled reconciliation at startup and every 15 minutes with overlap prevention and clean shutdown.
- Added monotonic missed-subscription repair and a tenant-owned system audit entry for each changed state.
- Added missed-cancellation repair that revokes a local active subscription when it is absent from full Polar customer state.
- Added mapped entitlement projection and revocation in the same customer-state transaction.
- Added unchanged-state idempotency so a clean reconciliation pass creates no repair or audit entry.
- Connected `customer.state_changed` to the atomic durable customer, subscription, and entitlement projection.
- Added catalog validation for webhook product and benefit identifiers before durable storage.
- Kept durable projection completion before webhook receipt completion, so a failed projection cannot be acknowledged as processed.
- Added a durable tenant invoice projection for Polar `order.paid` in one database transaction.
- Validated the official Polar `paid`, `status`, `currency`, `total_amount`, `invoice_number`, and `created_at` fields before invoice storage.
- Added a stable invoice ID and provider-order uniqueness so an exact order replay changes nothing and changed order data is rejected.
- Kept invoice projection and all billing delivery in shadow posture; this pass does not enable customer charges.
- Connected Polar `subscription.past_due`, the official recoverable payment-failure event, to the durable subscription projection.
- Validated payment-failure customer ownership, product mapping, `past_due` status, USD integer amount, and provider timestamps before storage.
- Kept payment-failure updates monotonic by using the existing provider `modified_at` ordering rule.
- Updated the public billing state to `past_due`; the durable provider update time is the start point for the approved 72-hour BYO grace policy.
- Added an authoritative runtime-access query over the durable subscription projection.
- Blocked platform-managed PSTN activation and new calls as soon as payment becomes `past_due`.
- Allowed BYO provider accounts and BYO SIP trunks during the exact 72-hour payment grace period only.
- Made missing billing state and missing telephony ownership fail closed.
- Connected route activation, route resume, new inbound calls, and active-call policy checks to the durable access query.
- Preserved the real `past_due` state while the explicit BYO access result permits runtime during grace.
- Used durable execution-session ownership for active-call payment checks. Active platform calls use the existing short wind-down policy.
- Added an approved append-only credit or debit adjustment projection that refers to one original tenant ledger entry.
- Stored the adjustment approval and its correction ledger fact in one transaction.
- Rejected changed adjustment replay data and cross-tenant original-ledger references.
- Kept adjustments in shadow posture as durable inputs for ISSUE-246 budget enforcement and ISSUE-247 read models.

## Tests Run

- RED: the subscription policy test failed because the policy module did not exist.
- GREEN: the subscription policy tests pass: 3 tests.
- RED: the controller test proved that an unknown provider state became `active`.
- GREEN: the focused unknown-state controller test passes after the fail-closed fallback change.
- `npm.cmd test -- --run apps/api/src/billing` - passed: 11 files, 55 tests.
- `npm.cmd run build --workspace @zara/api` - passed.
- RED/GREEN: the approved-adjustment test first failed because no adjustment repository operation existed, then passed for atomic storage, exact replay, changed replay rejection, and tenant isolation.
- Latest `npx.cmd vitest run apps/api/src/billing --reporter=dot --maxWorkers=1` - passed: 14 files, 71 tests.
- Latest `npm.cmd run build --workspace @zara/api` - passed after the adjustment projection change.
- RED/GREEN: webhook receipt tests failed before durable receipt methods existed, then passed for exact replay, processed state, and changed-payload rejection.
- RED/GREEN: the restart replay route returned `201` before durable receipt integration and now returns the idempotent `200` replay result.
- RED/GREEN: multiple-subscription selection first chose the stale first item and now chooses the newest safe Polar subscription.
- RED/GREEN: the PAYG paid-order test first returned `404` because the credit-pack product was treated as a subscription, then passed through the configured credit-pack mapping.
- RED/GREEN: paid pack, refund reversal, and reversed-balance tests now pass.
- RED/GREEN: the public `order.refunded` test first returned `400`, then created one durable reversal after the webhook handler was added.
- RED/GREEN: the reconciliation service test first failed because the service did not exist, then repaired a missed `past_due` to `active` update and recorded the audit entry.
- RED/GREEN: the checkout test first showed no durable reconciliation target, then passed after tenant account registration.
- RED/GREEN: the scheduler test first failed because the scheduler did not exist, then passed for startup, 15-minute recurrence, and shutdown.
- RED/GREEN: the missed-cancellation check first left the local subscription active, then passed after tenant-scoped revocation was added to the transaction.
- RED/GREEN: the entitlement check first failed because no entitlement projection API existed, then passed for active grant and later revocation.
- RED/GREEN: the unchanged third pass first reported another repair, then passed after change detection stopped relying on upsert row counts.
- RED/GREEN: the public customer-state webhook test first left the durable projection empty, then passed after catalog mapping and transaction integration.
- The full billing run exposed an older multiple-subscription fixture without the required Polar customer ID and starter mapping; the provider-contract fixture was corrected and the suite returned to green.
- Latest `npx.cmd vitest run apps/api/src/billing --reporter=dot --maxWorkers=1` - passed: 13 files, 66 tests.
- Latest `npm.cmd run build --workspace @zara/api` - passed.
- RED/GREEN: the public order webhook test first completed without a durable invoice, then passed after the invoice projection was connected.
- RED/GREEN: the repository test first failed because the invoice projection method did not exist, then passed for one insert, exact replay, and changed-data rejection.
- Latest `npx.cmd vitest run apps/api/src/billing --reporter=dot --maxWorkers=1` - passed: 13 files, 67 tests.
- Latest `npm.cmd run build --workspace @zara/api` - passed after the invoice projection change.
- RED/GREEN: the public payment-failure test first returned `400`, then passed after `subscription.past_due` support was added.
- Latest `npx.cmd vitest run apps/api/src/billing --reporter=dot --maxWorkers=1` - passed: 13 files, 68 tests.
- Latest `npm.cmd run build --workspace @zara/api` - passed after the payment-failure projection change.
- RED/GREEN: the durable runtime-access test first failed because no authoritative access query existed, then passed for immediate platform blocking and the exact BYO 72-hour boundary.
- RED/GREEN: the core BYO grace test first blocked `past_due`, then passed when an explicit durable access result became part of the policy.
- RED/GREEN: the new inbound-call test first returned unavailable TwiML, then routed during valid BYO payment grace.
- RED/GREEN: the active-call ownership test first used the BYO default for a platform session, then used the durable session ownership and the platform access context.
- `npx.cmd vitest run apps/api/src/billing --reporter=dot --maxWorkers=1` - passed: 14 files, 70 tests.
- `npx.cmd vitest run packages/core/src/telephony.test.ts --reporter=dot --maxWorkers=1` - passed: 1 file, 23 tests.
- `npx.cmd vitest run apps/api/src/telephony/telephony-inbound-incremental.test.ts --reporter=dot --maxWorkers=1` - passed: 1 file, 50 tests.
- `npm.cmd run build --workspace @zara/core` - passed.
- `npm.cmd run build --workspace @zara/api` - passed.

## Pending Work

- None for ISSUE-245.

## Risks

- Customer charge delivery remains disabled until ISSUE-248 completes the approved shadow-to-live release gates.

## Decisions

- Unknown provider states never become active by default.
- Scheduled reconciliation is required in addition to webhooks.
- One-time PAYG credit-pack orders and refunds must update durable credit state exactly once.

## Next Recommended Step

Start ISSUE-246 with the RED concurrent PAYG reservation test. The reservation must consume durable credit, refund, reversal, and adjustment facts without permitting unpaid overage.
