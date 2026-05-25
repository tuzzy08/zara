# ISSUE-095: Platform impersonation workflow

Issue link: https://github.com/tuzzy08/zara/issues/95

## Goal

Deliver Platform impersonation workflow for the Platform Admin area in the Production milestone.

## Acceptance Criteria

- Impersonation is time-boxed, permissioned, visibly marked, auditable, and revocable
- Destructive actions are blocked unless explicitly allowed
- Tenant and platform audit records link to the impersonation session

## Work Completed

- Added guarded `POST /platform-admin/organizations/:orgId/impersonation-sessions`.
- Added guarded `DELETE /platform-admin/impersonation-sessions/:id`.
- Impersonation sessions include target user, actor, tenant, reason, visible banner flag, destructive-action policy, status, start, expiry, and revoke timestamp.
- Start and revoke actions write platform audit records and tenant compliance audit records linked to the impersonation session ID.
- Added matching platform-admin UI route at `/impersonation`.

## Tests Run

- RED/GREEN: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts`
  - Added explicit RED/GREEN coverage for tenant audit linkage on impersonation start and revoke.
- RED/GREEN: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx`

## Pending Work

- None for ISSUE-095 acceptance.

## Risks And Edge Cases

- Session expires during impersonation
- Role revoked while impersonating

## Decisions

- Priority: P0
- Labels: platform-admin, security, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Destructive actions default to blocked and require an explicit session flag.

## Next Recommended Step

Carry the impersonation session ID into tenant-side audit records when cross-app impersonation actions are added.
