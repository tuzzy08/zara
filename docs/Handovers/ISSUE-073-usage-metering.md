# ISSUE-073: Usage metering

Issue link: https://github.com/tuzzy08/zara/issues/73

## Goal

Deliver Usage metering for the Billing area in the Production milestone.

## Acceptance Criteria

- Usage events are recorded idempotently
- Usage aggregates by tenant and feature
- Tests cover duplicate events

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Delayed provider usage
- Clock skew

## Decisions

- Priority: P0
- Labels: billing, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
