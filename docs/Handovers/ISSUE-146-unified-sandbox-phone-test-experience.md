# ISSUE-146: Unified sandbox phone-test experience

Status: Implemented
Date: 2026-05-28
External: [Linear ZAR-92](https://linear.app/zara-voice/issue/ZAR-92/issue-146-unified-sandbox-phone-test-experience)

## Work Completed

- Created the reconciled local backlog entry and matching Linear issue.
- Standardized one sandbox concept with explicit Draft test, Published test, and Phone test modes.
- Captured `/calls`, `/workflows`, and `/sandbox` ownership boundaries for phone testing.
- Moved ZAR-92 / ISSUE-146 into implementation.
- Added `/sandbox` Published test (browser) and Phone test (Twilio/PSTN) modes.
- Added protected Phone test waiting-session creation, allowed caller input, expiry selection, checklist progress, active PSTN session display, and manually-ended result rendering.
- Added `/calls` standardized number states and direct Phone test launch links for routed numbers.
- Follow-up on 2026-06-04: populated `/calls` inbound test destination options from imported voice-capable numbers and outbound caller-ID options from imported caller-ID-eligible numbers, so imported provider inventory is testable before live activation.
- Follow-up on 2026-06-04: documented that the inbound test `Call SID` field is a Twilio-style correlation/session ID and that loopback test calls create a manual provider execution session for exercising the controls rail.
- Replaced the old `/workflows` routed-number dispatch simulation with Phone test deep links to the shared `/sandbox` surface.
- Added the API/manual completion path for `pstn-test-route/:sessionId/complete` with sanitized stored results.
- Updated design, frontend architecture, feature-flow, telephony, roadmap, backlog, and PSTN runtime standard docs.
- Follow-up on 2026-06-11: made the workflow-page Phone test tab clickable even when no routed numbers are available so users see the no-route checklist instead of a disabled dead end. Increased workflow builder canvas, inspector, and sandbox drawer vertical height, and changed workflow sandbox metric cards to single-column label/value layout to avoid overlap in the drawer.

## Tests Run

- `npm.cmd run test:run -- --pool=forks apps/web/src/app.test.tsx`
- `npm.cmd run test:run -- --pool=forks apps/api/src/telephony/telephony.controller.test.ts`
- `npm.cmd run test:run -- --pool=forks packages/core/src/telephony.test.ts`
- `npm.cmd run typecheck`
- RED: `npm.cmd run test:run -- apps/web/src/telephonyCallsPageModel.test.ts apps/web/src/integrationProviderBranding.test.ts` failed before the calls-page selector helpers existed.
- GREEN: `npm.cmd run test:run -- apps/web/src/telephonyCallsPageModel.test.ts apps/web/src/integrationProviderBranding.test.ts`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "connect a BYO Twilio account"`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "heartbeats, credential rotation, and loopback"`
- GREEN: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-11: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-11: `npm.cmd run lint`
- Follow-up on 2026-06-11: `npm.cmd run build --workspace @zara/web`
- Follow-up on 2026-06-11: Browser automation verified the workflow canvas and inspector render at 620px height in a 1544x760 viewport. UI tests were skipped per user request.

## Pending Work

- None for ISSUE-146. Live activation gates remain in ISSUE-147. PSTN observability and premium realtime remain in ISSUE-148 and ISSUE-149.

## Risks

- Multiple disconnected sandbox surfaces would confuse operators.
- Imported inventory must be filtered by voice/caller-ID eligibility so disabled or non-voice numbers do not populate test selectors.
- Real Twilio media transcript/events and latency/call-quality classifications still depend on the follow-up PSTN observability/runtime slices.

## Decisions

- `/calls` owns setup and activation.
- `/workflows` and `/sandbox` can initiate or deep-link Phone test mode.
- `/workflows` does not run a separate routed-number dispatch simulation.
- Manual end stores a sanitized `manually_ended` phone-test result.
- `/calls` selectors should treat imported voice-capable numbers as testable inventory before route activation; route activation remains a separate gate.

## Next Recommended Step

- Move to ISSUE-147 / ZAR-93 for live activation and subscription gates.
