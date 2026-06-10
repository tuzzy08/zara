# ISSUE-084: Platform role and permission model

External: [GitHub #84](https://github.com/tuzzy08/zara/issues/84)

Issue link: https://github.com/tuzzy08/zara/issues/84

## Goal

Deliver Platform role and permission model for the Security area in the Foundation milestone.

## Acceptance Criteria

- Shared platform and tenant role types exist
- NestJS guards distinguish platform roles from tenant roles
- Tests prove tenant admins are not platform admins

## Work Completed

- Verified shared tenant and platform role types are exported from `@zara/core` and normalized by `@zara/auth-client`.
- Added `PlatformAdminGuard` for NestJS platform-admin routes.
- Guard accepts only valid platform roles and ignores tenant-only roles such as tenant `admin`.
- Added focused API coverage proving a tenant admin is rejected and a `platform_admin` can load the staff dashboard.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts`
  - Failed because `PlatformAdminModule` did not exist.
- GREEN: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts`
- Verification: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx apps/platform-admin/src/deployment-config.test.ts apps/api/src/platform-admin/platform-admin.controller.test.ts`

## Pending Work

- None for ISSUE-084 acceptance.

## Risks And Edge Cases

- Role downgraded during session
- Conflicting tenant and platform roles

## Decisions

- Priority: P0
- Labels: platform-admin, auth, security, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Platform-admin server routes trust only a platform-role session signal. Tenant organization roles are deliberately not considered staff authorization.

## Next Recommended Step

Continue through the platform-admin slice verification and closeout.
