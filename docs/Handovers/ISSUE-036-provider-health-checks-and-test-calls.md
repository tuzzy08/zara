# ISSUE-036: Provider health checks and test calls

Issue link: https://github.com/tuzzy08/zara/issues/36

## Goal

Validate provider posture before routing traffic and give operators a safe test path.

## Status

- Status: delivered for the first manual validation slice
- Completion: 85%

## Work Completed

- Added provider validation on telephony connections.
- Surfaced connection health in the `/calls` screen.
- Added manual inbound dispatch test controls for operator verification before live traffic.
- Added browser verification against a live local API for connect, validate, and import flow.

## Tests Run

- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build`

## Pending Work

- Add scheduled provider heartbeats and historical health rollups.
- Add true outbound or loopback test calls against providers.
- Add alerting and degraded-mode operator workflows.

## Risks And Edge Cases

- Current health checks are control-plane validations, not real provider API lookups.
- Manual inbound dispatch tests do not yet simulate live media or network jitter.

## Decisions

- Blocking health posture is carried on the connection model itself.
- Manual dispatch is the first operator-safe test flow before deeper provider probes exist.

## Next Recommended Step

Layer real provider diagnostics and scheduled health monitoring on top of the current validation contract rather than replacing it.
