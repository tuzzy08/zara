# ISSUE-026: Telephony connection model

Issue link: https://github.com/tuzzy08/zara/issues/26

## Goal

Deliver Telephony connection model for the Telephony area in the Telephony MVP milestone.

## Acceptance Criteria

- Model supports platform managed, BYO SIP, and BYO provider account
- Credentials are referenced, not exposed
- Tenant isolation is tested

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Provider deleted
- Connection disabled mid-call

## Decisions

- Priority: P0
- Labels: telephony, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
