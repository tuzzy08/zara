# ISSUE-148: PSTN observability, latency evals, and production gates

Status: Todo
Date: 2026-05-28
External: [Linear ZAR-94](https://linear.app/zara-voice/issue/ZAR-94/issue-148-pstn-observability-latency-evals-and-production-gates)

## Work Completed

- Created the reconciled local backlog entry and matching Linear issue.
- Standardized PSTN-specific metrics, traces, synthetic eval scenarios, and release gates.
- Captured that LangSmith remains internal and redacted, not tenant-facing call history.

## Tests Run

- Not run. This pass created planning docs and issue records only.

## Pending Work

- Add failing span/metric projection tests from synthetic PSTN events.
- Add redaction tests for LangSmith PSTN trace export.
- Implement platform-admin PSTN call-quality health signals and separate PSTN eval commands.
- Update observability, dashboard, telephony, testing, and production deployment docs after implementation.

## Risks

- Latency regressions can hide unless measured at media, STT, model, TTS, and outbound audio boundaries.
- LangSmith export must never include raw audio, raw transcript, caller numbers, secrets, or raw tool output.

## Decisions

- PSTN observability extends OpenTelemetry and LangSmith patterns from ISSUE-138 through ISSUE-140.
- Synthetic PSTN evals are separate from ordinary tests and use a Twilio media harness.

## Next Recommended Step

- Start RED with PSTN span and redacted trace projection tests.
