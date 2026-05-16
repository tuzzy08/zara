# ISSUE-114: Live sandbox tool execution and event telemetry

Issue link: https://github.com/tuzzy08/zara/issues/114

## Goal

Execute real tool nodes during sandbox calls and surface full runtime telemetry.

## Acceptance Criteria

- Tool nodes execute through the live runtime tool registry during sandbox sessions
- Transcript and event timeline reflect tool calls, handoffs, condition branches, exit nodes, and failures
- Telemetry includes provider latency, tool duration, node transition, and cost deltas per turn

## Work Completed

- Added ISSUE-114 to the local backlog, roadmap, and `docs/issues.json`.
- Updated the live sandbox direction docs so runtime telemetry is defined as real execution data rather than simulated event replay.
- Added a live sandbox tool registry contract and default execution path in `apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.ts`.
- Wired tool execution into the live turn path in `apps/api/src/sandbox-live-sessions/sandbox-live-sessions.service.ts` so tool-capable nodes now emit `tool.started`, `tool.approval_required`, `tool.completed`, and `tool.failed`.
- Expanded live runtime telemetry to emit `node.transition`, `agent.handoff.*`, `provider.telemetry`, and `turn.cost.delta` during live draft and published sandbox calls.
- Updated the tenant live sandbox UI in `apps/web/src/WorkflowBuilder.tsx`, `apps/web/src/SandboxScreen.tsx`, and `apps/web/src/liveSandboxEventFormatting.ts` so both `/workflows` and `/sandbox` render readable tool, provider, routing, and cost events instead of raw transport event names.
- Updated `apps/web/src/useLiveSandboxSession.ts` so live handoff and failure milestones continue to surface clearly inside the transcript flow.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- RED: `npm.cmd run test:run -- apps/web/src/app.test.tsx`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- GREEN: `npm.cmd run test:run -- apps/web/src/liveSandboxTransport.test.ts apps/web/src/app.test.tsx`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build`

## Pending Work

- No remaining ISSUE-114 blockers.

## Risks And Edge Cases

- Tool authorization is revoked mid-session
- Tool timeout triggers fallback routing
- Multiple tool-capable branches compete in the same turn

## Decisions

- Priority: P0
- Labels: runtime, integrations, testing, tdd-required
- The live sandbox should not hide tool execution behind fake responses; it should exercise the same runtime tool path that calls use.
- Event payloads need to be rich enough for future monitor and transcript timeline work to reuse them.
- The browser event timeline should show concise operator-facing summaries while still preserving the raw event payloads in session state for future monitor and export features.

## Next Recommended Step

Build the integrations foundation so live sandbox tool execution can use real tenant-owned connector credentials instead of the current HTTP tool registry baseline.
