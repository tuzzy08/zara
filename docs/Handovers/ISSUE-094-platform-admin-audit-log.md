# ISSUE-094: Platform admin audit log

Issue link: https://github.com/tuzzy08/zara/issues/94

## Goal

Deliver Platform admin audit log for the Platform Admin area in the Production milestone.

## Acceptance Criteria

- Every platform admin action records actor, target, tenant, action, timestamp, metadata, and impersonation state
- Audit log can be filtered by actor, tenant, and action
- Audit records are not editable by normal admins

## Work Completed

- Added platform audit entries for tenant status, billing controls, user support actions, impersonation start/revoke, and abuse review decisions.
- Audit records include actor, actor role, target type, target ID, tenant ID, action, outcome, metadata, optional impersonation session ID, and timestamp.
- Added guarded `GET /platform-admin/audit-logs` with actor, tenant, and action filters.
- No audit mutation/edit endpoint is exposed to normal platform admins.
- Added matching platform-admin UI route at `/audit`.

## Tests Run

- RED/GREEN: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts`
- RED/GREEN: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx`

## Pending Work

- None for ISSUE-094 acceptance.

## Risks And Edge Cases

- System actor
- Failed mutation still audited

## Decisions

- Priority: P0
- Labels: platform-admin, security, compliance, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Platform audit is separate from tenant compliance audit logs because staff actions span tenants and platform resources.

## Next Recommended Step

Persist platform audit records durably when platform-admin storage is expanded.
