# ISSUE-147: Live route activation and subscription gates

Status: Implemented
Date: 2026-05-28
External: [Linear ZAR-93](https://linear.app/zara-voice/issue/ZAR-93/issue-147-live-route-activation-and-subscription-gates)

## Work Completed

- Created the reconciled local backlog entry and matching Linear issue.
- Standardized manual live activation from exact successful PSTN test results.
- Captured subscription, budget, abuse, provider health, and mid-call policy behavior.
- Synced Linear ZAR-93 and local issue records through the implementation pass.
- Added required `liveRoute.activationStatus` states: `pending_activation`, `active`, and `paused`.
- Updated route assignment so saved live routes remain pending and cannot answer until activated.
- Implemented activation from a matching successful PSTN Phone test result, plus audited override support.
- Implemented activation hard blocks for subscription, tenant suspension, provider health, recording posture, missing credentials, and budget hard blocks.
- Implemented pause/resume while preserving route setup, credentials, dispatch history, phone-test history, and activation metadata.
- Implemented blocked inbound dispatch plus safe unavailable TwiML for pending, paused, inactive-subscription, hard-budget, and tenant-suspended new calls.
- Implemented active-call runtime policy states for subscription grace, budget closeout after the current turn, and tenant suspension termination.
- Added tenant `/calls` activation summary, Activate live, Pause, and Resume actions.
- Persisted call policy state in Postgres-backed execution sessions.
- Updated telephony, API, billing, feature-flow, frontend architecture, roadmap, backlog, and PSTN standard docs.

## Tests Run

- `npm.cmd run typecheck`
- `npm.cmd run test:run -- --pool=forks packages/core/src/telephony.test.ts`
- `npm.cmd run test:run -- --pool=forks apps/api/src/telephony/telephony.controller.test.ts`
- `npm.cmd run test:run -- --pool=forks apps/api/src/telephony/postgres-telephony-state.repository.test.ts`
- `npm.cmd run test:run -- --pool=forks apps/web/src/app.test.tsx`
- `npm.cmd run test:run -- --pool=forks packages/core/src/telephony.test.ts apps/api/src/telephony/telephony.controller.test.ts apps/api/src/telephony/postgres-telephony-state.repository.test.ts apps/web/src/app.test.tsx`

## Pending Work

- None for ISSUE-147.
- PSTN latency/call-quality observability remains tracked by ISSUE-148.
- Premium realtime over PSTN remains tracked by ISSUE-149.

## Risks

- Activation posture currently derives budget/subscription checks from the billing read model; production billing webhook drift must be covered by ISSUE-148 observability and release gates.
- Premium realtime over PSTN is intentionally not included in this slice.

## Decisions

- Subscription loss preserves setup and history but blocks new answering.
- Active calls may finish within grace unless budget hard stop or abuse/security suspension applies.
- Saving a live route never auto-activates it.
- Pending and paused live routes create blocked dispatch records and safe unavailable TwiML instead of falling back into live media.
- Activation overrides must carry actor, approver, reason, and timestamp.

## Next Recommended Step

- Start ISSUE-148: PSTN observability, latency evals, and production gates.
