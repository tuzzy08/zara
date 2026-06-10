# ISSUE-086: Platform admin auth client and access gate

External: [GitHub #86](https://github.com/tuzzy08/zara/issues/86)

Issue link: https://github.com/tuzzy08/zara/issues/86

## Goal

Deliver Platform admin auth client and access gate for the Platform Admin area in the Foundation milestone.

## Acceptance Criteria

- Platform admin app uses Better Auth React client
- Non-platform users are blocked from admin UI
- Server-side platform guard rejects unauthorized API calls

## Work Completed

- Platform-admin app uses `platformAdminAuthClient` from `@zara/auth-client`.
- The app renders sign-in, platform-access-required, and staff-console states from the shared auth session contract.
- Added NestJS `PlatformAdminGuard` and mounted it on the platform-admin controller.
- API tests prove tenant-only sessions are rejected and platform roles are allowed.

## Tests Run

- RED/GREEN: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx`
- RED/GREEN: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts`
- Verification: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx apps/platform-admin/src/deployment-config.test.ts apps/api/src/platform-admin/platform-admin.controller.test.ts`

## Pending Work

- None for ISSUE-086 acceptance.

## Risks And Edge Cases

- Tenant admin tries admin app
- Platform role revoked mid-session

## Decisions

- Priority: P0
- Labels: platform-admin, auth, security, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Frontend guards are only UX; the Nest guard remains the source of truth.

## Next Recommended Step

Run full verification after all platform-admin handovers are updated.
