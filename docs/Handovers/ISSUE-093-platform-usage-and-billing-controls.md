# ISSUE-093: Platform usage and billing controls

Issue link: https://github.com/tuzzy08/zara/issues/93

## Goal

Deliver Platform usage and billing controls for the Platform Admin area in the Production milestone.

## Acceptance Criteria

- Platform admins can inspect usage, budgets, overages, premium realtime usage, and plan limits across tenants
- Plan/budget changes are audited
- Readonly admins cannot mutate billing controls

## Work Completed

- Handover stub created during the platform-admin documentation update.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Budget reached mid-call
- Pricing table missing

## Decisions

- Priority: P1
- Labels: platform-admin, billing, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Platform-Admin.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
