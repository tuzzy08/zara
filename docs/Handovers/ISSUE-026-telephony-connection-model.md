# ISSUE-026: Telephony connection model

Issue link: https://github.com/tuzzy08/zara/issues/26

## Goal

Deliver the telephony connection model that supports platform-managed, BYO SIP, and BYO provider-account telephony ownership.

## Status

- Status: delivered for the first telephony MVP slice
- Completion: 90%

## Work Completed

- Added the shared telephony domain model in `packages/core/src/telephony.ts`.
- Implemented ownership modes for `platform_managed`, `byo_sip_trunk`, and `byo_provider_account`.
- Added tenant-scoped connection state, routing rules, health posture, recording policy, and inbound dispatch resolution contracts.
- Added a NestJS telephony module with tenant-scoped in-memory state and public control-plane routes.
- Added the tenant `/calls` surface in `apps/web` for connection, validation, import, routing, and inbound test operations.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
- RED: `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
- GREEN: `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
- Verification: `npm.cmd run test:run -- apps/web/src/app.test.tsx`
- Verification: `npm.cmd run typecheck`
- Verification: `npm.cmd run lint`
- Verification: `npm.cmd run build`
- Verification: browser check on `http://127.0.0.1:4173/calls` against a running local API

## Pending Work

- Move telephony state from in-memory Nest storage to persistent Postgres-backed state.
- Add production envelope encryption instead of the current process-local secret vault.
- Implement platform-managed and SIP UI paths in later telephony issues.

## Risks And Edge Cases

- Process restarts currently clear telephony state.
- Final secret storage is not production-grade yet.
- Live provider drift can still happen between validation and webhook receipt.

## Decisions

- The public connection contract never returns raw secrets.
- Connection/routing logic lives in `@zara/core` so browser, API tests, and future runtime services share one contract.
- The first tenant telephony surface lives on `/calls` and focuses on Twilio-first inbound setup before broader provider coverage.

## Next Recommended Step

Proceed with platform-managed telephony, SIP, or outbound calling only after persistent telephony storage and secret hardening are scheduled clearly.
