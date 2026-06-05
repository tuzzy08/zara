# ISSUE-158: Capability grants and connection scope setup UX

Status: In Progress
External: [Linear ZAR-112](https://linear.app/zara-voice/issue/ZAR-112/issue-158-capability-grants-and-connection-scope-setup-ux)

## Goal

Add scoped capability grants and simple organization/workspace connection setup UX for integrations.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependency on ISSUE-157.
- Started implementation pass after ZAR-111/ISSUE-157 was completed and Linear ZAR-112 was moved to In Progress.
- Added organization-wide and workspace-owned integration connection availability to OAuth, Zendesk API-token configuration, persisted state, connection listing, and tenant UI loading.
- Added audited workspace-to-organization promotion for workspace-owned connections. Promotion changes availability only and does not create capability grants.
- Added scoped tool grant validation against tenant role, provider match, connection availability, revoked state, and provider-required OAuth scopes. Missing scopes return reconnect metadata.
- Added publish-time validation for connector tool bindings with missing grants, unavailable workspace-owned credentials, revoked credentials, and insufficient scopes.
- Added revoke/delete dependency handling: delete blocks active grants, while revoke pauses active dependent grants and removes credential use.
- Updated the tenant integrations page to select setup scope, show connection scope labels, promote workspace-owned connections, and show paused grants.

## Tests Run

- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "shows scoped integration connections"`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "shows scoped integration connections|tenant integration tools|configure Zendesk credentials"`
- `npx.cmd tsc -p apps/web/tsconfig.json --noEmit`
- `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts apps/api/src/integrations/tool-permission-grants.service.test.ts apps/api/src/integrations/integrations.persistence.test.ts`
- `npx.cmd tsc -p apps/api/tsconfig.json --noEmit`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/workflowBuilderToolCatalog.test.ts -t "shows scoped integration connections|tenant integration tools|configure Zendesk credentials|lists only real tenant connections"`

## Pending Work

- Add full capability toggles for knowledge-source ingestion and post-call sync, not only agent-tool grants.
- Add previewable/editable setup presets for support, sales, and ecommerce with risky write tools defaulting approval-required.
- Add workspace setup copy flow that never clones credentials, OAuth grants, or workspace-owned source access.
- Wire publish validation into the workflow publish path so insufficient scoped grants block release.
- Expand tenant UI reconnect prompts for insufficient scopes and provider scope deltas.

## Risks And Edge Cases

- Connection availability is not the same as permission to use a capability.
- Promotion from workspace to organization scope must not create automatic grants.
- Revoked connections should pause dependent sync/jobs without deleting historical state.
- Existing saved grants without `capability` or `requiredScopes` are normalized on read, but follow-up migrations may be needed for future persisted stores.
- Publish validation is implemented in the grants service but still needs integration into the workflow publish controller/service path.

## Decisions

- Support both organization-wide and workspace-owned connections to reduce setup friction.
- Present grants as clear capability toggles and guided setup rather than raw permission records.
- Default new tenant-page setup to workspace-owned scope for safer least-privilege behavior, with an explicit organization-wide option.
- Keep reconnecting a revoked connection in its previous availability scope instead of silently adopting the current setup selector.

## Next Recommended Step

Start with failing workflow publish tests that prove scoped grant validation blocks releases, then wire the existing publish validator into the publish path.
