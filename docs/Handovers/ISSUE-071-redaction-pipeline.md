# ISSUE-071: Redaction pipeline

Issue link: https://github.com/tuzzy08/zara/issues/71

## Goal

Deliver Redaction pipeline for the Security area in the Production milestone.

## Acceptance Criteria

- PII/sensitive data redaction runs before storage where configured
- Original access is restricted
- Tests cover transcripts and summaries

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- False positive
- Streaming partial redaction

## Decisions

- Priority: P0
- Labels: security, compliance, runtime, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
