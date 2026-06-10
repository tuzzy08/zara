# ISSUE-057: Model tool cost telemetry

External: [GitHub #57](https://github.com/tuzzy08/zara/issues/57)

Issue link: https://github.com/tuzzy08/zara/issues/57

## Goal

Deliver Model tool cost telemetry for the Monitoring area in the Monitoring milestone.

## Acceptance Criteria

- Telemetry captures model, tool, latency, and cost
- Metrics aggregate by tenant and call
- Tests cover missing usage data

## Work Completed

- Added a failing controller test for tenant/workspace telemetry aggregation across two live sandbox calls.
- Added `GET /organizations/:orgId/sandbox/live-sessions/telemetry` to expose model latency, STT/TTS latency, tool duration/count, cost, and usage totals.
- Added per-call telemetry summaries with tenant/workspace filtering, newest-call ordering, rounded USD/minute metrics, and `missingUsageData` flags when cost events do not include provider usage.
- Documented the telemetry endpoint and response contract in `docs/API.md`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts -t "aggregates model tool"` failed with `expected 404 to be 200`.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts -t "aggregates model tool"` passed.
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts` passed.
- `npm.cmd run test:run -- apps/api/src/app.module.test.ts` passed.
- `npm.cmd run typecheck` passed.
- `npm.cmd run lint` passed.
- `npm.cmd run build --workspace @zara/api` passed.

## Pending Work

- None for this issue.

## Risks And Edge Cases

- Provider usage delayed
- Clock skew
- Telemetry is currently derived from the in-memory live sandbox event history; future persistence should keep the same public contract when event storage moves to Postgres.
- `missingUsageEventCount` counts calls with missing usage data, not every individual missing usage event inside a call.

## Decisions

- Priority: P1
- Labels: runtime, billing, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Use live sandbox event types as the telemetry source of truth: `provider.telemetry`, `tool.completed`, `tool.failed`, and `turn.cost.delta`.
- Treat missing `usage` on a cost event as a reportable telemetry gap while still counting the cost amount.

## Next Recommended Step

Move to `ISSUE-058: Escalation queue`.
