# ISSUE-087: Platform admin dashboard shell

Issue link: https://github.com/tuzzy08/zara/issues/87

## Goal

Deliver Platform admin dashboard shell for the Platform Admin area in the MVP Builder milestone.

## Acceptance Criteria

- Dashboard shows system health, tenants, calls, runtime status, spend, incidents, and abuse queues
- Navigation is independent from tenant app
- UI smoke test covers dashboard load

## Work Completed

- Handover stub created during the platform-admin documentation update.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Empty state
- Provider status unavailable

## Decisions

- Priority: P1
- Labels: platform-admin, frontend, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Platform-Admin.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
