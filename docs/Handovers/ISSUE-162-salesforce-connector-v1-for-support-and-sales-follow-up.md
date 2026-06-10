# ISSUE-162: Salesforce connector v1 for support and sales follow-up

Status: Implemented
External: [Linear ZAR-116](https://linear.app/zara-voice/issue/ZAR-116/issue-162-salesforce-connector-v1-for-support-and-sales-follow-up)

## Goal

Add Salesforce support/sales context tools with safe lookups and approval-required additive writes.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependencies on ISSUE-158 and ISSUE-159.
- Moved Linear ZAR-116 and the local backlog entry to In Progress for the implementation pass.
- Added Salesforce to the tenant-safe `@zara/core` provider registry with OAuth setup, local `salesforce` logo token, CRM/agent-tool/post-call-sync capabilities, official docs references, and `2026-06-05` docs verification metadata.
- Added Salesforce catalog tools for account/contact/case lookup plus approval-default additive writes via medium-risk create task, create case, and add call note entries.
- Added registry tests that assert Salesforce appears with only the v1 safe tool set and does not expose pipeline mutation, owner changes, destructive updates, deletes, or broad object mutation.
- Updated tenant frontend integration type fallout for Salesforce branding and OAuth default scopes.
- Added Salesforce to workflow tool-node connector support so builder provider/tool dropdowns can list Salesforce lookup and additive write tools.
- Added backend server metadata and OAuth client registration for Salesforce while keeping base URLs, auth headers, secret schema, and executor IDs server-owned.
- Added mocked Salesforce connector execution for account, contact, and case lookup plus create task, create case, and add call note through curated REST shapes.
- Added idempotency-key propagation for Salesforce additive writes via `Sforce-Call-Options`.
- Added Salesforce grant coverage for tenant-admin approval authority, approval-required medium-risk writes, required OAuth scopes, and reconnect hints for missing scopes.
- Verified cross-tenant connection isolation, invalid input rejection, rate-limit mapping, and secret redaction in connector contract coverage.
- Added side-effect ledger classifier coverage for Salesforce task, case, and call-note writes so retry safety remains explicit.

## Tests Run

- RED verified: `npm.cmd run test:run -- packages/core/src/provider-registry.test.ts` failed before implementation because Salesforce was missing from provider IDs, catalog metadata, and tool scopes.
- RED verified: `npm.cmd run test:run -- apps/api/src/integrations/connector-tools.contract.test.ts -t "Salesforce"` failed before backend implementation because Salesforce connector tools were not found.
- RED verified: `npm.cmd run test:run -- apps/web/src/workflowBuilderToolCatalog.test.ts` failed before workflow connector support because Salesforce provider tools were not listed.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts apps/api/src/integrations/connector-tools.contract.test.ts apps/api/src/integrations/integrations.controller.test.ts apps/api/src/integrations/tool-permission-grants.service.test.ts` passed, 47 tests.
- GREEN: `npm.cmd run test:run -- packages/core/src/provider-registry.test.ts apps/web/src/integrationProviderBranding.test.ts apps/web/src/workflowBuilderToolCatalog.test.ts apps/web/src/integrationSetupPresets.test.ts` passed, 15 tests.
- GREEN: `npm.cmd run typecheck:core` passed.
- GREEN: `npm.cmd run typecheck --workspace @zara/api` passed.
- GREEN: `npm.cmd run build --workspace @zara/core` passed.
- GREEN: `npm.cmd run typecheck --workspace @zara/web` passed.

## Pending Work

- None for ISSUE-162. Follow-up Salesforce Knowledge ingestion remains tracked separately in ISSUE-170.

## Risks And Edge Cases

- Salesforce permissions can allow lookup while denying task/case writes.
- Additive writes may time out after provider receipt.
- Pipeline mutation and destructive operations must remain absent.
- Salesforce object-level permission denials surface as provider 403/runtime permission failures because the v1 OAuth catalog exposes Salesforce's real `api` and `refresh_token` scopes rather than invented per-object OAuth scopes.
- Existing side-effect ledger classification covers Salesforce `tasks.create`, `cases.create`, and `call_notes.create` as write-like tool IDs; unknown provider write outcomes still require manual review before blind retry.

## Decisions

- V1 allows additive writes only and defaults them to approval-required.
- Pipeline stage mutation, owner changes, destructive updates, and deletes are out of v1.
- Salesforce v1 uses OAuth `api` and `refresh_token` as the reconnect/publish-validation scopes; object permission failures are handled at provider execution time.

## Next Recommended Step

Proceed to ISSUE-163 Slack connector v1.
