# ISSUE-088: Platform organization management

Issue link: https://github.com/tuzzy08/zara/issues/88

## Goal

Deliver Platform organization management for the Platform Admin area in the MVP Builder milestone.

## Acceptance Criteria

- Platform admins can view tenant status, plan, usage, telephony, integration state, and risk flags
- Tenant status changes are permissioned
- Status changes are audited

## Work Completed

- Added guarded `GET /platform-admin/organizations` and `GET /platform-admin/organizations/:orgId`.
- Organization summaries include status, plan, usage, telephony posture, integration posture, risk flags, and billing controls.
- Added permissioned `PATCH /platform-admin/organizations/:orgId/status`.
- Status changes write platform audit entries.
- Tests prove readonly platform users cannot mutate tenant status.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts`
  - Failed because `/platform-admin/organizations` was missing.
- GREEN: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts`

## Pending Work

- None for ISSUE-088 acceptance.

## Risks And Edge Cases

- Suspended tenant with active calls
- Readonly admin attempts mutation

## Decisions

- Priority: P1
- Labels: platform-admin, backend, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Organization operations are tenant-explicit and all mutations include the target tenant in audit records.

## Next Recommended Step

Continue using the same platform audit contract for future staff operations.
