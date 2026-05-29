# ISSUE-136: Structured transfer context for routed agents

Status: Implemented
Date: 2026-05-27
External: [Linear ZAR-69](https://linear.app/zara-voice/issue/ZAR-69/issue-136-structured-transfer-context-for-routed-agents)

## Work Completed

- Created the implementation issue in `docs/Issue-Backlog.md`.
- Added transfer context standards in `docs/Agent-Tool-And-Transfer-Standard.md`.
- Linked transfer standardization from architecture, manifest, feature-flow, roadmap, and testing docs.
- Moved Linear `ZAR-69` and local `ISSUE-136` records to `In Progress` before implementation.
- Added direct agent-to-agent transfer context in the live sandbox router before selecting the target agent.
- Enriched handoff route events with transfer ID, source role, target role, and packet sequence metadata.
- Ensured target-agent model inputs receive `agentContext.transfer` plus matched intent context before responding.
- Updated runtime/API/testing/roadmap docs to describe structured transfer context as implemented.

## Tests Run

- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts --testNamePattern "direct agent-to-agent"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts --testNamePattern "routes billing turns"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- `npm.cmd run typecheck`

## Pending Work

- None for ISSUE-136 acceptance.
- ISSUE-137 should harden loop limits, caller refusal overrides, language mismatch handling, and packet warning coverage for transfer policies.

## Risks

- Direct agent-to-agent routes use generated route reasons until the builder offers optional user-authored direct-route reasons.
- Transfer-loop, refusal, and language mismatch guards are deferred to ISSUE-137 policy hardening.
- Transfer context remains advisory and must not override target-agent policy.

## Decisions

- Routed-to agents must always be aware of why they received the caller.
- Handoff nodes provide explicit transfer reasons.
- Direct agent-to-agent routes receive generated route context if no handoff node exists.
- Existing `agent.handoff.requested` and `agent.handoff.completed` websocket events carry transfer metadata rather than adding a new public event type.

## Next Recommended Step

- Move to ISSUE-137 / Linear ZAR-71 for runtime orchestration edge-case policy hardening.
