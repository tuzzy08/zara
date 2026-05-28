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
- Replaced the old `/workflows` routed-number dispatch simulation with Phone test deep links to the shared `/sandbox` surface.
- Added the API/manual completion path for `pstn-test-route/:sessionId/complete` with sanitized stored results.
- Updated design, frontend architecture, feature-flow, telephony, roadmap, backlog, and PSTN runtime standard docs.

## Tests Run

- `npm.cmd run test:run -- --pool=forks apps/web/src/app.test.tsx`
- `npm.cmd run test:run -- --pool=forks apps/api/src/telephony/telephony.controller.test.ts`
- `npm.cmd run test:run -- --pool=forks packages/core/src/telephony.test.ts`
- `npm.cmd run typecheck`

## Pending Work

- None for ISSUE-146. Live activation gates remain in ISSUE-147. PSTN observability and premium realtime remain in ISSUE-148 and ISSUE-149.

## Risks

- Multiple disconnected sandbox surfaces would confuse operators.
- Real Twilio media transcript/events and latency/call-quality classifications still depend on the follow-up PSTN observability/runtime slices.

## Decisions

- `/calls` owns setup and activation.
- `/workflows` and `/sandbox` can initiate or deep-link Phone test mode.
- `/workflows` does not run a separate routed-number dispatch simulation.
- Manual end stores a sanitized `manually_ended` phone-test result.

## Next Recommended Step

- Move to ISSUE-147 / ZAR-93 for live activation and subscription gates.
