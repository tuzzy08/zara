# ISSUE-041: Google Workspace connector

External: [GitHub #41](https://github.com/tuzzy08/zara/issues/41)

Issue link: https://github.com/tuzzy08/zara/issues/41

## Goal

Deliver Google Workspace connector for the Integrations area in the Integrations milestone.

## Acceptance Criteria

- Connector can read calendar availability and create events
- Scopes are minimal
- Timezone behavior is tested

## Work Completed

- Added typed Google Workspace connector tool schemas for:
  - `google.calendar.availability.read`
  - `google.calendar.events.create`
- Added deterministic local calendar availability and event creation execution behind tenant-scoped OAuth connections.
- Enforced minimal required scopes: `calendar.freebusy` for availability reads and `calendar.events` for event creation.
- Preserved caller-provided timezone, start, and end values in execution responses so timezone behavior is explicit and testable.
- Updated `docs/API.md` and `docs/Integrations.md`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "Google Workspace"` failed because Google Workspace connector tool schemas were empty.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "Google Workspace"`
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts apps/api/src/integrations/integrations.persistence.test.ts apps/api/src/integrations/tool-permission-grants.service.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/api`

## Pending Work

- None for ISSUE-041 acceptance.

## Risks And Edge Cases

- Calendar conflict
- Revoked consent
- Real Google Calendar API conflict expansion, recurrence, and token refresh remain provider-client expansion work.

## Decisions

- Priority: P1
- Labels: integrations, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Calendar availability and event creation use separate minimal scopes.
- Timezone values remain explicit in connector inputs and outputs instead of being silently converted by the local test adapter.

## Next Recommended Step

Move to ISSUE-042 Notion connector.
