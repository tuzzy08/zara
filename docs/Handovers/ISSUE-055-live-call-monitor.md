# ISSUE-055: Live call monitor

Issue link: https://github.com/tuzzy08/zara/issues/55

## Goal

Deliver Live call monitor for the Frontend area in the Monitoring milestone.

## Acceptance Criteria

- Operators see active calls, agent role, runtime tier, and status
- Critical interactions are covered lightly
- Data comes from event stream

## Work Completed

- Added workspace-scoped live sandbox monitor controls to `/sandbox`.
- Added `GET /organizations/:orgId/sandbox/live-sessions` support to the Nest sandbox session layer so the tenant UI can refresh active and completed sandbox sessions.
- Added live monitor cards that show active role, runtime tier, status, turn count, and event count for each sandbox session in the active workspace.
- Added replay inspection wiring so operators can open a selected sandbox session directly from the monitor rail.

## Tests Run

- RED: `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=threads`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=threads`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/web`

## Pending Work

- Expand the monitor beyond sandbox sessions into telephony-backed live calls, escalation queue state, and post-call quality signals in later monitoring issues.

## Risks And Edge Cases

- Event stream disconnect
- Many active calls
- Active workspace changes while the monitor is open

## Decisions

- Priority: P1
- Labels: frontend, runtime, tdd-required
- Handover docs are mandatory for every pass on this issue.
- The first monitor slice lives on `/sandbox` because it already owns the live session context and event history needed for operator inspection.

## Next Recommended Step

Build the next monitoring slice on top of the same event history contract: human escalation queue, CRM sync status, and cross-session live operations views.
