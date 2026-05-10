# ISSUE-024: Runtime budget and cost estimation

Issue link: https://github.com/tuzzy08/zara/issues/24

## Goal

Deliver Runtime budget and cost estimation for the Billing area in the Sandbox milestone.

## Acceptance Criteria

- Estimate includes telephony, STT, model, TTS, and storage
- Tenant budgets can block publish or call start
- Usage is attributed by tenant

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Long call
- Provider pricing missing

## Decisions

- Priority: P1
- Labels: billing, runtime, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
