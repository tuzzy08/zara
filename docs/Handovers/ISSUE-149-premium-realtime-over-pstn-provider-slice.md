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

## Pending Work

- None for ZAR-95.

## Risks

- Future real-provider adapter work must keep the implemented provider-neutral contract and redaction rules intact.
- Provider-native interruption semantics differ across providers; each new provider needs contract coverage before enablement.

## Decisions

- Premium realtime over PSTN is not part of PSTN sandwich v1.
- No silent downgrade from premium realtime PSTN to sandwich without explicit policy.
- `pstn-premium-realtime` is allowed only after provider capability, provider availability, tenant entitlement, budget, and explicit fallback-policy checks pass.
- Premium realtime PSTN stays in the unified Phone test sandbox, with separate labeling instead of a second sandbox.

## Next Recommended Step

- Close Linear ZAR-95 and continue with the next prioritized issue only after any follow-up provider-specific adapter work is created externally.
