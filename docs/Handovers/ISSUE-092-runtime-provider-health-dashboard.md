# ISSUE-092: Runtime provider health dashboard

External: [GitHub #92](https://github.com/tuzzy08/zara/issues/92)

Issue link: https://github.com/tuzzy08/zara/issues/92

## Goal

Deliver Runtime provider health dashboard for the Platform Admin area in the Monitoring milestone.

## Acceptance Criteria

- Platform admins can see STT, TTS, model, realtime, telephony, and queue health by provider and region
- Health events include timestamps and severity
- Outage state is visible

## Work Completed

- Added guarded `GET /platform-admin/runtime/health`.
- Provider health covers STT, TTS, model, realtime, telephony, and queue providers.
- Each provider record includes provider, region, severity, outage state, and `lastEventAt`.
- Added matching platform-admin UI route at `/runtime`.

## Tests Run

- RED/GREEN: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts`
- RED/GREEN: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx`

## Pending Work

- None for ISSUE-092 acceptance.

## Risks And Edge Cases

- Partial regional outage
- Stale health signal

## Decisions

- Priority: P1
- Labels: platform-admin, runtime, monitoring, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Outage state is an explicit field rather than inferred from display copy.

## Next Recommended Step

Wire provider health to observability state when ISSUE-079 is implemented.
