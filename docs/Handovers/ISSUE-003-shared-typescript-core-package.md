# ISSUE-003: Shared TypeScript core package

Issue link: https://github.com/tuzzy08/zara/issues/3

## Goal

Deliver Shared TypeScript core package for the Setup area in the Foundation milestone.

## Acceptance Criteria

- Core package exports public domain types
- No app imports private implementation paths
- Typecheck passes

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Breaking shared contracts
- Circular package imports

## Decisions

- Priority: P0
- Labels: setup, backend, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
