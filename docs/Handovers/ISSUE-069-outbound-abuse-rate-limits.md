# ISSUE-069: Outbound abuse rate limits

External: [GitHub #69](https://github.com/tuzzy08/zara/issues/69)

Issue link: https://github.com/tuzzy08/zara/issues/69

## Goal

Deliver Outbound abuse rate limits for the Compliance area in the Production milestone.

## Acceptance Criteria

- Outbound calls enforce rate limits and consent
- Abuse signals can pause tenant
- Logs support review

## Work Completed

- Added outbound abuse policy checks to outbound telephony dispatch.
- Outbound dispatch policy checks now include `abuse` alongside consent, budget, calling window, and caller ID.
- Burst campaigns can be blocked by `maxCallsPerWindow` plus `windowSeconds`.
- When `pauseTenantOnViolation` is enabled, a violation disables tenant telephony connections and marks health failed.
- Abuse pauses emit `telephony.outbound_abuse_paused` compliance audit records with actor, tenant target, call SID, policy window, limit, and recent call count.
- Added API coverage proving consent remains enforced while abuse rate limits can pause a tenant and create review logs.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts` failed because outbound dispatch had no `abuse` policy check.
- GREEN/REFACTOR:
  - `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
  - `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
  - `npm.cmd run typecheck`

## Pending Work

- None for ISSUE-069.

## Risks And Edge Cases

- Burst campaign
- Compromised account

## Decisions

- Priority: P0
- Labels: compliance, telephony, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Abuse enforcement lives in outbound dispatch because it has tenant call history and can pause tenant telephony safely before provider execution.
- Review logs use the compliance audit log so abuse review can share the same hash-chained audit surface.

## Next Recommended Step

ISSUE-069 is complete. Future platform-admin abuse review can consume `telephony.outbound_abuse_paused` audit records.
