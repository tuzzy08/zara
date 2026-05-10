# ISSUE-033: Outbound call dispatch

Issue link: https://github.com/tuzzy08/zara/issues/33

## Goal

Deliver Outbound call dispatch for the Telephony area in the Telephony MVP milestone.

## Acceptance Criteria

- Outbound calls enforce consent, budget, and calling window
- Caller ID policy is applied
- Dispatch is auditable

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Do-not-call match
- Timezone blocked

## Decisions

- Priority: P1
- Labels: telephony, compliance, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
