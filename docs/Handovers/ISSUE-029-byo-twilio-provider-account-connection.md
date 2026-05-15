# ISSUE-029: BYO Twilio provider account connection

Issue link: https://github.com/tuzzy08/zara/issues/29

## Goal

Deliver the first tenant-facing Twilio provider-account connect flow.

## Status

- Status: delivered for MVP behavior, hardening still pending
- Completion: 85%

## Work Completed

- Added Twilio provider-account creation on `POST /organizations/:orgId/telephony/connections`.
- Added the tenant connect form on `apps/web` `/calls`.
- Stored and returned a masked credential reference instead of exposing provider secrets to the browser.
- Added provider validation and surfaced connection health in the tenant UI.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build`

## Pending Work

- Replace the current process-local secret vault with durable encrypted storage.
- Add richer Twilio account diagnostics for missing permissions, revoked tokens, and subaccount behavior.
- Add explicit disconnect and revocation flows.

## Risks And Edge Cases

- Current secret handling is safe at the API surface but not yet production-grade at rest.
- Twilio account posture can change after the initial validation pass.

## Decisions

- The first telephony UI only exposes Twilio connect even though the domain model already supports broader ownership modes.
- The connect flow is optimized for tenant operators, not platform admins.

## Next Recommended Step

Follow with durable secret persistence and provider revocation handling before calling the Twilio connection slice production-ready.
