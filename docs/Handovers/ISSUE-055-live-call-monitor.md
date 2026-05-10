# ISSUE-055: Live call monitor

Issue link: https://github.com/tuzzy08/zara/issues/55

## Goal

Deliver Live call monitor for the Frontend area in the Monitoring milestone.

## Acceptance Criteria

- Operators see active calls, agent role, runtime tier, and status
- Critical interactions are covered lightly
- Data comes from event stream

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Event stream disconnect
- Many active calls

## Decisions

- Priority: P1
- Labels: frontend, runtime, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
