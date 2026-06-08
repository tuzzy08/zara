# ISSUE-169: Confluence and SharePoint knowledge-source connectors

Status: Implemented
External: [Linear ZAR-123](https://linear.app/zara-voice/issue/ZAR-123/issue-169-confluence-and-sharepoint-knowledge-source-connectors)

## Goal

Add Confluence and SharePoint as registry-backed knowledge-source connectors with review-gated snapshot/daily sync.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependencies on ISSUE-161 and ISSUE-164.
- Started implementation pass on 2026-06-08.
- Moved Linear ZAR-123, local backlog, and this handover to In Progress.
- Added tenant web branding entries for Confluence and SharePoint provider logos.
- Added catalog-driven `/memory` provider-import UI copy for Confluence spaces/pages and SharePoint sites/pages/folders.
- Removed manual source text from provider-import source creation so admins configure provider selections instead of pasted provider content.
- Kept Confluence and SharePoint knowledge-source imports out of workflow-builder agent tool bindings.
- Added Confluence and SharePoint provider registry entries with knowledge-source capability, docs references, required scopes, and safe OAuth setup schemas.
- Added API-owned server metadata for Confluence and SharePoint without exposing provider base URLs or auth strategies to tenant catalog responses.
- Added executable knowledge-source import contracts for Confluence pages/spaces and SharePoint sites/pages/folders.
- Wired Confluence and SharePoint imports into the memory source pipeline as record-level review drafts with source URIs and no runtime visibility before approval.
- Added recurring refresh handling for provider-record updates, missing source URLs as deletion drafts, and provider 401/403 degradation that preserves approved knowledge.
- Recorded source-selection and scope-separation decisions in `docs/ADRs/ADR-003-confluence-sharepoint-knowledge-source-selection.md`.
- Updated Memory, Integrations, API, Roadmap, Design, and backlog docs.
- Repaired the CI web regression after the expanded mock catalog changed dashboard provider-health totals and workspace-scope label cardinality.

## Tests Run

- `npx.cmd vitest run apps/web/src/integrationProviderBranding.test.ts`
- `npx.cmd vitest run apps/web/src/app.test.tsx -t "configures Confluence and SharePoint provider-import knowledge sources"`
- `npx.cmd vitest run apps/web/src/workflowBuilderToolCatalog.test.ts -t "keeps knowledge-source-only providers out"`
- `npx.cmd vitest run apps/web/src/integrationProviderBranding.test.ts apps/web/src/workflowBuilderToolCatalog.test.ts apps/web/src/app.test.tsx -t "integration provider branding|workflow builder tool catalog|renders tenant memory controls|configures Confluence and SharePoint provider-import knowledge sources"`
- `npm.cmd run typecheck --workspace @zara/web`
- `npm.cmd run test:run -- packages/core/src/provider-registry.test.ts`
- `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts`
- `npm.cmd run test:run -- apps/api/src/integrations/connector-tools.contract.test.ts`
- `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts`
- `npx.cmd vitest run apps/web/src/app.test.tsx -t "configures Confluence and SharePoint provider-import knowledge sources" --pool=threads`
- `npm.cmd run typecheck --workspace @zara/core`
- `npm.cmd run typecheck --workspace @zara/api`
- `npx.cmd vitest run apps/web/src/app.test.tsx -t "renders the dashboard with real workspace metrics|shows scoped integration connections" --pool=threads`
- `npx.cmd vitest run apps/web/src/app.test.tsx --pool=threads`

Partial/local checks:

- `npm.cmd run test:run` still fails locally because of unrelated uncommitted `README.md` quality-gate changes and stale generated `apps/api/dist-js` output; the GitHub CI failure being fixed was the `apps/web/src/app.test.tsx` assertion regression.

## Pending Work

- Watch the post-fix GitHub CI rerun and keep ISSUE-169 closed only after the quality gates are green. Follow-up knowledge-source expansion continues with ISSUE-170.

## Risks And Edge Cases

- Provider permissions vary by page, folder, site, or space.
- Deleted content should create review drafts rather than immediately deleting active records.
- SharePoint knowledge scopes must not be conflated with Outlook calendar v1 scopes.

## Decisions

- Confluence and SharePoint are knowledge-source connectors, not general live provider search during calls.
- Tenant provider-import UI should collect provider source selections, not raw provider API URLs or pasted source text.
- Confluence selections use `page:<pageId>` or `space:<spaceId>`; SharePoint selections use `site:<siteId>:page:<pageId>` or `site:<siteId>:drive:<driveId>:item:<itemId>`.
- SharePoint knowledge-source scopes stay separate from Microsoft 365 Outlook Calendar scopes.

## Next Recommended Step

Confirm the post-fix GitHub CI run is green, then start ISSUE-170.
