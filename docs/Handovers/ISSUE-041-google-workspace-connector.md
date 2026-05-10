# ISSUE-041: Google Workspace connector

Issue link: https://github.com/tuzzy08/zara/issues/41

## Goal

Deliver Google Workspace connector for the Integrations area in the Integrations milestone.

## Acceptance Criteria

- Connector can read calendar availability and create events
- Scopes are minimal
- Timezone behavior is tested

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Calendar conflict
- Revoked consent

## Decisions

- Priority: P1
- Labels: integrations, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
