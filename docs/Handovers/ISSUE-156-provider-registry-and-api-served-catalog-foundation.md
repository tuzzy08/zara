# ISSUE-156: Provider registry and API-served catalog foundation

Status: Implemented
External: [Linear ZAR-110](https://linear.app/zara-voice/issue/ZAR-110/issue-156-provider-registry-and-api-served-catalog-foundation)

## Goal

Create the hybrid capability-based provider registry foundation and tenant-safe API-served catalog.

## Work Completed

- Created the Linear issue and local backlog entry.
- Captured the registry boundary: shared/public metadata is safe, API-owned metadata keeps provider execution details server-side.
- Added `@zara/core` provider registry metadata for Zendesk, HubSpot, Google Workspace, Notion, and Webhook HTTP, including provider IDs, labels, categories, capabilities, safe setup schema, logo tokens, tool IDs/names, risk posture, knowledge-source flags, docs references, and docs-verified dates.
- Added an API-owned `ProviderRegistryService` with server-only base URL/auth/secret-schema/executor metadata that is not serialized to clients.
- Added tenant catalog routes: `GET /organizations/:orgId/integrations/catalog` and `GET /organizations/:orgId/integrations/catalog/:provider`.
- Updated architecture, API, integrations, roadmap, and backlog docs for the registry contract.

## Tests Run

- `npx.cmd vitest run packages/core/src/provider-registry.test.ts`
- `npx.cmd vitest run apps/api/src/integrations/integrations.controller.test.ts`

## Pending Work

- ISSUE-157 should migrate existing tenant UI/provider dropdown usage to the API-served catalog.
- Future provider tool contract and side-effect safety hardening remains ISSUE-159.

## Risks And Edge Cases

- Catalog responses must not expose provider base URLs, auth headers, secret schemas, or executor details.
- Unsupported providers must fail safely.
- Current provider connections must remain compatible while the registry is introduced.
- The catalog is now available, but existing frontend usages are intentionally not migrated in this issue.

## Decisions

- Use a hybrid registry: safe metadata may live in shared contracts, while provider execution metadata stays API-owned.
- The tenant frontend should consume the API catalog rather than hardcoding provider/tool lists.
- Keep provider docs metadata in the safe catalog so UI and future contract tests can surface documentation traceability without exposing execution details.

## Next Recommended Step

Start ISSUE-157 by replacing existing local provider/tool lists in the tenant integrations page and workflow builder with the API-served catalog.
