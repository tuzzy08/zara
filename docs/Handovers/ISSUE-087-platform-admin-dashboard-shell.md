# ISSUE-087: Platform admin dashboard shell

External: [GitHub #87](https://github.com/tuzzy08/zara/issues/87)

Issue link: https://github.com/tuzzy08/zara/issues/87

## Goal

Deliver Platform admin dashboard shell for the Platform Admin area in the MVP Builder milestone.

## Acceptance Criteria

- Dashboard shows system health, tenants, calls, runtime status, spend, incidents, and abuse queues
- Navigation is independent from tenant app
- UI smoke test covers dashboard load

## Work Completed

- Added a Zara Staff shell with independent navigation for dashboard, tenants, users, telephony, integrations, runtime, billing, audit, impersonation, and review routes.
- Dashboard now surfaces system health, tenants, active calls, runtime status, spend, incidents, and abuse queue signals.
- Added UI smoke coverage for dashboard load and route rendering.

## Tests Run

- RED: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx`
  - Failed because the staff shell, dashboard cards, and route views were missing.
- GREEN: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx`
- Verification: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx apps/platform-admin/src/deployment-config.test.ts apps/api/src/platform-admin/platform-admin.controller.test.ts`

## Pending Work

- None for ISSUE-087 acceptance.

## Risks And Edge Cases

- Empty state
- Provider status unavailable

## Decisions

- Priority: P1
- Labels: platform-admin, frontend, tdd-required
- Handover docs are mandatory for every pass on this issue.
- The shell follows the restrained product style in `DESIGN.md` and does not reuse tenant navigation.

## Next Recommended Step

Use the guarded platform-admin API as the data source for future live staff dashboard data.
