# ISSUE-091: Platform integration operations dashboard

Issue link: https://github.com/tuzzy08/zara/issues/91

## Goal

Deliver Platform integration operations dashboard for the Platform Admin area in the Integrations milestone.

## Acceptance Criteria

- Platform admins can inspect connector health, token status, sync failures, and revocation state
- Raw OAuth tokens are never exposed
- Retry/reconnect diagnostics are visible

## Work Completed

- Handover stub created during the platform-admin documentation update.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Token refresh failure
- Connector outage

## Decisions

- Priority: P1
- Labels: platform-admin, integrations, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Platform-Admin.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
