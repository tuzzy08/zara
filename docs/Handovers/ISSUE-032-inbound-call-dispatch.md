# ISSUE-032: Inbound call dispatch

Issue link: https://github.com/tuzzy08/zara/issues/32

## Goal

Resolve inbound calls from telephony numbers into published Zara workflow routes.

## Status

- Status: delivered for Twilio-first routing resolution
- Completion: 90%

## Work Completed

- Added shared inbound routing resolution in `@zara/core`.
- Added `POST /organizations/:orgId/telephony/dispatch/inbound`.
- Added tenant `/calls` inbound dispatch test controls.
- Routed both manual dispatch tests and verified webhook events through the same resolver.
- Reused the same inbound dispatch route from the workflow builder so published workflows can verify an already-routed live number path directly from the `/workflows` sandbox drawer.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/telephony.test.ts`
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx`
- `npm.cmd run typecheck`
- `npm.cmd run build`
- Browser verification on `/calls` with local API

## Pending Work

- Spawn real call-session runtime records instead of the current dispatch record only.
- Feed dispatch events into the live monitoring timeline and billing meters.
- Add timezone windows, do-not-call enforcement, and abuse checks when live telephony is enabled.

## Risks And Edge Cases

- Current dispatch is still a control-plane test path, not full telephony media execution.
- Missing or stale published workflow state can block useful routing.

## Decisions

- Inbound routing targets immutable published versions instead of mutable drafts.
- The first operator-facing test surface is manual inbound dispatch before live phone traffic.
- Workflow-page routed sandbox mode uses the same dispatch API instead of inventing a second route-simulation path.

## Next Recommended Step

Wire dispatch results into the runtime event stream and live call session model when telephony media execution begins.
