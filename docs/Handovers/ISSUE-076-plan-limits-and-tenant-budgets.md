# ISSUE-076: Plan limits and tenant budgets

Issue link: https://github.com/tuzzy08/zara/issues/76

## Goal

Deliver Plan limits and tenant budgets for the Billing area in the Production milestone.

## Acceptance Criteria

- Tenant budgets can cap calls and premium runtime use
- Over-budget behavior is configurable
- Admins see warnings

## Work Completed

- RED: added billing controller coverage proving tenant admins must configure monthly spend, call-minute, and premium-runtime caps, receive blocking decisions when configured, switch to warning behavior, and see budget warnings in billing state.
- GREEN: implemented `PATCH /organizations/:organizationId/billing/budget-policy`.
- GREEN: implemented `POST /organizations/:organizationId/billing/budget-checks`.
- Billing state now exposes `budgetPolicy` and `budgetWarnings` derived from current spend, telephony minutes, and premium runtime minutes.
- Budget checks project requested cost/call/premium runtime usage and return `allow`, `warn`, or `block` based on configured `overBudgetBehavior`.
- Documented budget policy and checks in `docs/API.md`, `docs/Billing.md`, and `docs/Runtime-Manifests.md`.
- Marked ISSUE-076 implemented in `docs/Issue-Backlog.md` and updated roadmap sequencing.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/billing/billing.controller.test.ts` failed with `404` for the missing budget policy route.
- GREEN: `npm.cmd run test:run -- apps/api/src/billing/billing.controller.test.ts`

## Pending Work

- None for this issue.

## Risks And Edge Cases

- Budget reached mid-call
- VIP override
- Temporary builder budget metadata must not be mistaken for an authoritative tenant plan limit.

## Decisions

- Billing state is the source of truth for tenant budget policy.
- `block` prevents over-limit requests; `warn` allows them while still surfacing reasons.
- The previous temporary browser-sandbox budget metadata is documented as superseded by billing budget controls.

## Next Recommended Step

Continue with production deployment planning in ISSUE-077.
