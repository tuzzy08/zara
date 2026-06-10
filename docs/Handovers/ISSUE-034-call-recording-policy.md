# ISSUE-034: Call recording policy

External: [GitHub #34](https://github.com/tuzzy08/zara/issues/34)

Issue link: https://github.com/tuzzy08/zara/issues/34

## Goal

Attach recording posture and consent requirements to telephony routes.

## Status

- Status: delivered for control-plane policy handling
- Completion: 85%

## Work Completed

- Added connection-level recording policy to the shared telephony model.
- Added per-number route override support.
- Exposed recording consent choice in the tenant Twilio connect flow.
- Returned the active recording policy inside inbound dispatch results.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx`
- `npm.cmd run typecheck`
- `npm.cmd run build`

## Pending Work

- Add geo-aware legal policy enforcement.
- Add playback or spoken-consent runtime prompts once live media execution exists.
- Add explicit recording disable behavior for fallback routes and human transfer scenarios.

## Risks And Edge Cases

- Policy is stored and surfaced correctly, but live audio consent playback is not part of this slice yet.
- Different jurisdictions can require route-time overrides beyond the current per-number setting.

## Decisions

- Recording policy belongs to both the connection contract and the route contract.
- Route-level policy wins over connection-level defaults.

## Next Recommended Step

Keep policy modeling as-is and add runtime playback/enforcement when telephony media execution moves out of the sandboxed control-plane slice.
