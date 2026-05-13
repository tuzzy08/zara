# ISSUE-019: Cost optimized sandwich runtime adapter

Issue link: https://github.com/tuzzy08/zara/issues/19

## Goal

Deliver Cost optimized sandwich runtime adapter for the Runtime area in the Sandbox milestone.

## Acceptance Criteria

- Adapter streams STT to text model to TTS
- Call events capture each stage
- Provider failures degrade predictably

## Work Completed

- Added the cost-optimized sandwich runtime adapter in `packages/core/src/runtime.ts`.
- Added adapter coverage in `packages/core/src/runtime.test.ts`.
- Adapter now orchestrates:
  - STT transcription
  - model-tier selection
  - streamed text response generation
  - TTS synthesis
  - ordered call event emission for each turn
- Predictable degradation paths now exist for:
  - STT timeout
  - model stream interruption with partial response preservation
  - TTS first-byte latency spikes

## Tests Run

- `npm.cmd run test:run -- packages/core/src/runtime.test.ts`
- `npm.cmd run test:run -- --pool=threads`
- `npm.cmd run typecheck`
- `npm.cmd run lint`

## Pending Work

- Connect the adapter to the forthcoming sandbox session APIs and browser event stream.
- Add provider-specific adapters once STT/model/TTS vendor choices are finalized for sandbox.

## Risks And Edge Cases

- STT timeout
- TTS first byte delay
- Model stream interruption

## Decisions

- Priority: P0
- Labels: runtime, tdd-required
- Handover docs are mandatory for every pass on this issue.
- The adapter returns ordered call events as an in-memory turn result for now; ISSUE-023 will project those into the live event stream.
- STT failures degrade into a safe “please repeat that” response instead of hard-ending the sandbox turn.
- Model interruption keeps any partial answer already generated so the caller is not punished for mid-stream provider failures.

## Next Recommended Step

Build ISSUE-023 and ISSUE-025 on top of this adapter so the sandbox browser session can show live turn events and latency/cost telemetry.
