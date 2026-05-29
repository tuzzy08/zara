# ISSUE-124: Live sandbox session spine deepening

## Goal

Deepen the live sandbox session spine so turn routing has a smaller module interface while the existing live-session API and websocket behavior stay unchanged.

## Acceptance Criteria

- Live sandbox turn routing is owned by a focused module with a small public interface
- The existing live sandbox session HTTP and websocket contracts remain unchanged
- Focused tests cover condition, handoff, tool, and terminal routing without requiring a full websocket session

## Work Completed

- Created ISSUE-124 as the issue-specific handover for this architecture deepening pass.
- Updated the local backlog and roadmap to track the new runtime architecture issue.
- Added focused RED coverage for the live sandbox route spine in `apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts`.
- Extracted turn route traversal into `apps/api/src/sandbox-live-sessions/sandbox-live-session-router.ts`.
- Rewired `SandboxLiveSessionsService` to call the extracted router while preserving the live-session HTTP and websocket contracts.
- Kept condition branch resolution, tool invocation collection, handoff events, terminal exits, frontier fallback, and route pre-event ordering covered at the focused module boundary.
- Documented the live sandbox router module in `docs/Architecture.md`, `docs/API.md`, `docs/Runtime-Manifests.md`, and `docs/Testing-Strategy.md`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts`
  - Failed as expected because `./sandbox-live-session-router` did not exist yet.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts`
  - Passed: 1 file, 2 tests.
- Contract check: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
  - Passed: 3 files, 29 tests.
  - The existing provider-failure diagnostic test still logs the expected AssemblyAI close-code error.
- Typecheck: `npm.cmd run typecheck --workspace @zara/api`
  - Passed.
- Docs follow-up: `git diff --check`
  - Passed with Git's existing Windows line-ending conversion warnings only.

## Pending Work

- No required acceptance work remains for ISSUE-124.
- Future architecture passes can continue splitting the live sandbox spine by extracting provider event projection, session memory mutation, or transport lifecycle ownership once each has focused RED coverage.

## Risks And Edge Cases

- Empty or stale frontier should still fall back to the manifest entry node.
- Tool nodes must be collected before the responding role is selected.
- Terminal escalation and exit nodes must stop the turn without invoking the model.
- Existing transport token, redaction, memory, escalation, and event ordering behavior must remain unchanged.

## Decisions

- Preserve the public live sandbox session HTTP and websocket contracts.
- Start with turn routing because it is pure enough for focused RED/GREEN coverage and removes routing knowledge from the large session module.
- Treat this as a refactor issue; any behavior test added should describe an existing required contract rather than inventing new product behavior.
- Keep the extracted router framework-free and synchronous so it can be tested without booting Nest or websocket transport fixtures.

## Next Recommended Step

Pick the next live sandbox boundary only after identifying a behavior that can be covered with a small failing test, with provider event projection as the likely next candidate.
