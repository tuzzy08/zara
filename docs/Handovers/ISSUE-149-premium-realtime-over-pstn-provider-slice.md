# ISSUE-149: Premium realtime over PSTN provider slice

Status: Implemented
Date: 2026-05-28
External: [Linear ZAR-95](https://linear.app/zara-voice/issue/ZAR-95/issue-149-premium-realtime-over-pstn-provider-slice)

## Work Completed

- Created the reconciled local backlog entry and matching Linear issue.
- Captured premium realtime over PSTN as a clearly separate follow-up slice.
- Standardized that PSTN premium realtime stays blocked by default until this issue implements gates and provider capability checks.
- Moved ZAR-95 / ISSUE-149 into implementation after confirming ZAR-88, ZAR-90, and ZAR-94 blockers are closed.
- Added `pstn-premium-realtime` runtime path, call-start gate policy, and provider-neutral premium realtime PSTN turn harness in `@zara/core`.
- Routed premium PSTN dispatch through explicit provider capability, provider availability, tenant entitlement, budget posture, and fallback-policy checks.
- Preserved `runtimePath` through telephony dispatch records, Twilio stream metadata, observability projections, LangSmith redacted traces, and PSTN eval fixtures.
- Labeled premium realtime PSTN separately in the unified Phone test sandbox while keeping one sandbox surface.
- Updated architecture, telephony, runtime manifest, observability, testing, feature-flow, readiness, roadmap, backlog, and PSTN standard docs.
- Follow-up on 2026-07-11: persisted every successfully published compiled runtime manifest in tenant-scoped Postgres storage and made exact published-version lookup the only PSTN runtime source.
- Follow-up on 2026-07-11: connected authorized Twilio premium Media Streams to `RuntimeSessionsService` and the server-owned provider transport, including inbound mu-law conversion, provider-native tools/handoffs, transcript/checklist projection, interruption clears, and outbound Twilio media.
- Follow-up on 2026-07-11: made OpenAI Realtime the platform-policy default, requested native `audio/pcmu` output for PSTN, kept provider/model mutation platform-admin-only, exposed only the effective provider to tenant voice UI, and prevented stale tenant provider/model values from overriding policy.
- Follow-up on 2026-07-11: moved phone-test persistence off the 20 ms audio path, records media checkpoints once, closes Twilio on unexpected provider termination, and explicitly removes completed PSTN runtime sessions.
- Follow-up on 2026-07-14: traced a routed call that authorized its Twilio Media Stream, delivered inbound media, and closed normally without agent audio to the missing initial provider response request. Premium PSTN execution now requests one opening greeting after initial OpenAI or Gemini provider readiness, using the active concrete agent name and business name from the immutable manifest before asking how it may help. Generic role-name fallbacks are forbidden, missing identity fails closed with `premium_initial_agent_identity_unavailable`, and provider handoff keeps its separate continuation contract. A failed greeting write closes both call legs and the runtime session with the safe `premium_provider_send_failed` code.

## Tests Run

- `.\node_modules\.bin\vitest.cmd run packages/core/src/pstn-premium-realtime-runtime.test.ts --pool=threads`
- `.\node_modules\.bin\vitest.cmd run packages/core/src/telephony.test.ts --pool=threads`
- `.\node_modules\.bin\vitest.cmd run apps/api/src/telephony/telephony.controller.test.ts packages/core/src/telephony.test.ts --pool=threads`
- `.\node_modules\.bin\vitest.cmd run apps/api/src/runtime-observability/runtime-observability.test.ts --pool=threads`
- `.\node_modules\.bin\vitest.cmd run apps/api/src/runtime-evals/runtime-evals.test.ts --pool=threads`
- `npm.cmd run eval:pstn`
- `.\node_modules\.bin\vitest.cmd run apps/web/src/app.test.tsx --pool=threads --testNamePattern "premium realtime PSTN"`
- `.\node_modules\.bin\vitest.cmd run packages/core/src/pstn-premium-realtime-runtime.test.ts packages/core/src/pstn-sandwich-runtime.test.ts packages/core/src/telephony.test.ts apps/api/src/telephony/telephony.controller.test.ts apps/api/src/telephony/twilio-media-streams.bridge.test.ts apps/api/src/runtime-observability/runtime-observability.test.ts apps/api/src/runtime-evals/runtime-evals.test.ts apps/web/src/app.test.tsx --pool=threads`
- `npm.cmd run typecheck`
- Follow-up on 2026-07-11: focused workflow-manifest, premium PSTN execution, Twilio Media Streams, runtime-policy, runtime-session, agent-class API, and builder provider-display suites passed.
- Follow-up on 2026-07-11: `npm.cmd run typecheck --workspace @zara/api` passed.
- Follow-up on 2026-07-14: `npx.cmd vitest run apps/api/src/telephony/pstn-premium-call-execution.test.ts --pool=threads --maxWorkers=1 --testTimeout=30000 --reporter=dot` passed 22 tests.
- Follow-up on 2026-07-14: focused ESLint passed, `npm.cmd run typecheck --workspace @zara/api` passed, and `npm.cmd run eval:pstn` passed all 25 scenarios.

## Pending Work

- None for ZAR-95.

## Risks

- Existing published workflows must be republished after the manifest-storage migration before they can start a premium PSTN execution; there is intentionally no draft or legacy-role fallback.
- Gemini PSTN readiness ordering and provider/voice-changing PSTN handoff reconnection remain follow-up hardening; OpenAI is the production-default path implemented in this pass.
- Provider-native interruption semantics differ across providers; each new provider needs contract coverage before enablement.

## Decisions

- Premium realtime over PSTN is not part of PSTN sandwich v1.
- No silent downgrade from premium realtime PSTN to sandwich without explicit policy.
- `pstn-premium-realtime` is allowed only after provider capability, provider availability, tenant entitlement, budget, and explicit fallback-policy checks pass.
- Premium realtime PSTN stays in the unified Phone test sandbox, with separate labeling instead of a second sandbox.

## Next Recommended Step

- Deploy the initial-greeting fix and run one real OpenAI premium Phone test. Confirm the call progresses from media authorization and provider readiness through the initial response, outbound audio, caller turn, and clean stop.
