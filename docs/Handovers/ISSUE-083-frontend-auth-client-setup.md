# ISSUE-083: Frontend auth client setup

Issue link: https://github.com/tuzzy08/zara/issues/83

## Goal

Deliver Frontend auth client setup for the Auth area in the Foundation milestone.

## Acceptance Criteria

- Better Auth React client is configured for both Vite apps
- Login, logout, and session state work against the NestJS auth backend
- Route guards cover unauthenticated, tenant, and platform-admin users

## Work Completed

- Handover stub created during the platform-admin documentation update.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Trusted origin missing
- Session expires while app is open

## Decisions

- Priority: P0
- Labels: auth, frontend, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Platform-Admin.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
