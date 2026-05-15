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

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/cartesia-streaming.adapter.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/cartesia-streaming.adapter.test.ts`
- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts`

## Pending Work

- Add interruption and barge-in handling for mid-stream TTS cancellation.
- Expand browser playback coordination so chunk timing can be honored directly in the UI layer.
- Add timestamp fanout events to the browser transport when the frontend is ready to render them.

## Risks And Edge Cases

- First-byte latency breaches the runtime threshold
- Output stream is canceled during interruption or barge-in
- Requested voice or model is unavailable

## Decisions

- Priority: P0
- Labels: runtime, backend, tdd-required
- Cartesia Sonic 3 is the default sandwich-runtime TTS provider for browser sandbox runs.
- Audio should stream from NestJS to the browser through the Zara transport layer, not through browser-held provider sessions.

## Next Recommended Step

Wire the tenant sandbox surfaces to play the live Cartesia audio chunks returned over the session transport.
