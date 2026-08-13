# ISSUE-243: Trusted runtime and telephony billing usage producers

External: [Linear ZAR-264](https://linear.app/zara-voice/issue/ZAR-264/connect-trusted-runtime-and-telephony-usage-to-the-billing-ledger)

## Status

Implemented. ISSUE-241 and ISSUE-242 are implemented. Customer charge delivery remains in shadow mode until ISSUE-248.

## Work Completed

- Added `TrustedBillingUsageProducer` as the server-owned billing fact boundary.
- Connected persisted terminal telephony states to the trusted producer.
- Added standard runtime, premium runtime, platform carrier, BYO, browser sandbox, and phone-test classifications.
- Added subscription and PAYG price resolution from the effective immutable catalog. PAYG uses the single approved $5 credit pack model.
- Added stable tenant-qualified ledger IDs and idempotency keys for duplicate terminal callbacks.
- Added platform carrier minute rounding per route. Runtime usage remains in seconds.
- Added explicit zero-charge facts for failed calls that never connect.
- Added incomplete facts for missing catalog, rate, route, or provider duration data.
- Kept customer charge and supplier cost data separate and set charge delivery to `shadow`.
- Disabled the legacy tenant usage mutation routes in the production module graph. They return `404` unless a focused legacy test fixture enables them.
- Added effective price-catalog lookup to the Postgres billing ledger repository.

## Tests Run

- `npm.cmd test -- --run apps/api/src/billing apps/api/src/telephony/telephony-inbound-incremental.test.ts` - passed: 6 files, 81 tests.
- `npm.cmd test -- --run apps/api/src/telephony/telephony.controller-premium-phone-test.test.ts apps/api/src/telephony/twilio-media-streams.websocket.test.ts` - passed: 2 files, 39 tests.
- `npm.cmd run test:api` - passed after the API ESM build output was refreshed.
- `npm.cmd run build --workspace @zara/core` - passed.
- `npm.cmd run build --workspace @zara/api` - passed, including TypeScript compilation and ESM import patching.
- `npm.cmd run typecheck --workspace @zara/api` - passed before the final test-fixture-only changes. A later repeat timed out after 180 seconds under local process load. The API build and full API suite then passed.
- `git diff --check` - passed with line-ending warnings only.

## Pending Work

- ISSUE-244 must make ledger commit and Polar outbox enqueue one durable transaction.
- ISSUE-245 must complete payment and credit state synchronization.
- ISSUE-246 must add live budget reservations and finalization.
- ISSUE-247 must replace remaining dashboard billing placeholders with production read models.
- ISSUE-248 must run shadow reconciliation and record the charge-release decision.

## Risks

- A process failure after terminal call persistence but before ledger insertion needs the ISSUE-244 durable outbox and reconciliation path. Duplicate terminal callbacks can retry the same fact now.
- Provider data can arrive late. Missing provider duration stays visible as incomplete and is not estimated.

## Decisions

- Only trusted server lifecycle events can create billable usage.
- Missing rate or usage data cannot silently create a zero or estimated charge.
- Subscription charges and PAYG credit debits use the same trusted usage facts. A client cannot submit a PAYG debit price or amount.
- Browser sandbox V1 is non-billable. Phone tests have a separate usage class and follow their live route.
- The public producer and ledger repository are the test seam. Tests do not accept client-supplied prices or debit amounts.

## Next Recommended Step

Implement ISSUE-244. Add the durable Polar outbox and reconciliation path without enabling customer charges.
