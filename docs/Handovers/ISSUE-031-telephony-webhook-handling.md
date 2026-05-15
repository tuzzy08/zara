# ISSUE-031: Telephony webhook handling

Issue link: https://github.com/tuzzy08/zara/issues/31

## Goal

Accept provider webhooks safely, verify authenticity, and avoid duplicate side effects.

## Status

- Status: delivered for Twilio inbound callbacks
- Completion: 90%

## Work Completed

- Added `POST /telephony/webhooks/twilio`.
- Implemented Twilio signature verification against the absolute callback URL.
- Matched incoming events to the correct tenant connection by verified account SID.
- Added duplicate `EventSid` suppression.
- Reused the inbound dispatch resolver for webhook-driven call routing.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
- `npm.cmd run typecheck`
- `npm.cmd run build`

## Pending Work

- Persist webhook dedupe state beyond process lifetime.
- Add more provider event types beyond the current inbound-call path.
- Add structured webhook event retention and operator replay tooling.

## Risks And Edge Cases

- Current dedupe scope resets on process restart.
- Signature verification currently assumes the canonical configured callback URL.

## Decisions

- Invalid webhook signatures fail closed with `401`.
- Duplicate callbacks return a duplicate response instead of replaying routing side effects.

## Next Recommended Step

Extend webhook coverage to richer Twilio event types only after persistent event storage is in place.
