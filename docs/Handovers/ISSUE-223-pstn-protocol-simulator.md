# ISSUE-223: Deterministic PSTN protocol simulator

- Status: Implemented
- External: [Linear ZAR-225](https://linear.app/zara-voice/issue/ZAR-225/pstn-capacity-212-build-deterministic-twilio-and-openai-protocol)
- Parent: [Linear ZAR-223](https://linear.app/zara-voice/issue/ZAR-223/pstn-capacity-qualification-admission-control-and-horizontally)

## Work Completed

- Added `@zara/pstn-protocol-simulator` as a standalone workspace outside the API process.
- Added exact Twilio form signing, structured Connect Stream TwiML parsing, queryless `wss` enforcement, one-time custom stream-parameter extraction, deterministic call/stream identifiers, and call-specific 8 kHz mono PCMU fingerprints.
- Added a virtual caller that emits connected, start, media, mark acknowledgement, and stop messages at 20 ms cadence and supports mark delay/loss, silence, delayed interruption, faster cadence, and abrupt disconnect.
- Added an external OpenAI Realtime WebSocket simulator for session readiness, normalized caller turns, response audio and transcripts, tool and handoff calls, incomplete responses, malformed protocol output, rate limits, output pressure, provider closure, and deterministic timing.
- Added test/staging-only provider endpoint selection at the existing premium transport seam, simulator call identity headers without credentials, and production startup rejection.
- Added `npm run smoke:pstn-protocol` for normal, interrupted, tool/handoff, and provider-failure scenarios with count-only redacted output.
- Added behavior-based smoke completion: normal requires isolated outbound media, interruption requires Zara `clear`, handoff requires a second ready provider connection with a distinct active agent plus continuation, and provider failure requires Zara to close the caller leg abnormally.
- Added cancellable provider output tasks so simulated caller speech can interrupt an in-flight greeting while client command admission remains serialized and duplicate media appends cannot create duplicate turns.
- Added silence-delimited multi-turn simulation, unique response/item/call identities, and exact requested-target attribution so handoff smoke proves that the intended specialist continues the call.
- Added bounded media-socket establishment, exceptional-path cleanup, and playback cancellation on provider close so failed simulations do not retain sockets, queued audio, or mark acknowledgements.
- Added per-provider-leg tool state, bounded per-call protocol records, stream-SID validation, payload-duration playback pacing, authenticated `wss` for non-loopback staging simulators, and redacted failure codes.
- Added bounded hashed token-replay evidence, run-unique Call SIDs, bounded simulator records, explicit per-call release, awaited provider connection cleanup, and bounded forced shutdown.

## Tests Run

- RED: provider endpoint, Twilio protocol, OpenAI scenario, virtual caller, and external WebSocket server tests failed before their production implementations existed.
- GREEN: 8 focused files and 56 tests pass.
- GREEN: API and protocol-simulator TypeScript checks pass.
- GREEN: focused ESLint passes for every changed TypeScript source and test file.
- GREEN: 9 premium/telephony provider, tool, handoff, interruption, playback, and Twilio suites pass with 140 tests.
- GREEN: `npm run eval:pstn` passes all 25 PSTN evals.
- Full repository run: 136 files and 1005 tests passed. The saturated parallel run left two outliers: the ESM output check saw unpatched output from the preceding typecheck and one telephony controller test exceeded its fixed five-second timeout. After rebuilding patched API output, both outliers passed independently (1/1 and 22/22). Eight web workers also failed to start under the saturated run; none touched this backend-only change.
- Final repository-wide reruns after the simulator hardening exceeded the five- and ten-minute command ceilings on the busy workstation without returning a result. No orphaned Vitest workers remained; the focused and 140-test regression suites above pass after those changes.

## Pending Work

- None for ISSUE-223.
- Measured concurrency curves, resource saturation, and certified capacity remain follow-up work under ZAR-223.

## Risks

- The smoke command requires seeded staging telephony state with a routed premium workflow; it does not create or mutate tenant setup.
- Stalled timing remains active until the simulated provider connection is interrupted or closed; socket shutdown cancels and releases the task.
- The simulator validates protocol and isolation behavior; measured concurrency and certified capacity remain later tickets.

## Decisions

- Keep both simulators in one external workspace while preserving separate caller and provider components.
- Reuse the existing premium provider transport seam and pass only an opaque call identity header to correlate scenarios.
- Reject simulator mode outside test/staging and force a startup-time production check.
- Keep smoke output to scenario names, outcomes, counts, and a credential-free endpoint.

## Next Recommended Step

Use this simulator as the protocol foundation for the synthetic load driver in ZAR-227.
