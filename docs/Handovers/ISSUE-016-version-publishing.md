# ISSUE-016: Version publishing

Issue link: https://github.com/tuzzy08/zara/issues/16

## Goal

Deliver Version publishing for the Backend area in the MVP Builder milestone.

## Acceptance Criteria

- Published versions are immutable
- Calls pin to a published version
- Draft changes do not affect active calls

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Concurrent publishes
- Rollback to prior version

## Decisions

- Priority: P0
- Labels: backend, runtime, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
