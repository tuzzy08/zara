# ISSUE-222: PSTN single-instance capacity posture

- Status: Implemented
- External: [Linear ZAR-224](https://linear.app/zara-voice/issue/ZAR-224/pstn-capacity-112-expose-single-instance-capacity-posture)
- Parent: [Linear ZAR-223](https://linear.app/zara-voice/issue/ZAR-223/pstn-capacity-qualification-admission-control-and-horizontally)

## Work Completed

- Added one low-cardinality PSTN capacity recorder for call lifecycle, process resources, Twilio/provider WebSockets, bounded queues, Postgres pool/query/transaction/advisory-lock pressure, and metric-export health.
- Added periodic process sampling for CPU, event-loop delay, RSS, heap, external memory, garbage collection, and file descriptors where the host exposes them. Missing optional samples are reported as unavailable instead of healthy zeroes.
- Instrumented premium call execution and handoff, Twilio media-stream lifecycle, and Postgres telephony persistence without placing tenant, call, stream, response, phone-number, or tool identifiers in metric attributes.
- Exposed the redacted live posture through the existing staff-guarded `GET /platform-admin/runtime/ai-observability` response. No tenant endpoint exposes this posture.
- Added a nonfatal observed OTLP metric exporter so asynchronous export failures appear in the staff posture without entering the live-call failure path.
- Documented the provisional worker envelope: 20 premium calls, 2 vCPU, 1 GiB memory, 4096 file descriptors, Postgres pool size 10, 50 ms event-loop p99, and two WebSocket legs per premium call. The envelope is explicitly not certified capacity or admission enforcement.
- Completed a two-reviewer standards/specification pass. Corrections made after review include idempotent terminal accounting, failed-connect handshake telemetry, worst-call queue saturation, sample-window socket rates, close classification, periodic sampling, explicit unavailable posture, and queue-drop coverage.

## Tests Run

- RED: focused tests failed before production changes for capacity thresholds/redaction, staff projection, premium lifecycle/handshake/queue telemetry, Twilio ownership, Postgres pressure, and exporter-failure reporting.
- GREEN: capacity recorder tests, runtime-observability tests, platform-admin service/controller tests, Twilio media-stream tests, and Postgres repository tests passed: 42 tests across 6 files.
- GREEN: `apps/api/src/telephony/pstn-premium-call-execution.test.ts`: 37/37 passed after correcting the capacity observer test double.
- GREEN: API TypeScript check passed.
- GREEN: focused ESLint passed for all changed API source and test files.
- Full repository run: 139 files and 1101 tests passed. Two unrelated, pre-existing dirty landing-page tests failed; `production-esm-imports.test.ts` also exceeded its fixed 20-second filesystem-scan timeout when run against patched output and did not report unresolved specifiers.

## Pending Work

- None for ISSUE-222.
- Synthetic Twilio/provider load qualification, distributed admission, and certified capacity remain follow-up tickets under ZAR-223.

## Risks

- The 20-call ceiling is provisional and must not be presented as measured or supported concurrency until the load harness qualifies it.
- File-descriptor utilization is unavailable on hosts that do not expose `/proc/self/fd`; the posture reports that absence explicitly.
- This issue adds visibility only. It does not reject calls, reserve distributed capacity, or coordinate multiple workers.

## Decisions

- Keep the provisional concurrent premium-call ceiling at 20 until the load qualification ticket produces evidence.
- Reuse the existing staff-only runtime observability route for read posture; tenant APIs will not expose process or provider internals.
- Treat 70 percent as warning, 85 percent as critical, and 100 percent as exhausted for resources with a declared limit.
- Aggregate queue status by the most saturated observed call while retaining aggregate depth, so idle calls cannot hide one exhausted call.
- Keep telemetry failures nonfatal and observable through the same staff posture.

## Next Recommended Step

Proceed to the synthetic Twilio/provider load-harness ticket and use this posture to establish a measured single-worker capacity curve.
