# ISSUE-023: Call event stream

External: [GitHub #23](https://github.com/tuzzy08/zara/issues/23)

Issue link: https://github.com/tuzzy08/zara/issues/23

## Goal

Deliver Call event stream for the Runtime area in the Sandbox milestone.

## Acceptance Criteria

- Events are ordered and idempotent
- Subscribers receive live updates
- Replay works for post-call analysis

## Work Completed

- Added the shared call event stream in `packages/core/src/runtime.ts`.
- Added stream coverage in `packages/core/src/sandbox.test.ts`.
- Event stream now supports:
  - ordered sequence numbers
  - idempotent event publishing by event ID
  - live subscriber fanout
  - replay from a cursor for reconnect and post-call analysis
- Wired the browser sandbox UI to replay and subscribe to session events.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/sandbox.test.ts`
- `npm.cmd run test:run -- packages/core/src/runtime.test.ts packages/core/src/sandbox.test.ts apps/web/src/app.test.tsx`
- `npm.cmd run test:run -- --pool=threads`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build --workspace @zara/web`

## Pending Work

- Move event persistence behind the future NestJS runtime module/API when backend sandbox routes are scheduled.
- Add websocket/server-sent event transport when the live monitor slice begins.

## Risks And Edge Cases

- Reconnect
- Duplicate provider webhook

## Decisions

- Priority: P0
- Labels: runtime, testing, tdd-required
- Handover docs are mandatory for every pass on this issue.
- V1 event stream is in-memory for the browser sandbox and shared runtime tests.
- Event IDs are the idempotency key; accepted events receive monotonic sequence numbers and string cursors.
- Replay is cursor-based so UI reconnects and post-call analysis can consume the same contract later.

## Next Recommended Step

Use this stream contract as the backing shape for the future NestJS runtime event route and live call monitor.
