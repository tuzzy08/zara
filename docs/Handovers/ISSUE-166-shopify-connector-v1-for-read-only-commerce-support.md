# ISSUE-166: Shopify connector v1 for read-only commerce support

Status: Implemented
External: [Linear ZAR-120](https://linear.app/zara-voice/issue/ZAR-120/issue-166-shopify-connector-v1-for-read-only-commerce-support)

## Goal

Add Shopify read-only customer, order, fulfillment, and shipping-status lookup for ecommerce support calls.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependencies on ISSUE-158 and ISSUE-159.
- Moved Linear ZAR-120 and the local backlog entry to In Progress for the implementation pass.
- Confirmed v1 scope: Shopify read-only commerce lookup tools only, with customer lookup by email/phone and order/fulfillment/shipping-status lookup by safe identifiers.
- Confirmed excluded v1 operations: refunds, cancellations, address edits, draft orders, discount changes, inventory changes, and all other Shopify mutations.
- Added Shopify to the safe provider registry/catalog with local branding, `ecommerce` category, connection plus agent-tool capabilities, read-only tool metadata, official docs references, and a required non-secret `shopDomain` setup field.
- Added server-only Shopify registry metadata for the derived Admin GraphQL base path, auth header strategy, secret schema, and executor id without exposing it through tenant catalog APIs.
- Added Shopify OAuth setup validation and persistence: tenant setup provides only the store domain, shorthand domains normalize to `.myshopify.com`, full URLs are rejected, the OAuth authorization URL includes the normalized `shop` parameter, and connections store the shop domain as the account label plus credential metadata.
- Implemented curated read-only Shopify connector tools for customer lookup, order lookup, fulfillment lookup, and shipping-status lookup through the Admin GraphQL API version `2026-04`.
- Added tenant integrations UI support for Shopify store-domain setup and OAuth start, plus reconnect/missing-scope handling that reuses the existing Shopify account label.
- Added grant/scope validation coverage for Shopify agent tools and side-effect ledger assertions that Shopify lookup tools are not write-like side effects.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/provider-registry.test.ts -t "Shopify"` - passed.
- `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "Shopify|provider catalog|unsupported provider"` - passed.
- `npm.cmd run test:run -- apps/web/src/workflowBuilderToolCatalog.test.ts -t "Shopify read-only scopes"` - passed.
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts -t "side-effect"` - passed.
- `npm.cmd run test:run -- packages/core/src/provider-registry.test.ts apps/web/src/integrationProviderBranding.test.ts apps/web/src/workflowBuilderToolCatalog.test.ts` - passed.
- `npm.cmd run test:run -- apps/api/src/integrations/connector-tools.contract.test.ts -t "Shopify"` - passed.
- `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts -t "Shopify"` - passed.
- `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts -t "Shopify|provider catalog|unsupported provider|side-effect"` - passed.
- `npm.cmd run typecheck:core` - passed.
- `npm.cmd run build --workspace @zara/core` - passed.
- `npm.cmd run typecheck --workspace @zara/api` - passed.
- `npm.cmd run typecheck --workspace @zara/web` - passed.

## Pending Work

- Move Linear ZAR-120 to Done after commit/push and CI verification.
- Continue with ISSUE-167 / Linear ZAR-121 for Stripe read-only billing lookup.

## Risks And Edge Cases

- Caller-provided order identifiers may not belong to the caller.
- Agencies may need workspace-owned Shopify connections for separate stores.
- Provider rate limits must not cause invented order status.
- Shopify GraphQL search can return multiple customer/order candidates; v1 surfaces bounded lookup results and keeps customer/order safe identifiers in the tool schema instead of attempting risky mutation or resolution flows.
- Store-domain setup is tenant-provided, but the Admin API URL, API version, auth header, query payloads, and executor remain server-owned metadata.

## Decisions

- Shopify v1 is read-only only.
- Refunds, cancellations, address edits, draft orders, discount changes, and inventory changes are out of v1.
- Built-in Shopify Admin API base URLs, auth headers, GraphQL queries, and payloads remain Zara-owned connector metadata and must not be user configurable.
- Public workflow/provider catalogs should expose only curated Zara read actions, not raw Shopify API operations.
- Shopify store domain is a required setup/account parameter because OAuth needs the target shop; it is not an API URL and is normalized server-side.
- Shopify v1 uses Admin GraphQL `2026-04` for server-owned read-only lookup contracts.

## Next Recommended Step

Commit and push ISSUE-166, watch GitHub CI, sync Linear ZAR-120 to Done, then begin ISSUE-167.
