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

## Tests Run

- Documentation pass only for this issue seed.

## Pending Work

- Replace simulated tool handlers in sandbox with live runtime tool execution.
- Emit richer event payloads for node transitions, tool lifecycle, provider latency, and per-turn cost deltas.
- Add RED/GREEN coverage for tool failure fallback and telemetry ordering.

## Risks And Edge Cases

- Tool authorization is revoked mid-session
- Tool timeout triggers fallback routing
- Multiple tool-capable branches compete in the same turn

## Decisions

- Priority: P0
- Labels: runtime, integrations, testing, tdd-required
- The live sandbox should not hide tool execution behind fake responses; it should exercise the same runtime tool path that calls use.
- Event payloads need to be rich enough for future monitor and transcript timeline work to reuse them.

## Next Recommended Step

After transport and provider execution are live, replace the sandbox tool registry shim with runtime-backed tool execution and telemetry events.
