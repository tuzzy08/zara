# ISSUE-085: Platform admin app scaffold

External: [GitHub #85](https://github.com/tuzzy08/zara/issues/85)

Issue link: https://github.com/tuzzy08/zara/issues/85

## Goal

Deliver Platform admin app scaffold for the Platform Admin area in the Foundation milestone.

## Acceptance Criteria

- `apps/platform-admin` Vite React app is created
- It has independent routing, shell, build script, and env config
- It shares only approved packages with tenant app

## Work Completed

- Added the platform-admin Vite runtime scaffold with `index.html`, `vite.config.ts`, and `src/main.tsx`.
- Replaced the placeholder component with an independent Zara Staff shell and route-based operations views.
- Added `dev`, `dev:raw`, `preview`, `build`, and `typecheck` scripts for the platform-admin app.
- Added `apps/platform-admin/.env.example` with admin API/auth/origin variables.
- Kept dependencies limited to shared auth plus React/Vite runtime dependencies; no tenant app imports were introduced.

## Tests Run

- RED: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx`
  - Failed because the independent staff shell and routes did not render.
- GREEN: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx`
- Verification: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx apps/platform-admin/src/deployment-config.test.ts apps/api/src/platform-admin/platform-admin.controller.test.ts`

## Pending Work

- None for ISSUE-085 acceptance.

## Risks And Edge Cases

- Wrong API origin
- Shared component imports tenant-only code

## Decisions

- Priority: P0
- Labels: platform-admin, frontend, tdd-required
- Handover docs are mandatory for every pass on this issue.
- The app uses route-derived rendering for the first staff shell slice; deeper data fetching can attach to the guarded API contract without changing the route surface.

## Next Recommended Step

Run full workspace verification after documentation closeout.
