# ISSUE-096: Abuse and compliance review queue

Issue link: https://github.com/tuzzy08/zara/issues/96

## Goal

Deliver Abuse and compliance review queue for the Platform Admin area in the Production milestone.

## Acceptance Criteria

- Platform admins can review outbound abuse signals, DNC violations, consent issues, prompt-injection flags, and suspension recommendations
- Review decisions are audited
- Queue supports safe escalation and dismissal

## Work Completed

- Handover stub created during the platform-admin documentation update.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- False positive
- Compromised tenant account

## Decisions

- Priority: P1
- Labels: platform-admin, compliance, security, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Platform-Admin.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
