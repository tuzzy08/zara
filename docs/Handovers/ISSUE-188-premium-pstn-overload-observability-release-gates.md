# ISSUE-188: Premium PSTN overload observability and release gates

Status: Implemented
Date: 2026-07-12
External: [Linear ZAR-218](https://linear.app/zara-voice/issue/ZAR-218/issue-188-premium-pstn-overload-observability-and-release-gates)

## Work Completed
- Ticket and dependency relations created.
- Audited the existing PSTN recorder, premium actor, playback controller, eval suite, and runbooks after ISSUE-187.
- Added redacted premium spans and metrics for successful/failed readiness latency, startup and handoff ingress, provider WebSocket pressure, provider-output queue depth, playback bytes/frames/lag/generation/marks/boundary acknowledgements, overflows, dropped stale frames, interruptions, handoff duration, and cleanup.
- Preserved safe internal premium failure codes, separated provider failures from runtime failures, removed provider-controlled error text from logs, and made playback-clear and stale-generation counts reflect actual events.
- Extracted the bounded provider-output pressure ledger so production execution and release evals exercise the same 64 KiB/256-message contract.
- Replaced reference-copying PSTN eval output with executable actor/playback/pressure scenarios. Empty gates fail, provider drift affects only its provider gate, and cost-optimized, OpenAI, and Gemini gates remain separate.
- Added the premium PSTN failure runbook covering readiness, congestion, queue/playback overflow, stale generations, playback clear, handoff replacement, cleanup, and release decisions.
- Completed an independent code review and resolved all six findings before completion.
## Tests Run
- `npm run test:run -- apps/api/src/telephony/pstn-premium-call-execution.test.ts apps/api/src/telephony/pstn-premium-playback-controller.test.ts apps/api/src/runtime-observability/runtime-observability.test.ts` (39 passed).
- `npm run test:run -- apps/api/src/telephony/premium-provider-message-pressure.test.ts apps/api/src/telephony/pstn-premium-call-execution.test.ts apps/api/src/runtime-evals/runtime-evals.test.ts` (33 passed).
- `npm run typecheck --workspace @zara/api` (passed).
- Focused ESLint for changed runtime/observability files (passed).
- Combined runtime/telephony suite: 11 files, 136 tests passed.
- `npm run eval:pstn`: 25/25 scenarios passed across the three release gates.
## Pending Work
- None for ISSUE-188.
## Risks
- Eval scenarios are deterministic contract probes, not live-provider load tests; production provider benchmarks and staged canaries remain separate release evidence.
- Observability export remains asynchronous and must not add latency to the media path.
## Decisions
- OpenAI/Gemini premium evals and cost-optimized PSTN regression gates remain distinct.
- Provider payloads, caller content, credentials, and provider-controlled errors are excluded from logs and observability projections.
- Bounds are release contracts. Incident response must not raise them as an emergency workaround.
## Next Recommended Step
- Use `docs/Premium-PSTN-Failure-Runbook.md` during staged premium PSTN promotion and require all three `npm run eval:pstn` gates to pass.
