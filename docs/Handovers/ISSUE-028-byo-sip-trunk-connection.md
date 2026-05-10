# ISSUE-028: BYO SIP trunk connection

Issue link: https://github.com/tuzzy08/zara/issues/28

## Goal

Deliver BYO SIP trunk connection for the Telephony area in the Telephony MVP milestone.

## Acceptance Criteria

- Tenant can configure SIP trunk details
- Validation call checks route health
- Failure messages are actionable

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Bad credentials
- Codec mismatch
- NAT/firewall issue

## Decisions

- Priority: P1
- Labels: telephony, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
