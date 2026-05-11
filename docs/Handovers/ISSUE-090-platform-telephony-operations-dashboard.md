# ISSUE-090: Platform telephony operations dashboard

Issue link: https://github.com/tuzzy08/zara/issues/90

## Goal

Deliver Platform telephony operations dashboard for the Platform Admin area in the Telephony MVP milestone.

## Acceptance Criteria

- Platform admins can inspect platform-managed, BYO SIP, and BYO Twilio connections
- Health, route, and webhook failures are visible
- Raw provider credentials are never exposed

## Work Completed

- Handover stub created during the platform-admin documentation update.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- Provider outage
- Tenant connection disabled mid-call

## Decisions

- Priority: P1
- Labels: platform-admin, telephony, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Platform-Admin.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
