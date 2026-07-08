# ISSUE-145: Protected PSTN test route lifecycle

Status: Implemented
Date: 2026-05-28
External: [Linear ZAR-91](https://linear.app/zara-voice/issue/ZAR-91/issue-145-protected-pstn-test-route-lifecycle)

## Work Completed

- Created the reconciled local backlog entry and matching Linear issue.
- Standardized separate `test_route` and `live_route` records for phone numbers.
- Captured allowed caller, waiting session expiry, successful phone-test checklist, and one-active-test-per-number v1 behavior.
- Moved Linear ZAR-91 and the local backlog/handover into In Progress for the implementation pass.
- Implemented `liveRoute` and `testRoute` records in `@zara/core` and removed the old flat phone-number route fields as runtime source of truth.
- Added protected PSTN test route creation with published version, runtime profile, allowed caller, future expiry, one-active-waiting-session, and premium-PSTN block guards.
- Added route-mode inbound dispatch precedence, route-mode dispatch records, and sanitized phone-test result storage for passed, failed, expired, unauthorized-caller, and manually-ended outcomes.
- Added checklist checkpoint persistence from webhook dispatch, Twilio media socket lifecycle, inbound frames, outbound audio sends, and runtime checkpoint API calls.
- Added Postgres schema/repository support and migration `0004_pstn_test_routes.sql` for `live_route`, `test_route`, `phone_test_results`, route mode, runtime profile, and test session IDs.
- Updated tenant web/test helpers to consume `liveRoute` instead of legacy flat phone-number route fields.
- Follow-up on 2026-07-08: fixed Twilio incoming Voice webhook detection so real Twilio/TwiML requests without Zara's synthetic `EventType: incoming.call` marker dispatch into the protected test/live route path when they carry inbound call fields and a non-terminal `CallStatus`.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/telephony.test.ts --pool=forks`
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts --pool=forks`
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.persistence.test.ts --pool=forks`
- `npm.cmd run test:run -- apps/api/src/telephony/postgres-telephony-state.repository.test.ts --pool=forks`
- `npm.cmd run test:run -- apps/api/src/telephony/twilio-media-streams.websocket.test.ts --pool=forks`
- `npm.cmd run test:run -- apps/api/src/database/schema.test.ts --pool=forks`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=forks`
- `npm.cmd run test:run -- --pool=forks`
- `npm.cmd run lint`
- `npm.cmd run typecheck`
- `git diff --check`
- RED: `npm.cmd run test:run -- --pool=threads --testTimeout=30000 apps/api/src/telephony/telephony.controller.test.ts -t "answers real Twilio incoming voice webhooks"` returned reject TwiML for a real Twilio payload with no `EventType`.
- GREEN: `npm.cmd run test:run -- --pool=threads --testTimeout=30000 apps/api/src/telephony/telephony.controller.test.ts -t "answers real Twilio incoming voice webhooks"`
- GREEN: `npm.cmd run test:run -- --pool=threads --testTimeout=30000 apps/api/src/telephony/telephony.controller.test.ts`

## Pending Work

- None.

## Risks

- Always-on test routes would let real callers reach test workflows unexpectedly.
- Caller-number matching can fail for withheld or transformed caller IDs.
- Production concurrency still needs the database transaction discipline from later live-activation work; v1 guards reject duplicate waiting sessions inside the service/repository flow.

## Decisions

- PSTN tests require published versions, not draft graphs.
- `test_route` requires at least one allowed caller number in v1.
- Phone-number route state is `liveRoute`/`testRoute`; legacy flat phone-number route fields were removed instead of kept for compatibility.
- Premium realtime over PSTN remains blocked for phone tests until ISSUE-149.
- Real Twilio incoming Voice/TwiML requests are identified by inbound call parameters, not by requiring Zara-only `EventType` metadata.

## Next Recommended Step

- Continue to ISSUE-146 / ZAR-92.
