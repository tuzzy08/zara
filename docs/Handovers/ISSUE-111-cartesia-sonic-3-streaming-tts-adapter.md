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

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/cartesia-streaming.adapter.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/cartesia-streaming.adapter.test.ts`

## Pending Work

- Add provider env validation and live API key plumbing for Cartesia.
- Connect the adapter to the live sandbox runtime so generated audio chunks stream back through the websocket transport.
- Add first-byte latency tracking and interruption handling in the live runtime path.

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

Wire the adapter into the live runtime session so Cartesia chunk and timestamp events flow back to the browser transport in real time.
