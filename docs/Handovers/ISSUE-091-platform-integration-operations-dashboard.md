# ISSUE-091: Platform integration operations dashboard

External: [GitHub #91](https://github.com/tuzzy08/zara/issues/91)

Issue link: https://github.com/tuzzy08/zara/issues/91

## Goal

Deliver Platform integration operations dashboard for the Platform Admin area in the Integrations milestone.

## Acceptance Criteria

- Platform admins can inspect connector health, token status, sync failures, and revocation state
- Raw OAuth tokens are never exposed
- Retry/reconnect diagnostics are visible

## Work Completed

- Added guarded `GET /platform-admin/integrations`.
- Integration operations data includes provider, token status, revocation state, sync failures, and reconnect diagnostics.
- Tests assert raw OAuth token names and secret material are absent from responses.
- Added matching platform-admin UI route at `/integrations`.

## Tests Run

- RED/GREEN: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts`
- RED/GREEN: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx`

## Pending Work

- None for ISSUE-091 acceptance.

## Risks And Edge Cases

- Token refresh failure
- Connector outage

## Decisions

- Priority: P1
- Labels: platform-admin, integrations, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Diagnostics are actionable but public-safe; the staff app does not receive raw OAuth credentials.

## Next Recommended Step

Feed this route from integration repository state when platform-admin persistence is expanded.
