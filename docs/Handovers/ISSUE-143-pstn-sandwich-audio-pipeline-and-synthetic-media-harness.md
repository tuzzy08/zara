# ISSUE-143: PSTN sandwich audio pipeline and synthetic media harness

Status: Todo
Date: 2026-05-28
External: [Linear ZAR-89](https://linear.app/zara-voice/issue/ZAR-89/issue-143-pstn-sandwich-audio-pipeline-and-synthetic-media-harness)

## Work Completed

- Created the reconciled local backlog entry and matching Linear issue.
- Standardized `pstn-sandwich` as the first real PSTN runtime path for cost-optimized and balanced calls.
- Captured latency thresholds, audio defaults, interruption behavior, and synthetic media harness requirements in the PSTN standard.

## Tests Run

- Not run. This pass created planning docs and issue records only.

## Pending Work

- Add failing tests for mu-law 8 kHz frame handling, synthetic clean-turn execution, timeout classification, and barge-in.
- Implement the PSTN-optimized STT -> text model -> TTS path that shares the existing workflow and packet core.
- Configure PSTN-safe STT/TTS metadata, including Cartesia `pcm_mulaw` 8000 output when available.
- Update runtime, telephony, observability, and testing docs after implementation.

## Risks

- Treating PSTN audio like browser audio could harm latency and call quality.
- Interruption during side-effect tool execution needs careful packet and policy handling.

## Decisions

- PSTN sandwich v1 uses Zara-owned barge-in and clear events.
- Premium realtime over PSTN remains a separate later slice.

## Next Recommended Step

- Start RED with codec/frame fixture tests and synthetic media harness coverage.
