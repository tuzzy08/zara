# ISSUE-037: OAuth connection framework

Issue link: https://github.com/tuzzy08/zara/issues/37

## Goal

Deliver OAuth connection framework for the Integrations area in the Integrations milestone.

## Acceptance Criteria

- Platform OAuth apps support connect and callback
- State parameter prevents CSRF
- Tenant-scoped connection is created

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Callback replay
- User lacks admin role

## Decisions

- Priority: P0
- Labels: integrations, security, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
