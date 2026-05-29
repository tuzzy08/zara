# ISSUE-138: Packet-backed OpenTelemetry and LangSmith trace export

Status: Implemented
Date: 2026-05-27
External: [Linear ZAR-70](https://linear.app/zara-voice/issue/ZAR-70/issue-138-packet-backed-opentelemetry-and-langsmith-trace-export)

## Work Completed

- Created the implementation issue in `docs/Issue-Backlog.md`.
- Added the target observability/evals standard in `docs/Observability-And-Evals-Standard.md`.
- Linked the standard from architecture, manifest, observability, security, feature-flow, roadmap, and testing docs.
- Installed/configured `langsmith`, `@opentelemetry/api`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/exporter-trace-otlp-http`, and `@opentelemetry/resources`.
- Added packet-backed span construction, redacted LangSmith projection building, OpenTelemetry exporter setup, LangSmith run export, disabled-mode config, and exporter-failure isolation in `apps/api/src/runtime-observability/runtime-observability.ts`.
- Wired live sandbox turns to record observability after cost events and emit `runtime.warning` plus `runtime.observability` events when export failures or metrics exist.
- Updated architecture, manifest, observability, security, API, feature-flow, testing, roadmap, and backlog docs to reflect the implemented trace baseline.

## Tests Run

- `npm.cmd run test:run -- apps/api/src/runtime-observability/runtime-observability.test.ts`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts --testNamePattern "runtime observability"`
- `npm.cmd run test:run -- apps/api/src/runtime-observability/runtime-observability.test.ts apps/api/src/runtime-evals/runtime-evals.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- `npm.cmd run typecheck`

## Pending Work

- None for ISSUE-138.
- ISSUE-140 remains for CI/release gates and staff dashboard aggregation over the new observability signals.

## Risks

- OpenTelemetry and LangSmith SDK behavior should be smoke-tested with real staging credentials before production rollout.
- LangSmith export remains environment-disabled without credentials; this is expected for local development.

## Decisions

- OpenTelemetry is the runtime instrumentation layer.
- LangSmith is the AI trace destination, not the audit, billing, routing, or tenant replay source of truth.
- Redaction failure drops the export instead of degrading into unsafe export.
- Disabled tracing reports zero exported spans and does not publish noisy observability events for ordinary local turns.

## Next Recommended Step

- Move to ISSUE-140 for release eval gates and staff dashboard aggregation.
