# ISSUE-110: AssemblyAI streaming STT adapter

External: [GitHub #110](https://github.com/tuzzy08/zara/issues/110)

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
- Added a live `AssemblyAiSttProvider` that opens a provider websocket, forwards buffered PCM frames, emits partial transcript callbacks, and resolves the final transcript into the sandbox runtime.
- Added websocket integration coverage for committed voice turns flowing through STT and into runtime completion.
- Added env-backed provider selection so the API uses the real STT provider whenever `ASSEMBLYAI_API_KEY` is configured.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/assemblyai-streaming.adapter.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/assemblyai-streaming.adapter.test.ts`
- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/assemblyai-stt.provider.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/assemblyai-stt.provider.test.ts`

## Pending Work

- Add inactivity timeout handling and reconnect posture for longer voice sessions.
- Add richer transcript fanout coverage for multiple partials and interrupted turns.
- Replace heuristic condition-intent inference with model-backed classification for more complex route expressions.

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

Wire the browser sandbox UI to `input.audio.append` plus `input.audio.commit` so microphone turns can use the live STT path end to end.
