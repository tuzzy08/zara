# ISSUE-110: AssemblyAI streaming STT adapter

Issue link: https://github.com/tuzzy08/zara/issues/110

## Goal

Add a real AssemblyAI streaming STT adapter for live sandbox sessions.

## Acceptance Criteria

- Adapter streams browser audio to AssemblyAI and returns partial plus final transcript events
- Runtime maps provider failures into structured STT runtime errors
- Provider auth stays server side and workspace-scoped through the live sandbox session

## Work Completed

- Added ISSUE-110 to the local backlog, roadmap, and `docs/issues.json`.
- Updated runtime and API docs to set AssemblyAI as the default sandwich-runtime STT provider for live browser sandbox sessions.
- Added a server-side AssemblyAI streaming adapter contract for live sandbox sessions.
- Added AssemblyAI session URL construction, server-owned auth header handling, keepalive and terminate messages, transcript message parsing, and provider close-to-runtime-failure mapping.
- Added focused adapter coverage for session contract creation, partial/final transcript parsing, and provider failure mapping.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/assemblyai-streaming.adapter.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/assemblyai-streaming.adapter.test.ts`

## Pending Work

- Add provider env validation and live API key plumbing for AssemblyAI.
- Connect the adapter to the upcoming WebSocket live sandbox transport so browser audio frames can be forwarded to AssemblyAI.
- Add live-stream tests for inactivity timeout handling, reconnect posture, and transcript fanout into sandbox events.

## Risks And Edge Cases

- WebSocket reconnect occurs mid-utterance
- No-speech or silence timeout fires
- Unsupported audio format or sample rate is received

## Decisions

- Priority: P0
- Labels: runtime, backend, tdd-required
- AssemblyAI is the default STT provider for the sandwich runtime in browser sandbox, not a browser-direct dependency.
- The adapter should sit behind runtime contracts so telephony and browser sandbox can share it later.

## Next Recommended Step

Wire the adapter into the live sandbox transport session so incoming browser audio frames can produce real partial and final transcript events.
