# ISSUE-096: Abuse and compliance review queue

Issue link: https://github.com/tuzzy08/zara/issues/96

## Goal

Deliver Abuse and compliance review queue for the Platform Admin area in the Production milestone.

## Acceptance Criteria

- Platform admins can review outbound abuse signals, DNC violations, consent issues, prompt-injection flags, and suspension recommendations
- Review decisions are audited
- Queue supports safe escalation and dismissal

## Work Completed

- Added guarded `GET /platform-admin/abuse-compliance/reviews`.
- Review queue covers outbound abuse, DNC violation, consent issue, prompt injection, and suspension recommendation signal types.
- Added guarded `POST /platform-admin/abuse-compliance/reviews/:reviewId/decision` for escalation and dismissal decisions.
- Review decisions write platform audit records.
- Added matching platform-admin UI route at `/abuse`.

## Tests Run

- RED/GREEN: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts`
- RED/GREEN: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx`

## Pending Work

- None for ISSUE-096 acceptance.

## Risks And Edge Cases

- False positive
- Compromised tenant account

## Decisions

- Priority: P1
- Labels: platform-admin, compliance, security, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Queue decisions are restricted to platform owner/admin roles because they affect tenant risk posture.

## Next Recommended Step

Source review signals from compliance, telephony, and prompt-injection audit streams when observability storage is expanded.
