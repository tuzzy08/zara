# ISSUE-148: PSTN observability, latency evals, and production gates

Status: Implemented
Date: 2026-05-28
External: [Linear ZAR-94](https://linear.app/zara-voice/issue/ZAR-94/issue-148-pstn-observability-latency-evals-and-production-gates)

## Work Completed

- Created the reconciled local backlog entry and matching Linear issue.
- Standardized PSTN-specific metrics, traces, synthetic eval scenarios, and release gates.
- Captured that LangSmith remains internal and redacted, not tenant-facing call history.
- Moved Linear ZAR-94 and local issue records to In Progress for the implementation pass.
- Added PSTN trace projection with OpenTelemetry-ready spans, internal metrics, and redacted LangSmith PSTN projections.
- Wired Twilio webhook and media WebSocket lifecycle events into the PSTN observability recorder.
- Added platform-admin PSTN call-quality signals and UI copy on the staff-only runtime health surface.
- Added deterministic `zara.pstn-media.v1` fixtures, `pstn.vitest.config.ts`, `npm run eval:pstn`, and a separate CI PSTN eval gate.
- Updated observability, dashboard, telephony, testing, production deployment, PSTN standard, roadmap, and backlog docs.

## Tests Run

- `npm.cmd run typecheck`
- `npm.cmd run test:run -- --pool=forks apps/api/src/runtime-observability/runtime-observability.test.ts apps/api/src/runtime-evals/runtime-evals.test.ts apps/api/src/platform-admin/platform-admin.controller.test.ts apps/platform-admin/src/index.test.tsx packages/core/src/ci-quality-gates.test.ts apps/api/src/telephony/twilio-media-streams.websocket.test.ts apps/api/src/telephony/telephony.controller.test.ts`
- `npm.cmd run eval:pstn`
- `npm.cmd run eval:runtime`

## Pending Work

- None for ISSUE-148.
- Premium realtime over PSTN remains tracked by ISSUE-149.

## Risks

- Real provider health can still degrade while synthetic evals pass; release gates require platform-admin dashboard review and owner-recorded provider-outage exceptions.
- LangSmith outages must not block live calls; exporter failures remain isolated and observable.

## Decisions

- PSTN observability extends OpenTelemetry and LangSmith patterns from ISSUE-138 through ISSUE-140.
- Synthetic PSTN evals are separate from ordinary tests and use a Twilio media harness.
- PSTN media evals use `npm run eval:pstn`, not `npm run eval:runtime`, so telephony gates can evolve without changing non-PSTN packet scorecards.
- LangSmith PSTN export uses a redacted projection and never exports raw audio, raw transcript, caller numbers, secrets, credentials, or untrusted tool output.

## Next Recommended Step

- Start ISSUE-149: Premium realtime over PSTN provider slice.
