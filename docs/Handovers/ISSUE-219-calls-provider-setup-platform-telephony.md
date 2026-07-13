# ISSUE-219 Handover: Calls provider setup and platform telephony

Status: Implemented

External: [Linear ZAR-219](https://linear.app/zara-voice/issue/ZAR-219/refresh-tenant-calls-provider-setup-and-move-platform-telephony)

## Work Completed

- Rebuilt tenant Calls setup to the approved mockup hierarchy: four inline metrics, Twilio/SIP provider rows, provider icons, gray/green LEDs, Connect/Manage actions, Connections table, and centered credential modals.
- Removed the tenant Telephony hero, Platform edge setup, Health card, and Outbound card.
- Preserved imported-number routing, Phone test links, live-route controls, connection validation, heartbeat, number import, credential rotation, and connection/number deletion.
- Added a non-persisting Twilio REST inventory probe before tenant connection creation.
- Added an assured platform-admin endpoint and control panel for platform-managed telephony connections.
- Deleted the obsolete tenant-side setup, health, outbound, and provider-card component/model paths.
- Updated `DESIGN.md` with the approved Calls-page visual contract and the restricted functional color exception.

## Tests Run

- `npx vitest --run --pool=forks --maxWorkers=1 apps/web/src/app.test.tsx apps/web/src/TelephonyScreen.test.tsx apps/platform-admin/src/index.test.tsx` (89 passed)
- `npx vitest --run --pool=forks --maxWorkers=1 apps/api/src/platform-admin/platform-admin.controller.test.ts apps/api/src/telephony/telephony.controller.test.ts` (31 passed)
- `npx tsc -p apps/web/tsconfig.json --noEmit`
- `npx tsc -p apps/platform-admin/tsconfig.json --noEmit`
- `npx tsc -p apps/api/tsconfig.json --noEmit`

## Decisions

- Credential validation happens before persistence by calling Twilio's incoming-number inventory endpoint without importing inventory.
- Existing platform-managed tenant records remain readable/routable, but tenants can no longer create them.
- Connection operations use compact Lucide icon buttons with accessible labels and tooltips.

## Pending Work

- None for ISSUE-219 acceptance.

## Risks

- The Twilio validation probe is a live provider call and can return provider rate-limit or temporary-availability errors; existing safe Twilio error mapping is reused.
- Platform-admin telephony listings are still backed by the existing operations summary while newly provisioned tenant state is persisted by TelephonyService.

## Next Recommended Step

- Observe connection-validation latency and failure distribution after deployment and adjust operator copy only if real provider diagnostics show a recurring ambiguous failure class.
