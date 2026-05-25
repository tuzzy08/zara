# ISSUE-111: Cartesia Sonic 3 streaming TTS adapter

Issue link: https://github.com/tuzzy08/zara/issues/111

## Goal

Add a real Cartesia Sonic 3 streaming TTS adapter for live sandbox sessions.

## Acceptance Criteria

- Adapter streams agent text to Cartesia Sonic 3 and returns playable audio chunks with first-byte latency metrics
- Runtime profiles can select voice and output settings without exposing provider credentials to the client
- Provider failures degrade with structured TTS runtime errors

## Work Completed

- Added ISSUE-111 to the local backlog, roadmap, and `docs/issues.json`.
- Updated runtime and API docs to set Cartesia Sonic 3 as the default sandwich-runtime TTS provider for live browser sandbox sessions.
- Added a server-side Cartesia websocket adapter contract for live sandbox TTS sessions.
- Added Cartesia session URL construction, Sonic 3 generation request building, chunk and timestamp parsing, and close/error to runtime-failure mapping.
- Added focused adapter coverage for session creation, generation request shape, stream-message parsing, and provider failure mapping.
- Added a live `CartesiaTtsProvider` that sends Sonic 3 generation requests, collects playable audio chunks, and returns first-byte latency into the sandbox runtime.
- Added env-backed provider selection so the API uses the real TTS provider whenever `CARTESIA_API_KEY` is configured.
- Added websocket integration coverage for typed and committed voice turns producing completed runtime responses with audio chunk fanout.
- Preserved Cartesia word timestamp messages through `SandwichTtsResult.wordTimestamps`, the cost-optimized runtime turn result, and the browser live sandbox transport.
- Added `turn.audio.timestamps` fanout after streamed audio chunks so the UI can coordinate playback timing without exposing provider sessions or credentials.
- Added TTS interruption support by threading an abort signal into provider synthesis and mapping cancellation to a structured `tts.interrupted` runtime provider failure.
- Updated browser event formatting so playback timestamp events show as readable live sandbox timeline entries.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/cartesia-streaming.adapter.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/cartesia-streaming.adapter.test.ts`
- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts`
- RED/GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts`
- RED/GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "routing, model, and audio"`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/cartesia-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "routing, model, and audio|Cartesia"`
- GREEN: `npm.cmd run build --workspace @zara/core`
- GREEN: `npm.cmd run typecheck --workspace @zara/api`
- GREEN: `npm.cmd run build`

## Pending Work

- No remaining ISSUE-111 blockers.

## Risks And Edge Cases

- First-byte latency breaches the runtime threshold
- Output stream cancellation now reports a structured interruption failure; future barge-in UX still needs to decide when to invoke it during overlapping caller speech.
- Requested voice or model is unavailable
- Timestamp payloads are provider-supplied and may be sparse for short responses, so UI playback should treat them as coordination hints rather than a hard transcript source.

## Decisions

- Priority: P0
- Labels: runtime, backend, tdd-required
- Cartesia Sonic 3 is the default sandwich-runtime TTS provider for browser sandbox runs.
- Audio should stream from NestJS to the browser through the Zara transport layer, not through browser-held provider sessions.
- Word timestamps travel as sandbox runtime events after audio chunks, preserving audio-first playback while giving the browser enough metadata for agent-turn animation.

## Next Recommended Step

Continue with broader live sandbox monitoring and escalation work now that Cartesia playback, timing, and cancellation are covered for the sandbox transport.
