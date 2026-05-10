# ISSUE-036: Provider health checks and test calls

Issue link: https://github.com/tuzzy08/zara/issues/36

## Goal

Deliver Provider health checks and test calls for the Telephony area in the Telephony MVP milestone.

## Acceptance Criteria

- Health checks run for each provider connection
- Test calls record diagnostics
- Failures block production routing when required

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Provider API down
- False positive health

## Decisions

- Priority: P1
- Labels: telephony, testing, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
