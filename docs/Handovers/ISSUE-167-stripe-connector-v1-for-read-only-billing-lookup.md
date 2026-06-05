# ISSUE-167: Stripe connector v1 for read-only billing lookup

Status: Pending
External: [Linear ZAR-121](https://linear.app/zara-voice/issue/ZAR-121/issue-167-stripe-connector-v1-for-read-only-billing-lookup)

## Goal

Add Stripe read-only customer, subscription, invoice, and payment-status lookup for billing support.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependencies on ISSUE-158 and ISSUE-159.

## Tests Run

- Not run; issue creation and planning only.

## Pending Work

- Add Stripe registry metadata, connection setup, and read-only scoped grants.
- Implement curated read-only billing lookup tools.
- Add provider contract, catalog absence, runtime fallback, and redaction tests.

## Risks And Edge Cases

- Lookup can return multiple possible customer matches.
- Billing/payment facts are sensitive and need careful logging/UI redaction.
- Tokens may permit writes that Zara must not expose.

## Decisions

- Stripe v1 is read-only only.
- Refunds, cancellations, payment-method changes, invoice creation, coupon changes, and payment retries are out of v1.

## Next Recommended Step

Start with mocked Stripe read-only lookup contract tests.

