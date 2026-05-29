# ISSUE-137: Runtime orchestration edge-case policy hardening

Status: Implemented
Date: 2026-05-27
External: [Linear ZAR-71](https://linear.app/zara-voice/issue/ZAR-71/issue-137-runtime-orchestration-edge-case-policy-hardening)

## Work Completed

- Created the implementation issue in `docs/Issue-Backlog.md`.
- Added edge-case and mitigation policy standards in `docs/Runtime-Orchestration-Edge-Cases-And-Policies.md`.
- Linked policy testing expectations from roadmap, architecture, manifest, feature-flow, and testing docs.
- Moved Linear `ZAR-71` and local `ISSUE-137` records to `In Progress` before implementation.
- Added direct transfer loop prevention: if the next direct agent target was already visited, routing stops on the current target agent, clears the frontier, and emits a recoverable `transfer_loop.detected` packet warning.
- Locked in the zero-tools product rule with a live websocket regression: manifests may have an explicit empty `agentToolAssignments` array, the active agent receives `availableTools: []`, action mode is disabled, and no tool events are emitted.
- Added invalid structured agent-command handling: command-shaped model output outside `respond` or assigned `call_tool` is ignored, emits recoverable `agent_action.invalid`, is not spoken to the caller, and cannot mutate graph routing.
- Added transfer language mismatch guards for both direct agent-to-agent routes and handoff routes. When caller language is known and the target role does not support it, routing keeps the source agent active, clears the frontier, avoids transfer events, and emits `transfer_language.unsupported`.
- Added tool failure classification for timeout and rate-limit errors using recoverable `tool_execution.timeout` and `tool_execution.rate_limited` packet results.
- Added partial tool success support so registries can return `status: "partial"`, emit `tool.completed`, and project only `summary` plus `safeOutput` back to the same agent.
- Updated the Gemini provider test to assert the current prompt contract: platform/agent policy lives in `systemInstruction`, and the turn response format lives in the user prompt.
- Synced runtime, manifest, API, security, testing, roadmap, and issue-backlog docs to the implemented baseline.

## Tests Run

- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts --testNamePattern "transfer loops"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts --testNamePattern "explicit empty toolbelt"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts --testNamePattern "unsupported structured agent commands"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts --testNamePattern "caller language"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts --testNamePattern "timeout failure|rate-limit failure|partial tool results"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/gemini-chat-text.provider.test.ts`
- `npm.cmd run test:run -- packages/core/src/intent-routing.test.ts packages/core/src/turn-runtime-packet.test.ts packages/core/src/runtime.test.ts apps/api/src/sandbox-live-sessions/openai-chat-text.provider.test.ts apps/api/src/sandbox-live-sessions/gemini-chat-text.provider.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- `npm.cmd run typecheck`

## Pending Work

- None for ISSUE-137.
- Future hardening can add caller-refusal transfer cancellation, runtime restart reconstruction, configurable tool-call loop limits, and provider outage fallback as separate issues.

## Risks

- The policy baseline depends on ISSUE-133 through ISSUE-136 packet, intent, toolbelt, and transfer contracts.
- Future restart/provider-fallback work must preserve the existing packet event mapping.
- Live websocket tests rely on in-memory state and fake providers; broader production provider outage tests should stay isolated from live-call availability.

## Decisions

- Policy guards should validate model outputs rather than trusting them.
- Runtime never accepts graph target IDs from model output.
- Human approval gates are runtime states, not UI-only hints.
- Direct transfer loops stop on the current target agent instead of falling back to the entry role.
- Transfer language mismatch keeps the source agent active rather than silently routing to an unsupported specialist.
- Partial tool success is a successful `tool.completed` event with `status: "partial"` so monitors can distinguish degraded results without treating them as crashes.
- Timeout and rate-limit errors are recoverable failed tool results with specific codes for agent recovery and monitoring.

## Next Recommended Step

- Move to ISSUE-138 / ZAR-70 for packet-backed OpenTelemetry and LangSmith trace export.
