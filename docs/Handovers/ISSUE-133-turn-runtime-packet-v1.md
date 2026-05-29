# ISSUE-133: Turn runtime packet v1

Status: Implemented
Date: 2026-05-27
External: [Linear ZAR-66](https://linear.app/zara-voice/issue/ZAR-66/issue-133-turn-runtime-packet-v1)

## Work Completed

- Created the implementation issue in `docs/Issue-Backlog.md`.
- Added the target packet standard in `docs/Turn-Runtime-Packet-v1.md`.
- Linked the runtime orchestration standard from architecture, manifest, feature-flow, roadmap, and testing docs.
- Added `@zara/core` turn runtime packet types and helpers for packet creation, immutable node visits, intent facts, tool requests, transfer facts, active-agent selection, warnings, cloning, and safe agent-facing projection.
- Added projection size bounding so model-facing context trims older transcript/tool context before exceeding `maxModelContextBytes`.
- Threaded packet creation through the live sandbox route resolver while preserving the existing route result fields.
- Added live-session event metadata so node transitions, tool requested/started/completed, agent selection, model routing, terminal/cost, and provider events carry `turnId` and packet sequence context.
- Updated architecture, runtime manifest, testing, roadmap, issue backlog, and packet standard docs to reflect the implemented baseline.

## Tests Run

- RED/GREEN: `npm.cmd run test:run -- packages/core/src/turn-runtime-packet.test.ts`
- RED/GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts`
- GREEN: `npm.cmd run test:run -- packages/core/src/turn-runtime-packet.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts --testNamePattern "executes live tool nodes"`
- GREEN: `npm.cmd run test:run -- packages/core/src/production-devops-docs.test.ts`
- GREEN: `npm.cmd run typecheck`
- GREEN: `git diff --check`

## Pending Work

- ISSUE-134 should replace current explicit/substr intent inference with the model-backed intent classifier and validated `IntentRouteResult`.
- ISSUE-135 should move from mandatory graph tool traversal to discretionary agent toolbelt calls and append structured tool execution results to the packet.
- ISSUE-136 should deepen transfer context in target-agent prompts beyond the initial packet transfer facts.
- ISSUE-137 should apply edge-case policy guards and warning generation across ambiguity, tool failures, transfer loops, language mismatch, interruption, and context bloat.

## Risks

- The packet is currently stored only inside turn routing and emitted as compact event metadata; durable packet reconstruction remains future policy work.
- Current tool packet facts represent graph-routed tool requests; discretionary model-requested tool calls remain ISSUE-135.
- Current transfer facts are created from graph handoff state; target-agent prompt integration remains ISSUE-136.

## Decisions

- Packet scope is one caller turn, not the entire call.
- Events are telemetry derived from packet facts; the packet is the decision state.
- Agents receive a safe projection rather than raw packet state.
- Packet events carry `turnId` and monotonic packet-local `sequence`.
- Live-session public events keep their existing type names and add packet metadata in payloads for backward compatibility.
- Model-facing projection omits credential refs and full tool output, preserving only summaries and optional safe output.

## Next Recommended Step

- Start ISSUE-134 with RED classifier output-validation tests and router tests for configured intent branches, fallback, malformed output, and no invented targets.
