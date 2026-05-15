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

## Tests Run

- Documentation pass only for this issue seed.

## Pending Work

- Add provider configuration and env validation for Cartesia sandbox streaming.
- Implement the server-side TTS streaming adapter and output format contract.
- Add RED/GREEN coverage for first-byte latency metrics, stream cancelation, and provider error mapping.

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

Write failing adapter tests for the TTS provider contract, then add Cartesia config and stream handling in the runtime layer.
