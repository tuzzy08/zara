# ISSUE-188: Premium PSTN overload observability and release gates

Status: Implemented
Date: 2026-07-13
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
- Fixed API bootstrap for `PstnPremiumCallExecution` by assigning explicit Nest injection tokens to its three structurally typed service dependencies; added a focused provider-graph regression test so `Pick<Service, ...>` metadata cannot silently regress to unresolved `Object` tokens.
- Follow-up on 2026-07-14: traced Twilio error 31921 to Zara closing an authorized premium Media Streams socket with the opaque `twilio_media.handler_failed` reason before attempting the provider connection.
- Follow-up on 2026-07-14: added stage-aware startup failures for telephony state, dispatch validation, exact manifest loading/validation, runtime-session creation/registration, provider connection, and provider readiness. The bridge logs only the safe code and stage and uses the safe code as its close reason.
## Tests Run
- `npm run test:run -- apps/api/src/telephony/pstn-premium-call-execution.test.ts apps/api/src/telephony/pstn-premium-playback-controller.test.ts apps/api/src/runtime-observability/runtime-observability.test.ts` (39 passed).
- `npm run test:run -- apps/api/src/telephony/premium-provider-message-pressure.test.ts apps/api/src/telephony/pstn-premium-call-execution.test.ts apps/api/src/runtime-evals/runtime-evals.test.ts` (33 passed).
- `npm run typecheck --workspace @zara/api` (passed).
- Focused ESLint for changed runtime/observability files (passed).
- Combined runtime/telephony suite: 11 files, 136 tests passed.
- `npm run eval:pstn`: 25/25 scenarios passed across the three release gates.
- `npx.cmd vitest run apps/api/src/telephony/pstn-premium-call-execution.test.ts apps/api/src/telephony/pstn-premium-call-execution.wiring.test.ts --pool=forks --fileParallelism=false` (21 passed).
- `npm.cmd run typecheck --workspace @zara/api` (passed).
- TSC-built API bootstrap smoke check initialized `AppModule`, `RuntimeSessionsModule`, and `TelephonyModule`, logged `Nest application successfully started`, and closed cleanly.
- `apps/api/src/app.module.test.ts` no longer raised the reported dependency exception, but its first test exceeded the existing hardcoded 15-second timeout on this machine after a 43-second module import.
- Follow-up on 2026-07-14 RED: the focused Twilio WebSocket suite failed because the bridge returned `twilio_media.handler_failed` instead of a classified startup failure.
- Follow-up on 2026-07-14 GREEN: the combined Twilio WebSocket and premium execution suites passed 26 tests.
- Follow-up on 2026-07-14: root ESLint passed, `npm.cmd run typecheck --workspace @zara/api` passed, and `npm.cmd run eval:pstn` passed all 25 scenarios.
## Pending Work
- None for ISSUE-188.
## Risks
- Eval scenarios are deterministic contract probes, not live-provider load tests; production provider benchmarks and staged canaries remain separate release evidence.
- Observability export remains asynchronous and must not add latency to the media path.
- The broad `AppModule` test has a 15-second per-test timeout that can be shorter than local module initialization under load; the focused wiring regression remains the deterministic DI gate.
- The pre-fix trace cannot distinguish an unavailable exact manifest from runtime-session setup failure because the old bridge discarded the exception. The first post-deploy phone test must confirm the new `failureCode` and `stage`; no draft or legacy manifest fallback should be introduced.
## Decisions
- OpenAI/Gemini premium evals and cost-optimized PSTN regression gates remain distinct.
- Provider payloads, caller content, credentials, and provider-controlled errors are excluded from logs and observability projections.
- Bounds are release contracts. Incident response must not raise them as an emergency workaround.
## Next Recommended Step
- Deploy the stage-aware startup diagnostics and repeat one premium phone test. If it reports `premium_manifest_unavailable`, republish the workflow to create a fresh immutable version and assign that exact version to the number; otherwise follow the emitted stage in `docs/Premium-PSTN-Failure-Runbook.md`.
