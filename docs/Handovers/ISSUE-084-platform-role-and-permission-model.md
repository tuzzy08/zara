# ISSUE-084: Platform role and permission model

Issue link: https://github.com/tuzzy08/zara/issues/84

## Goal

Deliver Platform role and permission model for the Security area in the Foundation milestone.

## Acceptance Criteria

- Shared platform and tenant role types exist
- NestJS guards distinguish platform roles from tenant roles
- Tests prove tenant admins are not platform admins

## Work Completed

- Handover stub created during the platform-admin documentation update.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Role downgraded during session
- Conflicting tenant and platform roles

## Decisions

- Priority: P0
- Labels: platform-admin, auth, security, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Platform-Admin.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
