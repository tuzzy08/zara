# ISSUE-028: BYO SIP trunk connection

Issue link: https://github.com/tuzzy08/zara/issues/28

## Goal

Deliver BYO SIP trunk connection for the Telephony area in the Telephony MVP milestone.

## Acceptance Criteria

- Tenant can configure SIP trunk details
- Validation call checks route health
- Failure messages are actionable

## Work Completed

- Added RED tests in `packages/core/src/telephony.test.ts` and `apps/api/src/telephony/telephony.controller.test.ts` for SIP trunk creation, DID registration, route-aware health validation, and actionable warning messages.
- Implemented SIP trunk connection support in `packages/core/src/telephony.ts` and `apps/api/src/telephony/telephony.service.ts`.
- Added manual DID registration through the shared `register-number` API path and surfaced SIP connection and DID controls in `apps/web/src/TelephonyScreen.tsx`.
- Validation now distinguishes between missing credentials, missing DIDs, and missing routed workflows so operators get actionable recovery steps.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts apps/api/src/telephony/telephony.persistence.test.ts`
- `npm.cmd run typecheck`

## Pending Work

- Replace the current control-plane health simulation with an actual SIP validation probe once the live media bridge exists.
- Add provider-specific diagnostics for codec mismatch, TLS failures, and network reachability.

## Risks And Edge Cases

- The current validator checks configuration posture, not an end-to-end media path.
- SIP codec and NAT issues are not yet verified against live infrastructure.

## Decisions

- Priority: P1
- Labels: telephony, tdd-required
- Handover docs are mandatory for every pass on this issue.
- SIP validation returns `warning` when the trunk exists but no DID or routed workflow is attached yet.
- SIP DIDs share the same telephony number inventory model as platform and Twilio numbers.

## Next Recommended Step

When live SIP execution is introduced, preserve the existing validation messages so operators keep the same recovery language.
