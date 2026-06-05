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
- Added a backend workflow publish endpoint that compiles the published runtime manifest and blocks publish when scoped integration tool grants are invalid.
- Added a published live-sandbox session guard so already-published manifests with incomplete integration grants cannot start a published sandbox run.
- Tightened publish grant validation to require active `agent-tool` grants for every assigned role; knowledge-source/post-call grants no longer satisfy agent tool bindings.
- Added revoke/delete dependency handling: delete blocks active grants, while revoke pauses active dependent grants and removes credential use.
- Updated the tenant integrations page to select setup scope, show connection scope labels, promote workspace-owned connections, and show paused grants.

## Tests Run

- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "shows scoped integration connections"`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "shows scoped integration connections|tenant integration tools|configure Zendesk credentials"`
- `npx.cmd tsc -p apps/web/tsconfig.json --noEmit`
- `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts apps/api/src/integrations/tool-permission-grants.service.test.ts apps/api/src/integrations/integrations.persistence.test.ts`
- `npx.cmd tsc -p apps/api/tsconfig.json --noEmit`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/workflowBuilderToolCatalog.test.ts -t "shows scoped integration connections|tenant integration tools|configure Zendesk credentials|lists only real tenant connections"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts`
- `npm.cmd run test:run -- apps/api/src/workflows/workflows.controller.test.ts`
- `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts`
- `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts apps/api/src/workflows/workflows.controller.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts`
- `npm.cmd run typecheck`
- `npm.cmd run test:run -- apps/api/src`

## Pending Work

- Add full capability toggles for knowledge-source ingestion and post-call sync, not only agent-tool grants.
- Add previewable/editable setup presets for support, sales, and ecommerce with risky write tools defaulting approval-required.
- Add workspace setup copy flow that never clones credentials, OAuth grants, or workspace-owned source access.
- Wire the tenant workflow builder publish action to the backend publish endpoint instead of relying only on the local sandbox registry.
- Expand tenant UI reconnect prompts for insufficient scopes and provider scope deltas.

## Risks And Edge Cases

- Connection availability is not the same as permission to use a capability.
- Promotion from workspace to organization scope must not create automatic grants.
- Revoked connections should pause dependent sync/jobs without deleting historical state.
- Existing saved grants without `capability` or `requiredScopes` are normalized on read, but follow-up migrations may be needed for future persisted stores.
- Role-specific grants must cover every role assigned to a tool node; a grant for one role is not enough for another role using the same provider tool.
- The backend publish endpoint blocks invalid grants, but the tenant builder still needs to call that endpoint before this is fully user-visible from the publish dialog.

## Decisions

- Support both organization-wide and workspace-owned connections to reduce setup friction.
- Present grants as clear capability toggles and guided setup rather than raw permission records.
- Default new tenant-page setup to workspace-owned scope for safer least-privilege behavior, with an explicit organization-wide option.
- Keep reconnecting a revoked connection in its previous availability scope instead of silently adopting the current setup selector.

## Next Recommended Step

Add the tenant builder API call for workflow publish, surface grant validation errors in the publish dialog, then continue with capability toggles for knowledge-source ingestion and post-call sync.
