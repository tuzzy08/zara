# ISSUE-059: Human takeover callback fallback

External: [GitHub #59](https://github.com/tuzzy08/zara/issues/59)

Issue link: https://github.com/tuzzy08/zara/issues/59

## Goal

Deliver Human takeover callback fallback for the Monitoring area in the Monitoring milestone.

## Acceptance Criteria

- Takeover or callback fallback follows provider capability
- Caller receives safe message
- Action is audited

## Work Completed

- Added RED/GREEN telephony controller coverage for provider-aware human fallback.
- Added `POST /organizations/:orgId/telephony/calls/:callSessionId/human-fallback`.
- Implemented live takeover for provider bridges that support safe transfer and callback fallback for callback-only bridges.
- Added `callback.scheduled` as a first-class call-control event with provider-specific bridge command actions.
- Added safe caller-facing messages for takeover and callback fallback, with actor/message details persisted in call-control audit payloads.
- Added callback number validation before scheduling callback fallback.
- Updated API, Telephony, and Feature Flows docs.
- Updated the web telephony API helper to use the shared `TelephonyCallControlEventType` so `callback.scheduled` remains accepted by the tenant UI type contract.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts -t "human takeover"` failed with `expected 404 to be 201`.
- GREEN: `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts -t "human takeover"` passed.
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts` passed.
- `npm.cmd run test:run -- packages/core/src/telephony.test.ts` passed.
- `npm.cmd run typecheck` passed.
- `npm.cmd run test:run -- apps/api/src/app.module.test.ts` passed.
- `npm.cmd run lint` passed.
- `npm.cmd run build --workspace @zara/api` passed.
- `npm.cmd run build --workspace @zara/core` passed.
- RED: `npm.cmd run typecheck --workspace @zara/web` failed because `callback.scheduled` was missing from the web API helper's event type.
- GREEN: `npm.cmd run typecheck --workspace @zara/web` passed.
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "telephony|human fallback|call control|callback"` passed.
- `npm.cmd run test:run -- packages/core/src/telephony.test.ts` passed.
- `npm.cmd run lint` passed.
- `npm.cmd run typecheck --workspace @zara/api` passed.
- `npm.cmd run typecheck` passed.

## Pending Work

- None for this issue.

## Risks And Edge Cases

- Transfer fails
- Callback number invalid
- Callback scheduling is currently represented as a provider command/audit event, not a durable outbound callback workflow. Future workflow/job infrastructure should execute the scheduled callback.
- Provider capability is conservative: platform edge and Twilio programmable voice use live transfer; SIP trunk sessions use callback fallback.
- Frontend helper types should stay aligned with `@zara/core` event unions instead of re-declaring narrower call-control event lists.

## Decisions

- Priority: P1
- Labels: runtime, telephony, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Use safe fixed caller copy for takeover/callback fallback instead of relaying raw operator notes.
- Keep human fallback in the telephony control plane because it depends on provider bridge capabilities and command audit history.

## Next Recommended Step

Continue to `ISSUE-060: Post-call summary`.
