# ISSUE-166: Shopify connector v1 for read-only commerce support

Status: Pending
External: [Linear ZAR-120](https://linear.app/zara-voice/issue/ZAR-120/issue-166-shopify-connector-v1-for-read-only-commerce-support)

## Goal

Add Shopify read-only customer, order, fulfillment, and shipping-status lookup for ecommerce support calls.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependencies on ISSUE-158 and ISSUE-159.

## Tests Run

- Not run; issue creation and planning only.

## Pending Work

- Add Shopify registry metadata, OAuth/setup flow, and scoped read-only grants.
- Implement curated read-only lookup tools.
- Add provider contract, publish validation, and runtime fallback tests.

## Risks And Edge Cases

- Caller-provided order identifiers may not belong to the caller.
- Agencies may need workspace-owned Shopify connections for separate stores.
- Provider rate limits must not cause invented order status.

## Decisions

- Shopify v1 is read-only only.
- Refunds, cancellations, address edits, draft orders, discount changes, and inventory changes are out of v1.

## Next Recommended Step

Start with mocked Shopify read-only lookup contract tests.

