# ISSUE-033: Outbound call dispatch

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
- Updated the tenant `/calls` screen with an outbound runner that checks consent, budget, calling window, workflow binding, and caller ID before the call is queued.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts apps/api/src/telephony/telephony.persistence.test.ts`
- `npm.cmd run typecheck`

## Pending Work

- Integrate do-not-call policy, tenant budgets from billing state, and timezone derivation from actual customer metadata.
- Replace the current policy-only queue result with a live outbound execution bridge when telephony media is enabled.

## Risks And Edge Cases

- Outbound checks currently trust operator-supplied local hour and budget input rather than pulling them from system-of-record services.
- Caller ID policy requires a routed Zara number today, which is intentional but still stricter than some future provider allowances.

## Decisions

- Priority: P1
- Labels: telephony, compliance, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Outbound dispatches are stored in the same audit stream as inbound dispatches and are differentiated by `direction`.
- Policy results are returned with explicit per-check statuses so the UI can explain why a dry run was blocked.

## Next Recommended Step

When billing and compliance modules mature, replace operator-entered budget and local-hour values with tenant policy services and customer metadata.
