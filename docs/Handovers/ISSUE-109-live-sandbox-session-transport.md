# ISSUE-109: Live sandbox session transport

Issue link: https://github.com/tuzzy08/zara/issues/109

## Goal

Deliver a NestJS-owned live sandbox session transport for draft and published workflow execution.

## Acceptance Criteria

- NestJS creates authenticated workspace-scoped live sandbox sessions for draft and published manifests
- Browser clients connect through a Zara-owned realtime transport instead of direct provider keys
- Session stream emits call lifecycle, transcript, audio, node transition, and tool events

## Work Completed

- Added ISSUE-109 to the local backlog, roadmap, and `docs/issues.json`.
- Updated architecture, feature-flow, runtime-manifest, API, frontend-architecture, and security docs to define the live sandbox transport direction.
- Aligned the issue number with GitHub issue `#109` because `#108` is already occupied by a pull request number in the shared GitHub sequence.
- Added a NestJS live sandbox session module with create, get, and end routes at `/organizations/:orgId/sandbox/live-sessions`.
- Added workspace-scoped access checks for session creation and teardown using the existing workspace directory state.
- Added short-lived transport token issuance, hashed token storage, transport URL generation, expiry handling, and token revocation on session end.
- Added focused controller coverage for session creation, workspace access rejection, and token revocation.
- Added a WebSocket bridge at `/organizations/:orgId/sandbox/live-sessions/:sessionId/stream` using token-gated upgrade handling.
- Added live event fanout from the sandbox session service into active websocket clients.
- Added websocket coverage for valid token event delivery and invalid token rejection.
- Added typed-turn transport handling so websocket `input.text` messages now enter the runtime path instead of echoing as placeholder client events.
- Added per-session workflow frontier state so turns can walk condition and handoff nodes before the responding role is selected.
- Added buffered voice-input transport handling with `input.audio.append` and `input.audio.commit`.
- Added websocket coverage for typed runtime completion, condition-plus-handoff routing, and committed voice-turn execution.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts`
- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`

## Pending Work

- Add browser reconnect handling and session resume semantics.
- Wire the tenant web surfaces onto the live transport so `/workflows` and `/sandbox` stop using the old in-browser runtime adapter.
- Expand transport events with richer tool-duration and live-audio playback coordination once frontend wiring lands.

## Risks And Edge Cases

- Workspace access is revoked after session start
- Browser reconnects during an active sandbox run
- Browser closes while provider streams are still open

## Decisions

- Priority: P0
- Labels: backend, runtime, security, tdd-required
- Live sandbox transport is a separate issue from the earlier local simulation slice so implementation can stay honest about what is provider-backed and what is not.
- Browser clients should connect only to Zara-owned transport and never receive long-lived provider credentials.

## Next Recommended Step

Wire `/workflows` and `/sandbox` to session creation plus websocket transport, then add reconnect and resume behavior for interrupted browser sessions.
