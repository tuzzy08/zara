# ISSUE-098: Shared frontend packages setup

Issue link: https://github.com/tuzzy08/zara/issues/98

## Goal

Deliver Shared frontend packages setup for the Frontend area in the Foundation milestone.

## Acceptance Criteria

- `packages/ui`, `packages/api-client`, and `packages/auth-client` are planned or scaffolded for shared frontend code
- Shared packages do not depend on tenant-only or admin-only app code
- Typecheck covers shared package boundaries

## Work Completed

- Handover stub created during the platform-admin documentation update.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Circular workspace dependency
- Admin-only component leaks into tenant app

## Decisions

- Priority: P1
- Labels: frontend, platform-admin, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Platform-Admin.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
