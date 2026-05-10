# ISSUE-006: CI pipeline with typecheck tests lint and migration checks

Issue link: https://github.com/tuzzy08/zara/issues/6

## Goal

Deliver CI pipeline with typecheck tests lint and migration checks for the DevOps area in the Foundation milestone.

## Acceptance Criteria

- CI runs typecheck, tests, lint, and migration checks
- CI blocks failed checks
- Status is documented

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Flaky dependency install
- Secrets unavailable in forked PR

## Decisions

- Priority: P0
- Labels: devops, testing, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
