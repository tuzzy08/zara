# ISSUE-047: Caller account memory

Issue link: https://github.com/tuzzy08/zara/issues/47

## Goal

Deliver Caller account memory for the Memory area in the Monitoring milestone.

## Acceptance Criteria

- Durable caller/account memory is opt-in
- Memory is tenant scoped
- Retrieval respects caller identity

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Shared phone number
- Wrong account match

## Decisions

- Priority: P1
- Labels: memory, security, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
