# ISSUE-090: Platform telephony operations dashboard

External: [GitHub #90](https://github.com/tuzzy08/zara/issues/90)

Issue link: https://github.com/tuzzy08/zara/issues/90

## Goal

Deliver Platform telephony operations dashboard for the Platform Admin area in the Telephony MVP milestone.

## Acceptance Criteria

- Platform admins can inspect platform-managed, BYO SIP, and BYO Twilio connections
- Health, route, and webhook failures are visible
- Raw provider credentials are never exposed

## Work Completed

- Added guarded `GET /platform-admin/telephony`.
- Telephony operations data covers platform-managed, BYO SIP, and BYO provider-account connections.
- Responses include health, route failures, webhook failures, active calls, tenant, and provider posture.
- Tests assert no raw secret, credential, or token material is returned.
- Added matching platform-admin UI route at `/telephony`.

## Tests Run

- RED/GREEN: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts`
- RED/GREEN: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx`

## Pending Work

- None for ISSUE-090 acceptance.

## Risks And Edge Cases

- Provider outage
- Tenant connection disabled mid-call

## Decisions

- Priority: P1
- Labels: platform-admin, telephony, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Platform telephony visibility is public-safe operational metadata only.

## Next Recommended Step

Attach the route to durable telephony state when platform-admin persistence is broadened.
