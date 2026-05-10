# ISSUE-038: Encrypted credential storage

Issue link: https://github.com/tuzzy08/zara/issues/38

## Goal

Deliver Encrypted credential storage for the Security area in the Integrations milestone.

## Acceptance Criteria

- Tokens and provider secrets are encrypted at rest
- Key version metadata is stored
- No raw secrets are returned from APIs

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Key rotation
- Decrypt failure

## Decisions

- Priority: P0
- Labels: security, integrations, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
