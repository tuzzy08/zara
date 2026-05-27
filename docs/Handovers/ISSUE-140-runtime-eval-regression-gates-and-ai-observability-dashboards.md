# ISSUE-140: Runtime eval regression gates and AI observability dashboards

Status: Pending
Date: 2026-05-27
External: [Linear ZAR-73](https://linear.app/zara-voice/issue/ZAR-73/issue-140-runtime-eval-regression-gates-and-ai-observability)

## Work Completed

- Created the implementation issue in `docs/Issue-Backlog.md`.
- Added AI runtime metrics, LangSmith export health, and eval dashboard expectations to `docs/Observability-Dashboards.md`.
- Linked release and monitoring expectations from `docs/Roadmap.md`.

## Tests Run

- Not run. This pass created documentation and backlog records only.

## Pending Work

- Add CI/release script coverage proving eval commands are separate from ordinary test commands.
- Add AI runtime metric aggregation tests for intent fallback, classifier confidence, tool use/failure, transfers, policy warnings, packet truncation, and LangSmith export health.
- Add platform/staff observability UI or API coverage for eval regression status.
- Document staging and production release checks once the gate is implemented.

## Risks

- Blocking releases on immature LLM-as-judge thresholds can create noise.
- LangSmith outages must have a controlled emergency-release path that still preserves local deterministic eval evidence.
- Tenant-facing dashboards must not leak internal LangSmith links or cross-tenant trace metadata.

## Decisions

- Eval gates are separate release gates, not part of normal unit test execution.
- Deterministic scorecards should be stricter than LLM-as-judge thresholds.
- Staff dashboards may link to LangSmith experiments; tenant dashboards should stay on Zara-owned monitoring data.

## Next Recommended Step

- Begin after ISSUE-137 through ISSUE-139 are implemented, then add release-gate and dashboard tests before wiring CI and staff surfaces.
