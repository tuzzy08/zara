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

## Tests Run

- `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx`
- `npm.cmd run typecheck`
- `npm.cmd run build`

## Pending Work

- Add search, filtering, and bulk route changes when number volume grows.
- Add disable/reenable actions per imported number.
- Replace browser-local published-workflow discovery with API-backed workflow catalog lookups.

## Risks And Edge Cases

- Imported number state is currently lost on process restart.
- Workspace-scoped workflow selection still depends on browser-local published versions.

## Decisions

- Imported numbers are routed to immutable published workflow versions, not drafts.
- SMS-only inventory is filtered out before the tenant route table is populated.

## Next Recommended Step

Hook number routing into a persistent workflow catalog once published workflow APIs move server-side.
