# ISSUE-040: HubSpot connector

Issue link: https://github.com/tuzzy08/zara/issues/40

## Goal

Deliver HubSpot connector for the Integrations area in the Integrations milestone.

## Acceptance Criteria

- Connector can look up contacts and write notes
- Pipeline updates are permissioned
- Tool errors are recoverable

## Work Completed

- Added typed HubSpot connector tool schemas for:
  - `hubspot.contacts.lookup`
  - `hubspot.notes.create`
  - `hubspot.pipeline.update`
- Added deterministic local HubSpot execution for contact lookup, note creation, and pipeline stage updates behind tenant-scoped OAuth connections.
- Enforced HubSpot required scopes per tool before execution.
- Added recoverable duplicate-contact handling with a structured HTTP 409 response containing `code: duplicate_contacts` and `recoverable: true`.
- Updated `docs/API.md` and `docs/Integrations.md`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "HubSpot contact"` failed because HubSpot connector tool schemas were empty.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "HubSpot contact"`
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts apps/api/src/integrations/integrations.persistence.test.ts apps/api/src/integrations/tool-permission-grants.service.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/api`

## Pending Work

- None for ISSUE-040 acceptance.

## Risks And Edge Cases

- Duplicate contacts
- Missing scope
- Real HubSpot API search/write semantics and token refresh remain provider-client expansion work; the safe typed execution contract is now in place.

## Decisions

- Priority: P1
- Labels: integrations, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Duplicate contact matches are recoverable provider errors rather than generic failures.
- Pipeline updates require the `crm.objects.deals.write` scope.

## Next Recommended Step

Move to ISSUE-041 Google Workspace connector.
