# ISSUE-030: Twilio number import and routing

External: [GitHub #30](https://github.com/tuzzy08/zara/issues/30)

Issue link: https://github.com/tuzzy08/zara/issues/30

## Goal

Import Twilio numbers and bind them to published Zara workflows safely.

## Status

- Status: delivered for the first inbound-routing slice
- Completion: 90%

## Work Completed

- Added import of voice-capable Twilio numbers only.
- Added tenant `/calls` routing UI for imported numbers.
- Bound number routes to published workflow versions plus workspace and recording policy.
- Reflected routing state through `status` and `webhookStatus` on imported numbers.
- Follow-up on 2026-07-07: fixed duplicate-key failures during Twilio number import by scoping newly generated phone-number IDs to tenant plus connection plus provider number ID instead of the Twilio SID alone, and by ignoring duplicate provider rows within one import response before persistence.
- Added Postgres repository regression coverage proving two tenants can persist the same Twilio provider number SID without colliding on `telephony_phone_numbers_pkey`.
- Follow-up on 2026-07-07: replaced the generated Twilio-number fixture path in production with an injectable Twilio REST inventory provider that lists the connected BYO account's `IncomingPhoneNumbers` resource using server-side Account SID/Auth Token credentials.
- Added product-safe Twilio inventory error handling for rejected credentials, rate limits, provider unavailability, request failures, and network reachability without exposing raw tokens or Twilio payloads.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx`
- `npm.cmd run typecheck`
- `npm.cmd run build`
- RED: `npm.cmd run test:run -- packages/core/src/telephony.test.ts -t "scopes imported Twilio number IDs"` failed because duplicate provider rows produced duplicate imported numbers.
- GREEN: `npm.cmd run test:run -- packages/core/src/telephony.test.ts -t "scopes imported Twilio number IDs"`
- GREEN: `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
- GREEN: `npm.cmd run test:run -- --pool=threads apps/api/src/telephony/telephony.persistence.test.ts apps/api/src/telephony/postgres-telephony-state.repository.test.ts`
- GREEN: `npm.cmd run test:run -- --pool=threads --testTimeout=30000 apps/api/src/telephony/telephony.controller.test.ts`
- GREEN: `npm.cmd run typecheck:core`
- GREEN: `npm.cmd run typecheck --workspace @zara/api`
- GREEN: `npx.cmd eslint packages/core/src/telephony.ts packages/core/src/telephony.test.ts`
- GREEN: `npx.cmd eslint apps/api/src/telephony/postgres-telephony-state.repository.test.ts`
- RED: `npm.cmd run test:run -- apps/api/src/telephony/twilio-number-inventory.provider.test.ts` failed because the real Twilio inventory provider did not exist.
- RED: `npm.cmd run test:run -- apps/api/src/telephony/telephony.persistence.test.ts -t "imports real Twilio inventory"` failed because import still used generated fixtures and never called the injected inventory provider.
- GREEN: `npm.cmd run test:run -- apps/api/src/telephony/twilio-number-inventory.provider.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/telephony/telephony.persistence.test.ts -t "imports real Twilio inventory"`
- GREEN: `npm.cmd run test:run -- --pool=threads apps/api/src/telephony/twilio-number-inventory.provider.test.ts apps/api/src/telephony/telephony.persistence.test.ts apps/api/src/telephony/postgres-telephony-state.repository.test.ts`
- GREEN: `npm.cmd run test:run -- --pool=threads --testTimeout=30000 apps/api/src/telephony/telephony.controller.test.ts`
- GREEN: `npm.cmd run typecheck --workspace @zara/api`
- GREEN: `npx.cmd eslint apps/api/src/telephony/telephony.service.ts apps/api/src/telephony/telephony.module.ts apps/api/src/telephony/twilio-number-inventory.provider.ts apps/api/src/telephony/twilio-number-inventory.provider.test.ts apps/api/src/telephony/telephony.persistence.test.ts apps/api/src/telephony/telephony.controller.test.ts`

## Pending Work

- Add search, filtering, and bulk route changes when number volume grows.
- Add disable/reenable actions per imported number.
- Replace browser-local published-workflow discovery with API-backed workflow catalog lookups.

## Risks And Edge Cases

- Imported number state is durable through the Postgres telephony store.
- Workspace-scoped workflow selection still depends on browser-local published versions.
- Existing legacy phone-number IDs remain readable; newly imported/provider-registered numbers use tenant/connection-scoped IDs. Operators should keep using API-returned number IDs rather than constructing IDs client-side.

## Decisions

- Imported numbers are routed to immutable published workflow versions, not drafts.
- SMS-only inventory is filtered out before the tenant route table is populated.
- Number IDs are Zara-owned tenant-scoped identifiers; provider IDs such as Twilio `PN...` remain stored as `externalNumberId`, not as globally unique primary keys.
- Production Twilio import reads existing numbers from Twilio `IncomingPhoneNumbers`; generated Twilio-like inventory is test-only fixture data and is no longer production behavior.

## Next Recommended Step

Hook number routing into a persistent workflow catalog once published workflow APIs move server-side.
