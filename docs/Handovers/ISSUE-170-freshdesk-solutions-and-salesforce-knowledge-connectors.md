# ISSUE-170: Freshdesk Solutions and Salesforce Knowledge connectors

Status: Implemented
External: [Linear ZAR-124](https://linear.app/zara-voice/issue/ZAR-124/issue-170-freshdesk-solutions-and-salesforce-knowledge-connectors)

## Goal

Add Freshdesk Solutions and Salesforce Knowledge as registry-backed CRM/help-center knowledge-source connectors.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependencies on ISSUE-161 and ISSUE-162.
- Started implementation pass on 2026-06-10.
- Moved Linear ZAR-124, local backlog, and this handover to In Progress.
- Added Freshdesk Solutions and Salesforce Knowledge to the tenant-safe provider registry with knowledge-source-only tools, docs references, safe setup schemas, and server-only executor metadata.
- Added Freshdesk API-token configuration with server-owned `{subdomain}.freshdesk.com` endpoint construction; tenant users configure subdomain and token, not API URLs.
- Added Freshdesk Solutions imports for `article:<id>`, `folder:<id>`, and `category:<id>` selections with Basic API-token auth, pagination, published-article filtering, source URIs, and secret redaction.
- Added Salesforce Knowledge imports for `article:<id>` and `category:<group>:<category>` selections through Salesforce REST query/SOQL against `Knowledge__kav` and `DataCategorySelection`.
- Wired both providers into memory provider imports, manual/daily recurring sync, review-gated drafts, deletion drafts, degraded-auth refresh handling, and approved-record-only runtime retrieval.
- Updated tenant integrations and memory UI with Freshdesk credential setup, provider logos, source-selection copy, and workflow-tool filtering for knowledge-only providers.
- Updated API, integrations, memory, roadmap, and backlog docs for the implemented source selection and server-owned endpoint model.

## Tests Run

- `npm run test:run -- packages/core/src/provider-registry.test.ts`
- `npm run test:run -- apps/web/src/integrationProviderBranding.test.ts apps/web/src/workflowBuilderToolCatalog.test.ts`
- `npm run test:run -- apps/api/src/integrations/connector-tools.contract.test.ts`
- `npm run test:run -- apps/api/src/memory/memory.controller.test.ts`
- `npm run build --workspace @zara/core`
- `npm run typecheck --workspace @zara/api`
- `npm run typecheck --workspace @zara/web`
- `node node_modules\vitest\vitest.mjs run --pool=threads --maxWorkers=1 --no-file-parallelism apps/web/src/app.test.tsx`

## Pending Work

- None for ISSUE-170 acceptance criteria.

## Risks And Edge Cases

- Salesforce operational CRM scopes may not imply Salesforce Knowledge access.
- Freshdesk article visibility can differ from public availability.
- CRM help-center ingestion must stay separate from operational ticket/case tools.
- Freshdesk v1 filters to published Solutions articles and does not expose a live search tool.
- Salesforce Knowledge v1 imports only approved indexed records through snapshots; runtime calls do not query Salesforce live.

## Decisions

- These follow after registry stabilization and the first Salesforce connector slice.
- Runtime retrieval uses approved indexed records only.
- Salesforce Knowledge is a separate provider ID from Salesforce CRM so help-center ingestion grants stay distinct from operational CRM tools.
- Freshdesk endpoint construction is server-owned from the configured subdomain; raw API URLs are not configurable by users.

## Next Recommended Step

Proceed to the next implementation issue after committing, pushing, and confirming CI.
