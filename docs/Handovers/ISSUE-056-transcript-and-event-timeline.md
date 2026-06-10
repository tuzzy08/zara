# ISSUE-056: Transcript and event timeline

External: [GitHub #56](https://github.com/tuzzy08/zara/issues/56)

Issue link: https://github.com/tuzzy08/zara/issues/56

## Goal

Deliver Transcript and event timeline for the Monitoring area in the Monitoring milestone.

## Acceptance Criteria

- Timeline shows transcript, tools, handoffs, routing, and errors
- Events can be replayed after call
- Sensitive text is redacted

## Work Completed

- Added replay event routes to the Nest live sandbox session API so transcript and telemetry can be reloaded after refresh or operator inspection.
- Added shared replay helpers in `apps/web/src/liveSandboxReplay.ts` to rebuild transcript entries, recover routing posture, recover first-byte latency, and redact sensitive text for monitor views.
- Added a redacted replay timeline to `/sandbox` that shows caller, agent, and system transcript entries alongside summarized runtime and tool events.
- Reused the same replay spine for browser refresh resume so the active sandbox session and the operator replay view stay consistent.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts`
- RED: `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=threads`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=threads`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/web`

## Pending Work

- Extend replay export and post-call timeline tooling once monitoring grows beyond sandbox-only sessions.

## Risks And Edge Cases

- Out-of-order events
- Redaction failure
- Replayed transcript diverges from raw event history if new event types are introduced without replay helpers

## Decisions

- Priority: P1
- Labels: runtime, frontend, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Redaction for operator replay currently removes email addresses, phone numbers, and `secret://` references before timeline rendering.

## Next Recommended Step

Carry the same replay contract into broader monitoring and escalation features so every operator surface uses one event-history source of truth.
