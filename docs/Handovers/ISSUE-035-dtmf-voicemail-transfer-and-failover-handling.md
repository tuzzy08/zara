# ISSUE-035: DTMF voicemail transfer and failover handling

External: [GitHub #35](https://github.com/tuzzy08/zara/issues/35)

Issue link: https://github.com/tuzzy08/zara/issues/35

## Goal

Deliver DTMF voicemail transfer and failover handling for the Telephony area in the Telephony MVP milestone.

## Acceptance Criteria

- DTMF, voicemail, transfer, and failover are first-class events
- Fallback paths are configured
- Edge cases are covered by tests

## Work Completed

- Added RED tests in `packages/core/src/telephony.test.ts` and `apps/api/src/telephony/telephony.controller.test.ts` for DTMF, voicemail, transfer, and failover event handling.
- Implemented first-class telephony call-control events in `packages/core/src/telephony.ts` and persisted them in `apps/api/src/telephony/telephony.service.ts`.
- Added `POST /organizations/:orgId/telephony/calls/:callSessionId/events` so the control plane can record call-control actions against a live or queued session.
- Added provider-native call-control command generation so DTMF, voicemail, transfer, and failover actions advance the execution session and persist concrete bridge actions for platform, Twilio, and SIP flows.
- Updated the tenant `/calls` screen with a live controls rail for DTMF, voicemail, transfer, and failover plus a recent event timeline.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts apps/api/src/telephony/telephony.persistence.test.ts`
- `npm.cmd run typecheck`

## Pending Work

- None for issue completion.

## Risks And Edge Cases

- Transfer and failover currently require an explicit fallback label from the operator; future workflow-driven defaults may reduce operator error.
- Provider-side transfer or failover rejection must still be surfaced cleanly through the stored control timeline and bridge command history.

## Decisions

- Priority: P1
- Labels: telephony, edge-case, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Missing fallback paths are treated as hard validation failures for voicemail, transfer-failed, and failover events.
- Call-control events are stored separately from provider webhooks so the control-plane audit trail is easier to read.
- Call-control actions now append provider-native execution commands so the persisted session state and operator timeline stay synchronized.

## Next Recommended Step

Issue complete. Carry the same call-control command contract into future workflow-driven fallback defaults and monitoring views.
