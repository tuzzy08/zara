# ISSUE-179: Agent-decided route tools for route-capable agents

Status: Implemented

External: [Linear ZAR-149](https://linear.app/zara-voice/issue/ZAR-149/issue-179-agent-decided-route-tools-for-route-capable-agents)

## Work Completed

- Created Linear ZAR-149 and linked this local issue.
- Added local backlog and roadmap records for the follow-up architecture change.
- Decision: replace agent-attached route-policy classifier turns with an active-agent internal route action/tool. The active route-capable agent decides when enough context exists; runtime validates configured branch IDs and executes transfer semantics.
- Core contract slice: added `route_to_agent` action parsing, route menu projection on turn runtime packets, and provider-safe internal realtime route declarations through `zara_route_to_agent`.
- Sandwich runtime slice: removed agent-attached route-policy pre-classification from router traversal; route-capable agents now receive a safe `routeMenu`, enter action mode even without normal tools, and route only when the active model emits `route_to_agent`.
- Sandwich route execution validates configured branch IDs, ignores model-supplied targets, records packet intent/transfer/agent-selection facts, emits route announcement plus handoff events, and moves the next frontier to the routed agent.
- Premium realtime slice: session creation now includes normal agent tools plus an internal route tool for route-capable roles; provider route calls are handled separately from connector execution/grant validation, update active role/tool declarations after routing, and emit provider messages for the configured caller announcement.
- Premium realtime tool-loop filtering now passes only normal connector declarations to the agent tool executor, keeping internal route declarations out of integration grant checks.
- Builder/docs slice: added a tenant builder Router Agent preset that still creates the single underlying Agent node type with `routePolicy` enabled by default.
- Confirmed Router Agents remain normal tool-capable agents in the builder; the Tool action stays enabled after creating a Router Agent.
- Updated routing/tool/runtime/frontend/platform-admin docs to describe agent-attached routing as agent-decided via an internal route tool/action and runtime-validated, while standalone legacy intent routes remain classifier-backed until a future removal slice.
- Cleanup follow-up: removed retired seeded workspace fixture support and updated affected tests/docs so fresh tenants use only `workspace-default` unless a test explicitly models a user-created workspace.

## Implementation Plan

1. Core contract slice: add route action parsing, route menu projection into agent turn context, and internal realtime route declarations without exposing graph targets or credentials.
2. Sandwich runtime slice: stop classifying agent-attached route policies in the router; enable agent-action mode for route-capable agents even when no normal tools exist; validate route actions and switch active agent through the existing packet/transfer event path.
3. Premium realtime slice: include internal route declarations for route-capable roles, handle provider route calls separately from connector tools, update the active session role/tools after validated route, and emit the configured caller announcement before the target agent continues.
4. Builder/docs slice: present Router Agent as an intuitive agent behavior/preset while preserving normal tools, and update routing docs to describe agent-decided runtime-validated routing.
5. Verification slice: run focused core/runtime/premium tests and typecheck; update issue status and handover with final commands and risks.

## Tests Run

- RED: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "adds a Router Agent preset" --pool=forks` failed because no accessible `Router Agent` preset existed.
- GREEN: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "adds a Router Agent preset" --pool=forks` passed.
- Core route contract suite: `npm.cmd run test:run -- packages/core/src/agent-action.test.ts packages/core/src/turn-runtime-packet.test.ts packages/core/src/realtime-tool-bridge.test.ts --pool=forks` passed, 15 tests.
- Premium realtime focused suite: `npm.cmd run test:run -- apps/api/src/runtime-sessions/runtime-sessions.service.test.ts apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts apps/api/src/runtime-sessions/premium-realtime-tool-loop.service.test.ts apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts --pool=forks` passed, 31 tests.
- Premium malformed route-argument regression: `npm.cmd run test:run -- apps/api/src/runtime-sessions/runtime-sessions.service.test.ts --pool=forks` passed, 7 tests.
- OpenAI realtime adapter title/contract rerun: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts --pool=forks` passed, 9 tests.
- Sandwich prompt/router focused suite: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-text-model-prompts.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts -t "route-capable agent|route action" --pool=forks` passed, 2 tests with unrelated tests skipped by filter.
- Sandwich websocket route-action test: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "routes only when a route-capable agent emits a route action" --pool=forks` passed, 1 test with unrelated tests skipped by filter.
- Builder behavior suite: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx --pool=forks` passed, 12 tests.
- Root typecheck: `npm.cmd run typecheck` passed.
- Cleanup verification: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts apps/api/src/sandbox-live-sessions/sandbox-text-model-prompts.test.ts apps/api/src/sandbox-live-sessions/sandbox-text-model-provider-factory.test.ts apps/api/src/sandbox-live-sessions/sandbox-text-model-router.provider.test.ts apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts apps/api/src/sandbox-live-sessions/gemini-chat-text.provider.test.ts apps/api/src/sandbox-live-sessions/openai-chat-text.provider.test.ts apps/api/src/sandbox-live-sessions/runtime-agent-tool-executor.service.test.ts --pool=forks` passed, 87 tests.
- Cleanup verification: `npm.cmd run test:run -- packages/core/src/workspace.test.ts packages/core/src/workspace-workflow.test.ts packages/core/src/workflow.test.ts packages/core/src/runtime.test.ts packages/core/src/telephony.test.ts packages/auth-client/src/index.test.ts apps/web/src/workflowSandboxRegistry.test.ts apps/web/src/workflowBuilderPublish.test.ts apps/web/src/liveSandboxTransport.test.ts apps/web/src/sandboxRuntimeManifest.test.ts apps/web/src/telephonyCallsPageModel.test.ts apps/web/src/useLiveSandboxSession.test.tsx apps/web/src/workflowBuilderToolCatalog.test.ts apps/web/src/WorkflowBuilder.test.tsx --pool=forks` passed, 149 tests.
- Cleanup verification: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts apps/api/src/runtime-sessions/runtime-sessions.service.test.ts apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts apps/api/src/runtime-sessions/premium-realtime-tool-loop.service.test.ts --pool=forks` passed, 62 tests.
- Cleanup verification: `npm.cmd run test:run -- apps/api/src/auth/auth-invitations.controller.test.ts --pool=forks` passed, 4 tests.

## Pending Work

- None for ISSUE-179 acceptance criteria.
- Workspace seed cleanup completed: fresh tenants now use only `workspace-default`, and old multi-workspace seed fixture references were removed from tests.

## Risks

- The working tree already has many unrelated modified files from previous slices; ISSUE-179 changes must stay surgical and avoid reverting others' work.
- Premium realtime must keep provider credentials, provider URLs, connector secrets, and graph target IDs out of browser/provider-visible surfaces.
- Internal route tools must not be treated as integration grants or connector tools.
- Route-capable agents with normal tools need both normal tool declarations and the internal route declaration.
- Full focused websocket suite passed after the workspace fixture cleanup.

## Decisions

- Router Agent is a UX behavior/preset, not a distinct runtime node type.
- Route-capable agents can keep normal tools. Routing is an additional capability, not a replacement for tool use.
- The active model owns the "enough context" decision by choosing or not choosing the route action/tool.
- Runtime remains authoritative for branch validation, target resolution, loop/language guards, announcements, packet facts, and active-role switching.
- The Router Agent preset derives its initial target menu from existing agent nodes and excludes the selected source agent so a router created after Front Desk does not default its first branch back to Front Desk.

## Next Recommended Step

No ISSUE-179 implementation work remains. Keep future workspace tests on `workspace-default` unless the test explicitly creates an additional workspace.
