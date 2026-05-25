# ISSUE-039: Zendesk connector

Issue link: https://github.com/tuzzy08/zara/issues/39

## Goal

Deliver Zendesk connector for the Integrations area in the Integrations milestone.

## Acceptance Criteria

- Connector can search/create/update tickets
- Tool schemas are typed
- Rate limits are handled

## Work Completed

- Added OAuth connector tool schema and execution routes through the integrations controller:
  - `GET /organizations/:orgId/integrations/connectors/:provider/tools`
  - `POST /organizations/:orgId/integrations/connectors/:provider/tools/:toolId/execute`
- Added `ConnectorToolsService` with tenant-scoped connection lookup, encrypted OAuth credential opening, connection revocation checks, and required-scope enforcement.
- Added typed Zendesk tool schemas for:
  - `zendesk.tickets.search`
  - `zendesk.tickets.create`
  - `zendesk.tickets.update`
- Added deterministic local Zendesk execution behavior for ticket search/create/update without calling external APIs.
- Added structured Zendesk rate-limit handling that returns HTTP 429 with `retryAfterSeconds` and never exposes OAuth tokens.
- Updated `docs/API.md` and `docs/Integrations.md`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "Zendesk ticket tools"` failed with `404` before connector tool routes existed.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "Zendesk ticket tools"`
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts apps/api/src/integrations/integrations.persistence.test.ts apps/api/src/integrations/tool-permission-grants.service.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/api`

## Pending Work

- None for ISSUE-039 acceptance.

## Risks And Edge Cases

- Expired token
- Ticket field validation
- Real Zendesk API pagination, field mapping, and token refresh remain provider-client expansion work; this issue establishes the typed tool contract and safe execution boundary.

## Decisions

- Priority: P1
- Labels: integrations, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Connector execution requires the matching tenant connection and required scopes.
- Rate limits are represented as structured retryable HTTP 429 responses.

## Next Recommended Step

Move to ISSUE-040 HubSpot connector.
