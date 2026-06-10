# ISSUE-093: Platform usage and billing controls

External: [GitHub #93](https://github.com/tuzzy08/zara/issues/93)

Issue link: https://github.com/tuzzy08/zara/issues/93

## Goal

Deliver Platform usage and billing controls for the Platform Admin area in the Production milestone.

## Acceptance Criteria

- Platform admins can inspect usage, budgets, overages, premium realtime usage, and plan limits across tenants
- Plan/budget changes are audited
- Readonly admins cannot mutate billing controls

## Work Completed

- Organization summaries expose usage, budget, premium realtime, over-budget, plan, and billing-control posture.
- Added guarded `PATCH /platform-admin/organizations/:orgId/billing-controls`.
- Billing-control changes are restricted to platform owner/admin roles.
- Billing-control changes write platform audit entries.
- Added matching platform-admin UI route at `/billing`.

## Tests Run

- RED/GREEN: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts`
- RED/GREEN: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx`

## Pending Work

- None for ISSUE-093 acceptance.

## Risks And Edge Cases

- Budget reached mid-call
- Pricing table missing

## Decisions

- Priority: P1
- Labels: platform-admin, billing, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Readonly staff can inspect billing posture but cannot mutate billing controls.

## Next Recommended Step

Map the seeded controls to tenant billing state when platform-admin persistence is deepened.
