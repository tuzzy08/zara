# ISSUE-175: Production observability and provider benchmarking

Status: Implemented
External: [Linear ZAR-145](https://linear.app/zara-voice/issue/ZAR-145/issue-175-production-observability-and-provider-benchmarking)

## Goal

Decouple production OpenTelemetry from LangSmith, preserve LangSmith as the redacted AI behavior workbench, and add repeatable provider benchmarks for TTS and premium realtime voice providers.

## Work Completed

- Created Linear ZAR-145.
- Started implementation pass on 2026-06-13.
- Added local backlog and handover tracking for ISSUE-175.
- Added RED tests for OTel/LangSmith config separation, provider latency aggregation, and provider benchmark artifacts.
- Decoupled OTel config from LangSmith credentials with `OTEL_TRACING_ENABLED`, `OTEL_METRICS_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`, and `RUNTIME_TRACE_SAMPLE_RATE`.
- Added an app-wide API observability initialization hook before Nest app startup.
- Added a redacted in-memory provider latency metrics store and wired configured runtime/PSTN observability recorders into it.
- Exposed provider latency summaries through platform-admin AI runtime observability.
- Added provider benchmark harness, default provider catalog, CLI runner, and `bench:tts`, `bench:realtime`, and `bench:providers` scripts.
- Initially marked provider catalog entries without live adapters as `dry-run` with an explicit placeholder warning, then replaced all ISSUE-175 catalog placeholders with live benchmark adapters.
- Added the first live provider benchmark adapter for Cartesia TTS behind the shared benchmark interface, with injectable WebSocket transport contract tests, live `wss://api.cartesia.ai/tts/websocket` support, browser PCM output, and native PSTN 8 kHz mu-law output.
- Added live OpenAI TTS and Gemini TTS/native-audio benchmark adapters behind the shared benchmark interface, with injectable HTTP transport contract tests, redacted audio handling, browser PCM metadata, and PSTN transcode-required warnings for non-mu-law output.
- Added live Deepgram Aura TTS benchmark adapter behind the shared benchmark interface, with injectable HTTP transport contract tests, live `/v1/speak` support, browser 24 kHz linear16 output, native PSTN 8 kHz mu-law output, and `dg-request-id` correlation.
- Added live OpenAI Realtime and Gemini Live benchmark adapters behind the shared benchmark interface, with injectable WebSocket transport contract tests, provider-native setup messages, first-audio timing, total turn timing, and missing-credential skips before sockets open.
- Updated observability, testing, architecture, and roadmap docs.

## Tests Run

- `npm.cmd run test:run -- apps/api/src/runtime-observability/runtime-observability.test.ts --pool=threads`
- `npm.cmd run test:run -- apps/api/src/provider-benchmarks/provider-benchmarks.test.ts --pool=threads`
- `npm.cmd run test:run -- apps/api/src/runtime-observability/runtime-observability.test.ts apps/api/src/provider-benchmarks/provider-benchmarks.test.ts apps/api/src/platform-admin/platform-admin.controller.test.ts --pool=threads`
- `npm.cmd run eval:runtime`
- `npm.cmd run eval:pstn`
- `npm.cmd run typecheck --workspace @zara/api`
- `npx.cmd eslint apps/api/src/runtime-observability/runtime-observability.ts apps/api/src/runtime-observability/runtime-observability.test.ts apps/api/src/provider-benchmarks/provider-benchmarks.ts apps/api/src/provider-benchmarks/provider-benchmarks.test.ts apps/api/src/provider-benchmarks/run-provider-benchmarks.ts apps/api/src/observability/otel.ts apps/api/src/platform-admin/platform-admin.service.ts apps/api/src/platform-admin/platform-admin.models.ts apps/api/src/main.ts`
- `npm.cmd run bench:tts`
- `npm.cmd run bench:realtime`
- `npm.cmd run test:run -- apps/api/src/provider-benchmarks/provider-benchmarks.test.ts --pool=threads`
- `npm.cmd run typecheck --workspace @zara/api`
- `npx.cmd eslint apps/api/src/provider-benchmarks/provider-benchmarks.ts apps/api/src/provider-benchmarks/provider-benchmarks.test.ts`
- `npm.cmd run bench:tts`
- RED: `npm.cmd run test:run -- apps/api/src/provider-benchmarks/provider-benchmarks.test.ts --pool=threads` failed because `createDeepgramTtsBenchmarkAdapter` was not implemented.
- GREEN: `npm.cmd run test:run -- apps/api/src/provider-benchmarks/provider-benchmarks.test.ts --pool=threads`
- REFACTOR verification: `npm.cmd run test:run -- apps/api/src/provider-benchmarks/provider-benchmarks.test.ts --pool=threads`
- REFACTOR verification: `npm.cmd run typecheck --workspace @zara/api`
- REFACTOR verification: `npx.cmd eslint apps/api/src/provider-benchmarks/provider-benchmarks.ts apps/api/src/provider-benchmarks/provider-benchmarks.test.ts`
- REFACTOR verification: `npm.cmd run bench:tts`
- RED: `npm.cmd run test:run -- apps/api/src/provider-benchmarks/provider-benchmarks.test.ts --pool=threads` failed because `createOpenAiRealtimeBenchmarkAdapter` was not implemented.
- GREEN: `npm.cmd run test:run -- apps/api/src/provider-benchmarks/provider-benchmarks.test.ts --pool=threads`
- RED: `npm.cmd run test:run -- apps/api/src/provider-benchmarks/provider-benchmarks.test.ts --pool=threads` failed because `createGeminiLiveRealtimeBenchmarkAdapter` was not implemented.
- GREEN: `npm.cmd run test:run -- apps/api/src/provider-benchmarks/provider-benchmarks.test.ts --pool=threads`
- REFACTOR verification: `npm.cmd run test:run -- apps/api/src/provider-benchmarks/provider-benchmarks.test.ts --pool=threads`
- REFACTOR verification: `npm.cmd run typecheck --workspace @zara/api`
- REFACTOR verification: `npx.cmd eslint apps/api/src/provider-benchmarks/provider-benchmarks.ts apps/api/src/provider-benchmarks/provider-benchmarks.test.ts`
- REFACTOR verification: `npm.cmd run bench:realtime`
- REFACTOR verification: `npm.cmd run bench:providers`
- REFACTOR verification: `npm.cmd run bench:tts`

Broad verification attempted:
- `npm.cmd run lint` timed out after roughly 124 seconds without producing failures.
- `npm.cmd run test:run` timed out after roughly 181 seconds. Before timeout, unrelated pre-existing failures appeared in README quality gates, production ESM import build artifacts, sandbox live-session tests, and web worker timeouts.

## Pending Work

- None for ISSUE-175 acceptance.
- Re-run broad root `npm run lint` and `npm run test:run` after unrelated sandbox/live-session and README quality-gate failures are resolved or isolated.

## Risks And Edge Cases

- Raw audio, raw transcripts, provider payloads, secrets, and raw tool output must not enter traces or benchmark artifacts by default.
- Benchmarks must skip missing credentials without hiding configured-provider failures.
- OTel exporter failures must not break live calls.

## Decisions

- Use generic OTLP as the production export interface.
- Keep LangSmith as AI trace/eval tooling only.
- Initial benchmark providers are Cartesia, Gemini, Deepgram, OpenAI TTS, OpenAI Realtime, and Gemini Live.
- Deepgram Aura TTS benchmark requests follow the official REST `/v1/speak` shape with `Authorization: Token ...`, JSON `{ text }`, `encoding=linear16` for browser scenarios, and `encoding=mulaw&sample_rate=8000&container=none` for PSTN scenarios.
- Realtime benchmark adapters reuse the existing OpenAI Realtime and Gemini Live runtime adapters for provider setup/message shape instead of maintaining separate protocol implementations.

## Next Recommended Step

Move to the next prioritized issue. If broad suite cleanup is scheduled separately, isolate the existing README quality-gate, ESM import artifact, sandbox live-session, and web worker timeout failures before re-running root `npm run lint` and `npm run test:run`.
