# ISSUE-035: DTMF voicemail transfer and failover handling

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
- Updated the tenant `/calls` screen with a live controls rail for DTMF, voicemail, transfer, and failover plus a recent event timeline.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts apps/api/src/telephony/telephony.persistence.test.ts`
- `npm.cmd run typecheck`

## Pending Work

- Connect these control events to a live call orchestrator so DTMF and transfer actions can execute, not just be recorded.
- Add richer event payloads for queue destinations, voicemail transcript capture, and provider-specific transfer metadata.

## Risks And Edge Cases

- Call-control events are persisted cleanly, but they do not yet mutate a live media session.
- Transfer and failover currently require an explicit fallback label from the operator; future workflow-driven defaults may reduce operator error.

## Decisions

- Priority: P1
- Labels: telephony, edge-case, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Missing fallback paths are treated as hard validation failures for voicemail, transfer-failed, and failover events.
- Call-control events are stored separately from provider webhooks so the control-plane audit trail is easier to read.

## Next Recommended Step

When workflow-driven telephony execution lands, map these stored event types directly onto workflow edges or escalation policies instead of asking the operator for every fallback target manually.
