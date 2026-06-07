# ISSUE-167: Stripe connector v1 for read-only billing lookup

Status: Implemented
External: [Linear ZAR-121](https://linear.app/zara-voice/issue/ZAR-121/issue-167-stripe-connector-v1-for-read-only-billing-lookup)

## Goal

Add Stripe read-only customer, subscription, invoice, and payment-status lookup for billing support.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependencies on ISSUE-158 and ISSUE-159.
- Moved Linear ZAR-121 and the local backlog entry to In Progress for the implementation pass.
- Confirmed v1 scope: Stripe read-only billing lookup tools only for customer, subscription, invoice, and payment-status support.
- Confirmed excluded v1 operations: refunds, cancellations, payment-method changes, invoice creation, coupon changes, payment retries, and all other Stripe write/mutation actions.
- Added Stripe to the safe provider registry/catalog with local branding, `billing` category, connection plus agent-tool capabilities, read-only tool metadata, official docs references, and OAuth setup with no tenant API URL fields.
- Added server-only Stripe registry metadata for the REST API base URL, bearer auth strategy, secret schema, and executor id without exposing it through tenant catalog APIs.
- Implemented curated read-only Stripe connector tools for customer lookup, subscription lookup, invoice lookup, and payment-status lookup through server-owned REST `GET` contracts.
- Added grant/scope validation coverage for Stripe read-only agent tools and side-effect ledger assertions that Stripe lookup tools are not write-like side effects.
- Added tenant integrations capability setup support for initial OAuth connection when a catalog OAuth provider has no existing connection, so Stripe can be connected from the integrations page.
- Recorded ADR-001 for Stripe read-only OAuth scope handling.

## Tests Run

- `npm.cmd run test:run -- apps/api/src/integrations/connector-tools.contract.test.ts -t "Stripe"` - passed.
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts -t "side-effect"` - passed.
- `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "Stripe|provider catalog|unsupported provider"` - passed.
- `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts -t "Stripe"` - passed.
- `npm.cmd run test:run -- packages/core/src/provider-registry.test.ts apps/web/src/integrationProviderBranding.test.ts apps/web/src/workflowBuilderToolCatalog.test.ts` - passed.
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "catalog OAuth connection"` - passed after a solo rerun; an earlier parallel attempt hit a Vitest worker startup timeout before running tests.
- `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts` - passed.
- `npm.cmd run test:run -- apps/api/src/integrations/connector-tools.contract.test.ts` - passed.
- `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts` - passed.
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts` - passed.
- `npm.cmd run typecheck:core` - passed.
- `npm.cmd run build --workspace @zara/core` - passed.
- `npm.cmd run typecheck --workspace @zara/api` - passed.
- `npm.cmd run typecheck --workspace @zara/web` - passed.

## Pending Work

- Move Linear ZAR-121 to Done after commit/push and CI verification.
- Continue with ISSUE-168 / Linear ZAR-122 for full website crawling knowledge source after registry stabilization.

## Risks And Edge Cases

- Lookup can return multiple possible customer matches.
- Billing/payment facts are sensitive and need careful logging/UI redaction.
- Tokens may permit writes that Zara must not expose.
- Stripe Connect OAuth read-only handling has provider-specific nuance; ADR-001 records Zara's decision to validate `read_only` internally while omitting the outbound `scope` query parameter when read-only is the only requested Stripe scope.

## Decisions

- Stripe v1 is read-only only.
- Refunds, cancellations, payment-method changes, invoice creation, coupon changes, and payment retries are out of v1.
- Built-in Stripe API base URLs, auth headers, request shapes, and payloads remain Zara-owned connector metadata and must not be user configurable.
- Tenant-facing catalogs should expose only curated Zara read actions, not raw Stripe API operations.
- Stripe v1 uses internal `read_only` required-scope validation for all tools.
- Stripe OAuth authorization URLs omit the outbound `scope` query parameter when `read_only` is the only requested scope, preserving provider read-only defaults while keeping Zara grants explicit.

## Next Recommended Step

Commit and push ISSUE-167, watch GitHub CI, sync Linear ZAR-121 to Done, then begin ISSUE-168.
