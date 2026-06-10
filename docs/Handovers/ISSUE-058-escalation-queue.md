# ISSUE-058: Escalation queue

External: [GitHub #58](https://github.com/tuzzy08/zara/issues/58)

Issue link: https://github.com/tuzzy08/zara/issues/58

## Goal

Deliver Escalation queue for the Monitoring area in the Monitoring milestone.

## Acceptance Criteria

- Escalations enter queue with reason and SLA
- Agents can accept or decline
- Fallback is triggered on timeout

## Work Completed

- Added RED/GREEN API coverage for escalation queue lifecycle: duplicate suppression, SLA deadline calculation, accept, decline, timeout fallback, and timeline events.
- Added live sandbox escalation queue models and in-memory queue state keyed by tenant organization.
- Added `GET /organizations/:orgId/sandbox/live-sessions/escalations` with optional workspace filtering and deterministic `now` handling for SLA timeout fallback.
- Added accept and decline endpoints for pending escalations, each appending operator decision events to the live session timeline.
- Added a light sandbox UI smoke test plus `/sandbox` monitor UI for refreshing escalation queue items, viewing reasons/SLA deadlines, and accepting or declining pending escalations.
- Documented the API contract and updated monitoring flow docs.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts -t "queues escalation"` failed with `expected 404 to be 200`.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts -t "queues escalation"` passed.
- RED: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "escalation queue"` initially hit a Vitest worker startup timeout before assertions executed; rerun after UI wiring passed.
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "escalation queue"` passed.
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts` passed.
- `npm.cmd run test:run -- apps/web/src/app.test.tsx` passed.
- `npm.cmd run test:run -- apps/api/src/app.module.test.ts` passed.
- `npm.cmd run typecheck` passed.
- `npm.cmd run lint` passed.
- `npm.cmd run build --workspace @zara/api` passed.
- `npm.cmd run build --workspace @zara/web` passed with the existing Vite chunk-size warning.

## Pending Work

- None for this issue.

## Risks And Edge Cases

- No humans online
- Duplicate escalation
- Queue state is currently in-memory with the live sandbox session spine; production persistence should keep the same API contract when monitoring state moves to Postgres or a queue engine.
- Timeout fallback is deterministic on queue reads via the optional `now` parameter in this slice; a future worker can call the same behavior on a schedule.

## Decisions

- Priority: P1
- Labels: runtime, frontend, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Duplicate runtime escalation signals are suppressed while an item for the same session and workflow node is still pending.
- Accept and decline are terminal operator decisions for this slice. Later human takeover/callback behavior belongs to `ISSUE-059`.

## Next Recommended Step

Continue to `ISSUE-059: Human takeover callback fallback`.
