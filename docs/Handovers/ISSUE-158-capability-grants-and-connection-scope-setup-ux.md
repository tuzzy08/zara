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
- Wired the tenant workflow builder publish dialog to the backend workflow publish endpoint and saves only the server-returned published version after validation succeeds.
- Surfaced backend publish/grant validation failures in the publish dialog and toast without mutating the local published workflow registry.
- Added a published live-sandbox session guard so already-published manifests with incomplete integration grants cannot start a published sandbox run.
- Tightened publish grant validation to require active `agent-tool` grants for every assigned role; knowledge-source/post-call grants no longer satisfy agent tool bindings.
- Added revoke/delete dependency handling: delete blocks active grants, while revoke pauses active dependent grants and removes credential use.
- Updated the tenant integrations page to select setup scope, show connection scope labels, promote workspace-owned connections, and show paused grants.
- Added HubSpot `post-call-sync` capability metadata to the tenant-safe provider catalog.
- Tightened grant creation/runtime behavior so separate capability grants can coexist, unsupported provider/capability combinations are rejected, and non-agent capability grants cannot authorize runtime agent-tool execution.
- Added a catalog-driven tenant integrations capability setup section that shows agent tools, knowledge source, and post-call sync lanes with active/paused/revoked/not-configured status by provider.
- Added support, sales, and ecommerce setup preset preview/template helpers with risky write tools defaulting approval-required and copyable templates that omit credentials, OAuth grants, connection IDs, grant IDs, source IDs, and workspace-owned source access.
- Adjusted dashboard active tool grant metrics to count active `agent-tool` grants only.
- Added inline capability grant configuration controls on the tenant integrations page so tenant admins can choose a published workflow, provider connection, provider tool, approval posture, and save scoped `agent-tool`, `knowledge-source`, or `post-call-sync` grants through the real integrations grant endpoint.

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
- `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "does not save a local workflow"`
- `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx`
- `npx.cmd tsc -p apps/web/tsconfig.json --noEmit`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "publishes builder manifests|publishes workflow|published workflow|Support billing lane|Phone test"`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "loads sandbox workflows only from the active workspace"`
- `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx apps/web/src/app.test.tsx`
- `npm.cmd run lint`
- `npx.cmd tsc -p apps/web/tsconfig.json --noEmit`
- `npm.cmd run test:run` was attempted after the frontend publish wiring; affected app/builder suites passed after the timeout fix, but the full run still fails while the unrelated dirty `README.md` lacks the `## Quality Gates` heading required by `packages/core/src/ci-quality-gates.test.ts`.
- `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts -t "keeps separate grants"`
- `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts -t "does not allow runtime"`
- `npm.cmd run test:run -- packages/core/src/provider-registry.test.ts -t "post-call sync"`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "capability setup lanes"`
- `npm.cmd run test:run -- apps/web/src/integrationSetupPresets.test.ts`
- `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts -t "rejects capability grants"`
- `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "renders the dashboard with real workspace metrics"`
- `npm.cmd run test:run -- packages/core/src/provider-registry.test.ts apps/api/src/integrations/tool-permission-grants.service.test.ts apps/web/src/integrationSetupPresets.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "renders the dashboard with real workspace metrics|renders tenant integrations controls|renders tenant integration tools|configure Zendesk credentials|shows scoped integration connections|capability setup lanes"`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "save a scoped capability grant"`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "renders tenant integrations controls|capability setup lanes|save a scoped capability grant"`
- `npx.cmd tsc -p apps/web/tsconfig.json --noEmit`
- `npm.cmd run lint`

## Pending Work

- Wire the support, sales, and ecommerce preset preview model into an editable tenant UI before saving.
- Add workspace setup copy UI that uses the safe template model and never clones credentials, OAuth grants, or workspace-owned source access.
- Expand tenant UI reconnect prompts for insufficient scopes and provider scope deltas.

## Risks And Edge Cases

- Connection availability is not the same as permission to use a capability.
- Promotion from workspace to organization scope must not create automatic grants.
- Revoked connections should pause dependent sync/jobs without deleting historical state.
- Existing saved grants without `capability` or `requiredScopes` are normalized on read, but follow-up migrations may be needed for future persisted stores.
- Role-specific grants must cover every role assigned to a tool node; a grant for one role is not enough for another role using the same provider tool.
- The tenant builder now trusts the server-returned published version, so any future backend publish metadata changes should be kept compatible with the local sandbox registry shape.
- `post-call-sync` is currently catalog-supported for HubSpot only; preset generation and grant creation should remain catalog-driven as more providers add that capability.
- The tenant integrations page reads published workflows from the existing local workflow registry; a future server-backed workflow listing should preserve the same workspace-scoped selection behavior.

## Decisions

- Support both organization-wide and workspace-owned connections to reduce setup friction.
- Present grants as clear capability toggles and guided setup rather than raw permission records.
- Default new tenant-page setup to workspace-owned scope for safer least-privilege behavior, with an explicit organization-wide option.
- Keep reconnecting a revoked connection in its previous availability scope instead of silently adopting the current setup selector.
- Capability setup and presets must be derived from provider catalog capabilities; existing provider IDs alone are not enough to expose post-call sync or future capability lanes.

## Next Recommended Step

Wire preset previews and setup-copy into the tenant UI, then add reconnect prompts for insufficient scopes/provider scope deltas.
