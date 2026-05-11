# ISSUE-088: Platform organization management

Issue link: https://github.com/tuzzy08/zara/issues/88

## Goal

Deliver Platform organization management for the Platform Admin area in the MVP Builder milestone.

## Acceptance Criteria

- Platform admins can view tenant status, plan, usage, telephony, integration state, and risk flags
- Tenant status changes are permissioned
- Status changes are audited

## Work Completed

- Handover stub created during the platform-admin documentation update.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Suspended tenant with active calls
- Readonly admin attempts mutation

## Decisions

- Priority: P1
- Labels: platform-admin, backend, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Platform-Admin.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
