# ISSUE-046: Session memory

Issue link: https://github.com/tuzzy08/zara/issues/46

## Goal

Deliver Session memory for the Memory area in the Monitoring milestone.

## Acceptance Criteria

- Active call memory is available within the session
- Session memory is cleared or summarized after call
- Tests cover interruption and resume

## Work Completed

- Added live sandbox session memory to the server-side session record.
- Added `GET /organizations/:orgId/sandbox/live-sessions/:sessionId/memory`.
- Session memory captures text from `turn.transcribed` and `turn.completed` events while a session is active.
- Session memory survives reconnect because it is stored with the server-side session, not the transport token.
- Ending a session summarizes memory and clears raw memory entries.
- Session memory ignores non-text interruption/audio-buffer events so raw audio payloads are not stored.
- Updated `docs/API.md` and `docs/Memory.md`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts -t "session memory"` failed with `404` before the memory endpoint existed.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts -t "session memory"`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/app.module.test.ts`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/api`

## Pending Work

- None for ISSUE-046 acceptance.

## Risks And Edge Cases

- Long call context overflow: active raw entries are capped to the most recent 12 text entries, and end-session summarization clears raw entries.
- Reconnect: covered by controller test; memory remains attached to the session record through reconnect token issuance.

## Decisions

- Priority: P0
- Labels: memory, tdd-required
- Handover docs are mandatory for every pass on this issue.
- ISSUE-046 is scoped to short-term session memory only. Durable caller/account memory begins in ISSUE-047 and later memory extraction/approval issues.
- Session memory stores text snippets only and deliberately excludes raw audio payloads.
- Ending a session keeps a short summary for replay/monitoring context while clearing raw active-call entries.

## Next Recommended Step

Run final verification, then move to ISSUE-047 caller account memory if all checks pass.
