# ISSUE-138: Packet-backed OpenTelemetry and LangSmith trace export

Status: Pending
Date: 2026-05-27
External: [Linear ZAR-70](https://linear.app/zara-voice/issue/ZAR-70/issue-138-packet-backed-opentelemetry-and-langsmith-trace-export)

## Work Completed

- Created the implementation issue in `docs/Issue-Backlog.md`.
- Added the target observability/evals standard in `docs/Observability-And-Evals-Standard.md`.
- Linked the standard from architecture, manifest, observability, security, feature-flow, roadmap, and testing docs.

## Tests Run

- Not run. This pass created documentation and backlog records only.

## Pending Work

- Add failing tests for span construction from packet facts.
- Install and configure the approved OpenTelemetry and LangSmith runtime libraries.
- Emit packet-backed spans for call sessions, turns, packet lifecycle, graph visits, intent, tools, transfers, model calls, and TTS.
- Export only redacted AI trace projections to LangSmith.
- Add exporter-failure isolation metrics and warning events.

## Risks

- Raw transcript, raw tool output, credentials, or audio could leak if export redaction is not tested first.
- Provider callbacks can complete out of order, so trace correlation must rely on stable turn and packet IDs.
- LangSmith outages or missing credentials must not affect live-call availability.

## Decisions

- OpenTelemetry is the runtime instrumentation layer.
- LangSmith is the AI trace destination, not the audit, billing, routing, or tenant replay source of truth.
- Redaction failure drops the export instead of degrading into unsafe export.

## Next Recommended Step

- Start with RED tests for redacted trace payload shape and exporter failure isolation before adding the OpenTelemetry setup.
