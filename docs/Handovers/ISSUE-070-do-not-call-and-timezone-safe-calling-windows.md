# ISSUE-070: Do-not-call and timezone safe calling windows

Issue link: https://github.com/tuzzy08/zara/issues/70

## Goal

Deliver Do-not-call and timezone safe calling windows for the Compliance area in the Production milestone.

## Acceptance Criteria

- DNC list blocks outbound calls
- Timezone windows are enforced
- Overrides require audit

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Unknown timezone
- Emergency callback

## Decisions

- Priority: P0
- Labels: compliance, telephony, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
