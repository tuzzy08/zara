# ISSUE-097: Platform admin deployment and domain config

Issue link: https://github.com/tuzzy08/zara/issues/97

## Goal

Deliver Platform admin deployment and domain config for the DevOps area in the Production milestone.

## Acceptance Criteria

- `apps/platform-admin` has separate deploy config and environment variables
- Trusted origins include local, staging, and production admin domains
- Security headers and CSP can differ from tenant app

## Work Completed

- Handover stub created during the platform-admin documentation update.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Wrong domain points to tenant app
- Missing staging origin

## Decisions

- Priority: P1
- Labels: platform-admin, devops, security, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Platform-Admin.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
