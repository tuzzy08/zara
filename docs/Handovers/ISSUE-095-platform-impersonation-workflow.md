# ISSUE-095: Platform impersonation workflow

Issue link: https://github.com/tuzzy08/zara/issues/95

## Goal

Deliver Platform impersonation workflow for the Platform Admin area in the Production milestone.

## Acceptance Criteria

- Impersonation is time-boxed, permissioned, visibly marked, auditable, and revocable
- Destructive actions are blocked unless explicitly allowed
- Tenant and platform audit records link to the impersonation session

## Work Completed

- Handover stub created during the platform-admin documentation update.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Session expires during impersonation
- Role revoked while impersonating

## Decisions

- Priority: P0
- Labels: platform-admin, security, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Platform-Admin.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
