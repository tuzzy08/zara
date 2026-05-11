# ISSUE-086: Platform admin auth client and access gate

Issue link: https://github.com/tuzzy08/zara/issues/86

## Goal

Deliver Platform admin auth client and access gate for the Platform Admin area in the Foundation milestone.

## Acceptance Criteria

- Platform admin app uses Better Auth React client
- Non-platform users are blocked from admin UI
- Server-side platform guard rejects unauthorized API calls

## Work Completed

- Handover stub created during the platform-admin documentation update.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Tenant admin tries admin app
- Platform role revoked mid-session

## Decisions

- Priority: P0
- Labels: platform-admin, auth, security, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Platform-Admin.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
