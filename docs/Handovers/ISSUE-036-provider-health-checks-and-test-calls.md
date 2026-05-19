# ISSUE-036: Provider health checks and test calls

Issue link: https://github.com/tuzzy08/zara/issues/36

## Goal

Validate provider posture before routing traffic and give operators a safe test path.

## Status

- Status: delivered
- Completion: 100%

## Work Completed

- Added provider validation on telephony connections.
- Surfaced connection health in the `/calls` screen.
- Added manual inbound dispatch test controls for operator verification before live traffic.
- Added browser verification against a live local API for connect, validate, and import flow.
- Added provider heartbeat runs with durable diagnostics, latency, and scheduled/manual posture.
- Added loopback provider test calls that open telephony execution sessions before live traffic.
- Added scheduled heartbeat sweep support in the Nest telephony service, with optional `ZARA_TELEPHONY_HEARTBEAT_INTERVAL_MS` runtime control.

## Tests Run

- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.persistence.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build`

## Pending Work

- None for issue completion.

## Risks And Edge Cases

- A healthy heartbeat does not override missing number routing or workflow binding.
- Loopback tests validate the provider execution path, recording posture, and workflow route selected for the target number.

## Decisions

- Blocking health posture is carried on the connection model itself.
- Manual dispatch remains the fastest route-validation path.
- Heartbeats and loopback calls persist provider-native execution sessions and command history so operators can verify bridge posture before live traffic changes.

## Next Recommended Step

Issue complete. Feed the durable heartbeat and loopback diagnostics into the upcoming monitoring and escalation slices.
