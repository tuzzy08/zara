# ISSUE-173: Add experimental Cartesia Ink 2 STT provider

Status: Implemented
External: [Linear ZAR-143](https://linear.app/zara-voice/issue/ZAR-143/issue-173-add-experimental-cartesia-ink-2-stt-provider)

## Goal

Support Cartesia STT as an experimental selectable provider for benchmarking and future simplification.

## Work Completed

- Created the Linear issue and local backlog entry.
- Started implementation pass on 2026-06-11.
- Moved Linear ZAR-143, local backlog, and this handover to In Progress.
- Verified current Cartesia docs for Ink 2, `/stt/turns/websocket`, turn lifecycle events, English-only status, and clean close command.
- Added Cartesia Ink 2 STT adapter and provider.
- Added `LIVE_SANDBOX_STT_PROVIDER=cartesia-ink-2` experimental selection while preserving AssemblyAI default.
- Mapped Cartesia turn lifecycle events into Zara provider telemetry, partials, and finals.
- Kept `turn.eager_end` as telemetry-only in v1.
- Added non-English manifest blocking for Cartesia-selected sessions.
- Updated provider stack metadata to report selected STT provider.
- Moved Linear ZAR-143, local backlog, and this handover to Implemented.

## Tests Run

- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/cartesia-stt.adapter.test.ts apps/api/src/sandbox-live-sessions/cartesia-stt.provider.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts --pool=threads`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/assemblyai-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/assemblyai-stt.provider.test.ts apps/api/src/sandbox-live-sessions/cartesia-stt.adapter.test.ts apps/api/src/sandbox-live-sessions/cartesia-stt.provider.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts packages/core/src/runtime.test.ts --pool=threads`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run lint`

## Pending Work

- None for ISSUE-173 acceptance criteria.

## Risks And Edge Cases

- Cartesia Ink 2 is English-only for this v1 path.
- Eager endpoint events are useful telemetry but should not trigger speculative response playback yet.
- Provider metadata must make benchmark comparisons unambiguous.
- Cartesia auto-turn mode does not support manual finalize; Zara's `forceEndpoint()` is a no-op for this experimental provider.

## Decisions

- Cartesia STT stays experimental/config-selected, not tenant-default.
- AssemblyAI remains default until benchmarks prove Cartesia is better for Zara workloads.
- Runtime selection uses `LIVE_SANDBOX_STT_PROVIDER=cartesia-ink-2` and the existing Cartesia API key/version.

## Next Recommended Step

Proceed to ISSUE-174: tenant voice library, voice tuning, and Cartesia voice cloning.
