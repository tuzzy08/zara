# ISSUE-004: Postgres schema and migration setup

Issue link: https://github.com/tuzzy08/zara/issues/4

## Goal

Deliver Postgres schema and migration setup for the Backend area in the Foundation milestone.

## Acceptance Criteria

- Migration tool is configured
- Initial schema covers tenant and audit foundations
- Migration checks run in CI

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Failed migration rollback
- Local database unavailable

## Decisions

- Priority: P0
- Labels: backend, testing, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
