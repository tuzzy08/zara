# ISSUE-143: PSTN sandwich audio pipeline and synthetic media harness

Status: Implemented
Date: 2026-05-28
External: [Linear ZAR-89](https://linear.app/zara-voice/issue/ZAR-89/issue-143-pstn-sandwich-audio-pipeline-and-synthetic-media-harness)

## Work Completed

- Created the reconciled local backlog entry and matching Linear issue.
- Standardized `pstn-sandwich` as the first real PSTN runtime path for cost-optimized and balanced calls.
- Captured latency thresholds, audio defaults, interruption behavior, and synthetic media harness requirements in the PSTN standard.
- Moved Linear ZAR-89 and local backlog state to In Progress for implementation.
- Added `packages/core/src/pstn-sandwich-runtime.ts` and exported it from `@zara/core`.
- Added provider-neutral G.711 mu-law 8 kHz audio frame contracts, telephony STT/TTS input contracts, runtime thresholds, synthetic turn execution, packet-backed caller turn creation, outbound mu-law frame emission, TTS format fallback, model timeout safe closeout, no-frame safe closeout, and barge-in/clear events.
- Added AssemblyAI `pcm_mulaw` 8 kHz streaming metadata support and Cartesia raw `pcm_mulaw` 8 kHz generation support while preserving browser defaults.
- Updated `docs/PSTN-Live-Call-Runtime-Standard.md`, `docs/Architecture.md`, `docs/Runtime-Manifests.md`, `docs/Telephony.md`, `docs/Testing-Strategy.md`, `docs/Observability-And-Evals-Standard.md`, `docs/Issue-Backlog.md`, and `docs/Roadmap.md`.

## Tests Run

- `.\\node_modules\\.bin\\vitest.cmd run packages/core/src/pstn-sandwich-runtime.test.ts --pool=threads` (RED: missing `createPstnSandwichRuntime`)
- `.\\node_modules\\.bin\\vitest.cmd run apps/api/src/sandbox-live-sessions/assemblyai-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/cartesia-streaming.adapter.test.ts --pool=threads` (RED: provider defaults were still browser PCM settings)
- `.\\node_modules\\.bin\\vitest.cmd run apps/api/src/sandbox-live-sessions/assemblyai-stt.provider.test.ts --pool=threads` (RED: provider did not pass `pcm_mulaw` through)
- `.\\node_modules\\.bin\\vitest.cmd run apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts --pool=threads` (RED: provider did not pass `pcm_mulaw` output through)
- `.\\node_modules\\.bin\\vitest.cmd run packages/core/src/pstn-sandwich-runtime.test.ts --pool=threads`
- `npm.cmd run typecheck:core`
- `.\\node_modules\\.bin\\vitest.cmd run packages/core/src/pstn-sandwich-runtime.test.ts packages/core/src/live-call-session.test.ts packages/core/src/runtime.test.ts packages/core/src/turn-runtime-packet.test.ts --pool=threads`
- `.\\node_modules\\.bin\\vitest.cmd run apps/api/src/sandbox-live-sessions/assemblyai-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/assemblyai-stt.provider.test.ts apps/api/src/sandbox-live-sessions/cartesia-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts packages/core/src/pstn-sandwich-runtime.test.ts --pool=threads`
- `npm.cmd run typecheck`
- `npm.cmd run test:run -- --pool=forks`
- `git diff --check`
- `rg -n 'Twilio|twilio|sandbox-live|LiveSandbox|createSandboxCallSession|workspaceId \\?\\? ""' .\\packages\\core\\src\\pstn-sandwich-runtime.ts` (no matches)

## Pending Work

- None for ISSUE-143.

## Risks

- ISSUE-144 must connect real provider media to the provider-neutral frame contract without adding Twilio types to `@zara/core`.
- Side-effect tool execution is still intentionally not undone by barge-in; later bridge/runtime work must preserve that guard when tools run during active calls.

## Decisions

- PSTN sandwich v1 uses Zara-owned barge-in and clear events.
- Premium realtime over PSTN remains a separate later slice.

## Next Recommended Step

- Move to ISSUE-144 / ZAR-90: Twilio bidirectional Media Streams bridge.
