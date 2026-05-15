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

- Add long-term heartbeat rollups and alert fan-out beyond the current state snapshots.
- Replace the current control-plane execution bridge with a direct carrier/media-plane implementation when the runtime plane is ready.

## Risks And Edge Cases

- Heartbeats are now durable and schedulable, but the carrier media plane is still abstracted.
- Loopback tests validate provider execution posture, not full jitter/loss behavior.

## Decisions

- Blocking health posture is carried on the connection model itself.
- Manual dispatch remains the fastest route-validation path.
- Heartbeats and loopback calls are the operator-safe production checks before direct live media bridging exists.

## Next Recommended Step

Keep the current heartbeat/test-call contract stable and add alerting plus direct media-plane adapters behind it when provider execution moves beyond the control plane.
