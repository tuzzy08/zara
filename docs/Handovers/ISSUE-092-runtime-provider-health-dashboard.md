# ISSUE-092: Runtime provider health dashboard

Issue link: https://github.com/tuzzy08/zara/issues/92

## Goal

Deliver Runtime provider health dashboard for the Platform Admin area in the Monitoring milestone.

## Acceptance Criteria

- Platform admins can see STT, TTS, model, realtime, telephony, and queue health by provider and region
- Health events include timestamps and severity
- Outage state is visible

## Work Completed

- Handover stub created during the platform-admin documentation update.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Partial regional outage
- Stale health signal

## Decisions

- Priority: P1
- Labels: platform-admin, runtime, monitoring, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Platform-Admin.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
