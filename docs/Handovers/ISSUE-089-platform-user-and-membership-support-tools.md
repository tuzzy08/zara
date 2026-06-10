# ISSUE-089: Platform user and membership support tools

External: [GitHub #89](https://github.com/tuzzy08/zara/issues/89)

Issue link: https://github.com/tuzzy08/zara/issues/89

## Goal

Deliver Platform user and membership support tools for the Platform Admin area in the MVP Builder milestone.

## Acceptance Criteria

- Platform admins can view users and memberships
- Support actions are permissioned and audited
- No raw secrets or credentials are exposed

## Work Completed

- Added guarded `GET /platform-admin/users` for safe user and membership visibility.
- Added `POST /platform-admin/users/:userId/support-actions` for a narrow audited support action.
- Platform support, admin, and owner roles can run the support action; readonly roles are blocked.
- Responses expose public user, tenant, and role details only, with no raw secrets or credentials.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts`
  - Failed because support-action route did not exist.
- GREEN: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts`

## Pending Work

- None for ISSUE-089 acceptance.

## Risks And Edge Cases

- Deleted user
- Membership removed during support flow

## Decisions

- Priority: P1
- Labels: platform-admin, auth, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Support actions start deliberately narrow so the permission and audit pattern is in place before broader support workflows are added.

## Next Recommended Step

Extend the support-action enum only when a concrete staff workflow needs it.
