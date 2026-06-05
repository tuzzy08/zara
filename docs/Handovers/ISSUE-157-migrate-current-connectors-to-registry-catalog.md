# ISSUE-157: Migrate current connectors to the registry catalog

Status: Pending
External: [Linear ZAR-111](https://linear.app/zara-voice/issue/ZAR-111/issue-157-migrate-current-connectors-to-the-registry-catalog)

## Goal

Move Zendesk, HubSpot, Google Workspace, Notion, and webhook catalog behavior onto the provider registry and API-served catalog.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependency on ISSUE-156.

## Tests Run

- Not run; issue creation and planning only.

## Pending Work

- Add failing tests proving the integrations page and workflow builder consume catalog data from the API.
- Migrate current provider/tool metadata while preserving saved connection and workflow compatibility.
- Keep built-in request metadata hidden from tenant UI.

## Risks And Edge Cases

- Existing workflow tool nodes can reference saved bindings that are not present in the current fetched connection list.
- Webhook tools remain user-configurable while built-in provider tools do not expose endpoints.
- Catalog load failures should not corrupt workflow drafts.

## Decisions

- Do not add new providers on top of the current hardcoded frontend/backend catalogs.
- Zendesk search/create/update ticket tool IDs must remain visible after migration.

## Next Recommended Step

Write the failing UI/API tests for catalog-backed provider and tool dropdown rendering.

