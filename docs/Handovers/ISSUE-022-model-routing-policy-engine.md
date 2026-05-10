# ISSUE-022: Model routing policy engine

Issue link: https://github.com/tuzzy08/zara/issues/22

## Goal

Deliver Model routing policy engine for the Runtime area in the Sandbox milestone.

## Acceptance Criteria

- Rules select tiers by intent, risk, confidence, language, and call phase
- Tests cover escalation and fallback
- Decision is logged

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Conflicting rules
- Low confidence high-risk call

## Decisions

- Priority: P0
- Labels: runtime, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
