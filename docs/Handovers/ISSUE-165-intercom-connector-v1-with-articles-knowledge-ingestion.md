# ISSUE-165: Intercom connector v1 with Articles knowledge ingestion

Status: Implemented
External: [Linear ZAR-119](https://linear.app/zara-voice/issue/ZAR-119/issue-165-intercom-connector-v1-with-articles-knowledge-ingestion)

## Goal

Add Intercom user/company/conversation lookup, internal notes, and Articles ingestion through the review-gated knowledge pipeline.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependencies on ISSUE-159 and ISSUE-161.
- Moved Linear ZAR-119 and the local backlog entry to In Progress for the implementation pass.
- Confirmed v1 scope: Intercom operational tools plus Articles ingestion through the review-gated Zara knowledge pipeline.
- Added the tenant-safe Intercom provider registry entry in `@zara/core` with support category, `intercom` logo token, OAuth-only setup, `agent-tool`, `post-call-sync`, and `knowledge-source` capabilities, snapshot/import plus recurring sync knowledge modes, official Intercom docs references, and minimal v1 scopes.
- Exposed only the v1 Intercom catalog tools: user/contact lookup, company lookup, open conversation lookup, internal note creation, and call-summary creation.
- Added frontend Intercom branding, minimal default OAuth scope requests, workflow builder provider grouping, Intercom-only connection filtering, and default approval-required posture for the medium-risk write tools.
- Added server-only Intercom registry metadata for the connector executor, auth strategy, secret schema, and provider base URL while keeping that metadata out of tenant catalog responses.
- Implemented Intercom connector execution for contact/user lookup, company lookup, open-conversation lookup, internal notes, and call-summary notes using curated Zara schemas and Intercom REST headers.
- Added a private `intercom.articles.import` connector schema for knowledge-source grants and Memory ingestion only; it is not exposed in the public workflow connector listing or workflow builder catalog.
- Wired Intercom Articles imports into the review-gated knowledge source pipeline for snapshot and daily recurring sync, including HTML-to-text extraction, scoped knowledge-source grant validation, review drafts, and update drafts after approved knowledge changes.
- Added explicit live sandbox side-effect coverage for Intercom internal-note and call-summary writes while keeping Intercom lookups as read-only.

## Tests Run

- RED: `.\node_modules\.bin\vitest.cmd run packages/core/src/provider-registry.test.ts` failed because `integrationProviderIds` did not include `intercom`, `getIntegrationProviderCatalogEntry("intercom")` returned undefined, and Intercom scope assertions were missing.
- RED: `.\node_modules\.bin\vitest.cmd run apps/web/src/integrationProviderBranding.test.ts apps/web/src/workflowBuilderToolCatalog.test.ts` failed because Intercom branding was undefined, the builder did not group/filter Intercom tools or connections, and Intercom OAuth defaults fell through.
- GREEN: `.\node_modules\.bin\vitest.cmd run packages/core/src/provider-registry.test.ts` passed.
- GREEN: `.\node_modules\.bin\vitest.cmd run apps/web/src/integrationProviderBranding.test.ts apps/web/src/workflowBuilderToolCatalog.test.ts` passed.
- GREEN: `npm.cmd run typecheck --workspace @zara/core` passed.
- GREEN: `npm.cmd run build --workspace @zara/core` passed.
- GREEN: `npm.cmd run typecheck --workspace @zara/web` passed after rebuilding `@zara/core` dist types.
- GREEN: `.\node_modules\.bin\vitest.cmd run packages/core/src/provider-registry.test.ts apps/web/src/integrationProviderBranding.test.ts apps/web/src/workflowBuilderToolCatalog.test.ts` passed.
- RED: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "provider catalog"` failed because the API controller tests still expected Intercom to be unsupported after the public registry change.
- RED: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts -t "Intercom Articles"` failed because `intercom.articles.import` was not yet grantable/executable for provider knowledge imports.
- GREEN: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts -t "Intercom Articles"` passed.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "Intercom provider catalog|tenant-safe provider catalog|unsupported provider"` passed.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/connector-tools.contract.test.ts -t "Intercom lookup"` passed.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/connector-tools.contract.test.ts apps/api/src/integrations/tool-permission-grants.service.test.ts apps/api/src/integrations/integrations.controller.test.ts apps/api/src/memory/memory.controller.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts -t "Intercom|provider catalog|unsupported provider|side-effect"` passed.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/connector-tools.contract.test.ts apps/api/src/integrations/tool-permission-grants.service.test.ts apps/api/src/integrations/integrations.controller.test.ts apps/api/src/memory/memory.controller.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts` passed with 80 tests.
- GREEN: `npm.cmd run test:run -- packages/core/src/provider-registry.test.ts apps/web/src/integrationProviderBranding.test.ts apps/web/src/workflowBuilderToolCatalog.test.ts` passed with 22 tests.
- GREEN: `npm.cmd run typecheck:core` passed.
- GREEN: `npm.cmd run build --workspace @zara/core` passed.
- GREEN: `npm.cmd run typecheck --workspace @zara/api` passed.
- GREEN: `npm.cmd run typecheck --workspace @zara/web` passed.
- GREEN: `git diff --check` passed.
- Tooling note: initial `npx vitest ...` attempts were blocked by the unsigned PowerShell `npx.ps1` shim before tests ran; reran through the local Vitest `.cmd` executable.

## Pending Work

- None for ISSUE-165. Continue with ISSUE-166 after committing, pushing, and synchronizing Linear.

## Risks And Edge Cases

- Intercom permissions may allow lookup but not Articles or notes.
- Deleted/unpublished Articles must be represented through the existing `sourceDeleted` and `deletionConfirmed` refresh path so active knowledge is not removed without review.
- External customer replies must remain unavailable.

## Decisions

- V1 supports internal notes and Articles ingestion, not external replies, conversation closing, assignment changes, or user/company mutation.
- Tenant-facing tool ids should use the `intercom.*` prefix and expose curated Zara actions only.
- Articles imports must create review drafts through the existing knowledge source/snapshot flow; runtime retrieval must use approved Zara knowledge only, never live Intercom Articles search during calls.
- Intercom write actions in v1 are internal notes or call-summary notes only and should be approval-aware/idempotency-safe.
- Frontend OAuth defaults request the v1 union only: `read_users`, `read_companies`, `read_conversations`, `write_conversations`, and `read_articles`.
- No `ticketing` capability was added for Intercom because the current local capability taxonomy has no generic helpdesk/support capability that matches Intercom v1 without implying ticket operations.
- `intercom.articles.import` is a private connector alias for grants and Memory ingestion only; tenant workflow tool lists expose only the five approved operational tools.

## Next Recommended Step

Commit and push ISSUE-165, mark Linear ZAR-119 done after CI is green, then continue with ISSUE-166.
