# ISSUE-085: Platform admin app scaffold

Issue link: https://github.com/tuzzy08/zara/issues/85

## Goal

Deliver Platform admin app scaffold for the Platform Admin area in the Foundation milestone.

## Acceptance Criteria

- `apps/platform-admin` Vite React app is created
- It has independent routing, shell, build script, and env config
- It shares only approved packages with tenant app

## Work Completed

- Handover stub created during the platform-admin documentation update.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Wrong API origin
- Shared component imports tenant-only code

## Decisions

- Priority: P0
- Labels: platform-admin, frontend, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Platform-Admin.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
