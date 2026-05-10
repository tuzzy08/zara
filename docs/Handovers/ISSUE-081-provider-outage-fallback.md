# ISSUE-081: Provider outage fallback

Issue link: https://github.com/tuzzy08/zara/issues/81

## Goal

Deliver Provider outage fallback for the Runtime area in the Production milestone.

## Acceptance Criteria

- Fallback routes exist for telephony/runtime providers
- Outage mode is visible
- Calls fail safely when no fallback exists

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Multiple providers down
- Stuck failover

## Decisions

- Priority: P1
- Labels: runtime, telephony, devops, edge-case, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
