# ISSUE-070: Do-not-call and timezone safe calling windows

External: [GitHub #70](https://github.com/tuzzy08/zara/issues/70)

Issue link: https://github.com/tuzzy08/zara/issues/70

## Goal

Deliver Do-not-call and timezone safe calling windows for the Compliance area in the Production milestone.

## Acceptance Criteria

- DNC list blocks outbound calls
- Timezone windows are enforced
- Overrides require audit

## Work Completed

- Added outbound compliance policy support to telephony dispatch.
- DNC lists now block outbound calls when the destination matches a tenant-provided DNC phone number.
- Timezone-safe calling now requires a known destination timezone and local time when compliance policy is supplied.
- Safe calling window overrides can queue an otherwise unsafe call only when an override reason and approving user are supplied.
- Audited overrides emit `telephony.outbound_compliance_override` compliance audit records with actor, call SID, destination, timezone, local hour, reason, and approving user.
- Outbound policy checks now include `dnc` and `timezone` alongside consent, budget, calling window, caller ID, and abuse.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts` failed because outbound dispatch queued DNC destinations and had no timezone policy checks.
- GREEN/REFACTOR:
  - `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
  - `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
  - `npm.cmd run typecheck`

## Pending Work

- None for ISSUE-070.

## Risks And Edge Cases

- Unknown timezone
- Emergency callback

## Decisions

- Priority: P0
- Labels: compliance, telephony, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Compliance policy is supplied to outbound dispatch so campaign/call orchestration can pass the current tenant DNC and destination timezone context.
- DNC blocks cannot be overridden in this slice. Emergency overrides apply to safe-calling-window policy only.
- Unknown timezone blocks outbound calls when compliance policy is present.

## Next Recommended Step

ISSUE-070 is complete. Future DNC management UI/API can persist tenant DNC lists and feed this dispatch contract.
