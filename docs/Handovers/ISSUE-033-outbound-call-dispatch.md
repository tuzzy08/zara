# ISSUE-033: Outbound call dispatch

External: [GitHub #33](https://github.com/tuzzy08/zara/issues/33)

Issue link: https://github.com/tuzzy08/zara/issues/33

## Goal

Deliver Outbound call dispatch for the Telephony area in the Telephony MVP milestone.

## Acceptance Criteria

- Outbound calls enforce consent, budget, and calling window
- Caller ID policy is applied
- Dispatch is auditable

## Work Completed

- Added RED tests in `packages/core/src/telephony.test.ts` and `apps/api/src/telephony/telephony.controller.test.ts` for outbound policy enforcement and auditable dispatch storage.
- Implemented outbound dispatch policy evaluation in `packages/core/src/telephony.ts`.
- Added `POST /organizations/:orgId/telephony/dispatch/outbound` in the Nest telephony module and persisted outbound dispatch records alongside inbound tests.
- Added provider-native outbound execution sessions and command history so approved outbound dispatches open a concrete bridge action for platform, Twilio, and SIP paths.
- Updated the tenant `/calls` screen with an outbound runner that checks consent, budget, calling window, workflow binding, and caller ID before the call is queued.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts apps/api/src/telephony/telephony.persistence.test.ts`
- `npm.cmd run typecheck`

## Pending Work

- None for issue completion.

## Risks And Edge Cases

- Caller ID policy requires a routed Zara number today, which keeps outbound identity explicit across platform, Twilio, and SIP paths.
- Outbound checks depend on the values provided to the dispatch request, so upstream billing and customer-data integrations should continue to supply the source-of-truth inputs when those slices land.

## Decisions

- Priority: P1
- Labels: telephony, compliance, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Outbound dispatches are stored in the same audit stream as inbound dispatches and are differentiated by `direction`.
- Policy results are returned with explicit per-check statuses so the UI can explain why a dry run was blocked.
- Approved outbound dispatches immediately materialize a provider-native execution command so operator audit history and bridge posture stay aligned.

## Next Recommended Step

Issue complete. Reuse the outbound dispatch contract when billing, compliance, and CRM data sources begin supplying policy inputs automatically.
