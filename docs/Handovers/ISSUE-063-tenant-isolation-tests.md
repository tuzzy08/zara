# ISSUE-063: Tenant isolation tests

Issue link: https://github.com/tuzzy08/zara/issues/63

## Goal

Deliver Tenant isolation tests for the Security area in the Production milestone.

## Acceptance Criteria

- Automated tests prove tenant data isolation
- Cross-tenant access returns forbidden/not found
- Covers calls, memory, integrations, telephony

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- ID guessing
- Admin role confusion

## Decisions

- Priority: P0
- Labels: security, testing, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
