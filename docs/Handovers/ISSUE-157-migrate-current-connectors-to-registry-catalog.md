# ISSUE-157: Migrate current connectors to the registry catalog

Status: Implemented
External: [Linear ZAR-111](https://linear.app/zara-voice/issue/ZAR-111/issue-157-migrate-current-connectors-to-the-registry-catalog)

## Goal

Move Zendesk, HubSpot, Google Workspace, Notion, and webhook catalog behavior onto the provider registry and API-served catalog.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependency on ISSUE-156.
- Started the implementation pass after confirming Linear ZAR-111 is In Progress.
- Added catalog-backed tenant integrations rendering from `GET /organizations/:orgId/integrations/catalog`.
- Migrated workflow builder tool provider/tool options to API/core catalog metadata.
- Preserved already-saved workflow tool nodes that use legacy IDs such as `zendesk.search` by adding a selected-node compatibility option.
- Kept built-in provider endpoint/auth/executor metadata out of frontend-created built-in tool configs; webhook HTTP tools remain tenant-configurable.
- Kept Zendesk ticket tool IDs visible: `zendesk.tickets.search`, `zendesk.tickets.create`, and `zendesk.tickets.update`.

## Tests Run

- `npm.cmd run test:run -- apps/web/src/workflowBuilderToolCatalog.test.ts apps/web/src/WorkflowBuilder.test.tsx apps/web/src/app.test.tsx -t "workflow builder tool catalog|loads tool inspector provider options|renders tenant integration tools from the API catalog"` - passed.
- `npx.cmd tsc -p apps/web/tsconfig.json --noEmit` - passed.
- Prior pass: not run; issue creation and planning only.

## Pending Work

- None for ISSUE-157.
- Follow-up ISSUE-158 owns capability grants and connection scope setup UX.
- Follow-up ISSUE-159 owns provider contract tests and runtime side-effect safety.

## Risks And Edge Cases

- Existing workflow tool nodes can reference saved bindings that are not present in the current fetched connection list.
- Webhook tools remain user-configurable while built-in provider tools do not expose endpoints.
- Catalog load failures should not corrupt workflow drafts.
- New tool-node creation waits for the catalog; if the catalog fails or is still loading, the builder keeps the draft intact and shows a loading toast.

## Decisions

- Do not add new providers on top of the current hardcoded frontend/backend catalogs.
- Zendesk search/create/update ticket tool IDs must remain visible after migration.
- Built-in provider tools are represented in the frontend by provider/tool IDs, labels, risk, and authorization posture from the safe catalog, not by frontend-owned provider API URLs or auth header construction.

## Next Recommended Step

Start ISSUE-158 for capability grants and connection scope setup UX.
