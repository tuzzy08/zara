# ISSUE-183: Agent refactor drift, auth, and dashboard remediation

Status: In Progress

External: [Linear ZAR-183](https://linear.app/zara-voice/issue/ZAR-183/fix-agent-refactor-drift-auth-base-url-mismatch-and-dashboardtool-node)

## Context

This pass remediates post-ISSUE-182 drift and user-visible bugs found after the concrete-agent runtime refactor.

Confirmed starting findings:

- The workflow builder still exposes a visual `Tool` toolbox node and canvas `agent -> tool -> agent` flow even though the agreed direction is reusable concrete agents with assigned toolbelts.
- Clicking the Tool tile can show `Tool catalog is still loading.` indefinitely because catalog fetch errors and empty catalog states are collapsed into `[]`.
- The tenant sidebar labels `/` as `Agents`, but authenticated `/` renders the dashboard and there is no dedicated reusable agent library surface.
- `@zara/auth-client` defaults to `http://localhost:4010` while `apps/web` API calls default to `http://127.0.0.1:4010`, which can split auth cookies from tenant API requests in local development and surface as `Authentication required` after sign-in.
- The dashboard currently reports any rejected metric request as the generic message `Some dashboard metrics could not be loaded.`, which hides auth/session failures.
- `docs/Frontend-Architecture.md` still documents visual Tool nodes, while `docs/Agent-Tool-And-Transfer-Standard.md` describes tools as assigned agent capabilities.

## Completed Work

- Created Linear ZAR-183 and moved it to In Progress.
- Started a parallel audit pass for workflow tool-node drift, reusable Agents page gaps, and auth/dashboard failures.
- Added a regression test proving the auth client local fallback uses the same `127.0.0.1:4010` origin as the tenant API client when no env override is configured.
- Updated the tenant API client base URL resolver so `VITE_AUTH_BASE_URL` is used when `VITE_API_BASE_URL` is absent, preventing the checked-in auth-only local `.env` shape from splitting cookies across `localhost` and `127.0.0.1`.
- Added dashboard error-classification coverage and changed the dashboard to show a session/auth message for 401/403 auth failures instead of the generic metric-loading warning.
- Added a tenant `/agents` route and changed the tenant Agents sidebar item to point to `/agents` instead of `/`.
- Added `apps/web/src/reusableAgents.ts` as a browser-local reusable concrete-agent library scoped by organization and workspace.
- Added `TenantAgentsScreen` with creation controls for name, class, default language, runtime profile, instructions, and an empty-but-valid toolbelt state.
- Added focused RED/GREEN tests for reusable-agent storage, reusable-agent creation, and `/agents` route/navigation.
- Added focused workflow-builder RED tests proving the Tool toolbox tile is absent and the stale `Tool catalog is still loading.` path is not exposed when adding workflow nodes.
- Removed the new-workflow visual Tool toolbox tile and deleted the stale `addTool` creation callback, while preserving existing saved tool-node rendering/inspector compatibility.
- Added workflow agent-inspector selection for active-workspace reusable agents, applying the reusable agent's name, class-derived role kind, instructions, runtime profile, model tier, and default language to the selected workflow agent.
- Removed the `balanced` runtime option from tenant reusable-agent creation and reusable-agent validation.
- Updated workflow-builder and app smoke tests that still expected the Tool tile, and routed saved tool-node inspector coverage through the seeded published workflow instead of creating a fresh visual tool node.
- Updated stale workflow/toolbelt docs in `docs/Frontend-Architecture.md`, `docs/Feature-Flows.md`, `docs/API.md`, and `docs/Runtime-Manifests.md`.
- Added a tenant-scoped `AgentsModule` with `GET /organizations/:orgId/agents?workspaceId=...` and `POST /organizations/:orgId/agents`, backed by validated tenant JSON state.
- Converted the tenant Agents page and workflow builder reusable-agent selector from browser-local storage to the reusable agents API.
- Added API coverage for tenant auth, required workspace listing, reusable-agent create/list, and tenant/workspace isolation.
- Added core `AgentToolbeltAssignmentConfig` support on agent role node config and deep-cloned assignment metadata during workflow graph cloning.
- Updated runtime manifest compilation so agent-owned toolbelt assignments compile directly into `toolBindings` and `agentToolAssignments` without requiring visual Tool nodes.
- Updated workflow builder reusable-agent application so selecting a reusable agent snapshots its current toolbelt assignments onto the workflow agent role.
- Preserved optional `integrationConnectionId` semantics across API, web, and core models so connector tools can require credentials without blocking future internal/no-auth tools.
- Added `PUT /organizations/:orgId/agents/:agentId/toolbelt` as a full-replacement reusable-agent toolbelt mutation with tenant/workspace/agent scoping and connector connection validation.
- Reused integration connection/tool validation for reusable-agent toolbelts without creating workflow/version-scoped runtime grants at agent-edit time.
- Added an inline Agents page toolbelt editor that loads connected provider accounts plus agent-tool catalog metadata, saves assignments through the reusable-agent API, and keeps the visual Tool-node flow out of the Agents page.
- Added a reusable-agent client mutation for toolbelt replacement that sends assignment metadata only and no secrets, tokens, credential references, provider URLs, or request headers.
- Replaced the tenant web default sandbox workflow's seeded visual Tool node with an agent-owned `toolbeltAssignments` fixture.
- Migrated the shared core runtime manifest fixture from a visual Tool node to an agent-owned `customer-profile-lookup` toolbelt assignment, including premium realtime tool declaration expectations and multi-tool assignment coverage.
- Migrated core sandbox and live-call session fixtures from visual Tool nodes to agent-owned toolbelt assignments, including sandbox tool invocation and packet available-tool projections.
- Migrated API live sandbox controller, websocket, and router fixtures from visual Tool nodes to agent-owned toolbelt assignments, including permission-grant assertions, agent-requested tool actions, router packet tool projections, and removal of unused visual tool graph nodes.

## Tests Run

- RED/GREEN: `npm.cmd run test:run -- packages/auth-client/src/index.test.ts -t "same local API origin" --pool=threads`
- GREEN: `npm.cmd run test:run -- apps/web/src/apiClient.test.ts --pool=threads`
- GREEN: `npm.cmd run test:run -- apps/web/src/DashboardScreen.test.ts --pool=threads`
- Attempted: `npm.cmd run test:run -- apps/web/src/DashboardScreen.test.tsx -t "auth failures" --pool=threads` and `npm.cmd exec -- vitest run apps/web/src/DashboardScreen.test.tsx --pool=forks --fileParallelism=false --testTimeout 20000 --reporter=verbose -t "auth failures"` both failed before importing tests because Vitest worker startup timed out; the test was replaced with a pure `DashboardScreen.test.ts` classifier test.
- RED: `npm.cmd exec -- vitest run apps/web/src/reusableAgents.test.ts apps/web/src/TenantAgentsScreen.test.tsx apps/web/src/AppAgentsRoute.test.tsx`
  - Failed as expected because `./reusableAgents`, `./TenantAgentsScreen`, and the `/agents` route did not exist.
- RED: `npm.cmd exec -- vitest run apps/web/src/TenantAgentsScreen.test.tsx -t "reloads"`
  - Failed as expected because the reusable-agent list stayed on the previous workspace after rerender.
- GREEN/refactor verification: `npm.cmd exec -- vitest run apps/web/src/reusableAgents.test.ts apps/web/src/TenantAgentsScreen.test.tsx apps/web/src/AppAgentsRoute.test.tsx`
  - Passed: 3 files, 5 tests.
- RED: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "visual tool-node creation" --pool=threads`
  - Failed as expected because the Tool toolbox tile was still rendered.
- GREEN: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "visual tool-node creation|stale tool catalog loading|applies reusable agents|Router Agent preset|tool inspector provider options|connected provider tools" --pool=threads`
  - Passed: 1 file, 6 tests.
- GREEN: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx --pool=threads`
  - Passed: 1 file, 19 tests.
- GREEN: `npm.cmd run test:run -- apps/web/src/workflowBuilderWorkbench.test.ts --pool=threads`
  - Passed: 1 file, 2 tests.
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "does not expose the balanced runtime profile|opens an inline sandbox drawer for the current published workflow" --pool=threads`
  - Passed: 1 file, 2 tests.
- GREEN: `npm.cmd run typecheck --workspace @zara/web`
- RED: `npm.cmd run test:run -- apps/api/src/agents/agents.controller.test.ts --pool=threads`
  - Failed as expected because `AgentsModule` did not exist.
- GREEN: `npm.cmd run test:run -- apps/api/src/agents/agents.controller.test.ts --pool=threads`
  - Passed: 1 file, 4 tests.
- GREEN: `npm.cmd run test:run -- apps/web/src/reusableAgents.test.ts apps/web/src/TenantAgentsScreen.test.tsx apps/web/src/AppAgentsRoute.test.tsx --pool=threads`
  - Passed: 3 files, 5 tests.
- GREEN: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "applies reusable agents" --pool=threads`
  - Passed: 1 file, 1 test.
- GREEN: `npm.cmd run typecheck --workspace @zara/api`
- GREEN: `npm.cmd run typecheck --workspace @zara/web`
- RED: `npm.cmd run test:run -- packages/core/src/runtime.test.ts -t "agent-owned toolbelt" --pool=threads`
  - Failed as expected because runtime manifests ignored reusable-agent-owned toolbelt assignments when no visual Tool node existed.
- GREEN: `npm.cmd run test:run -- packages/core/src/runtime.test.ts --pool=threads`
  - Passed: 1 file, 26 tests.
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts --pool=threads`
  - Passed: 1 file, 31 tests.
- GREEN: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "applies reusable agents" --pool=threads`
  - Passed: 1 file, 1 test.
- GREEN: `npm.cmd run test:run -- apps/web/src/reusableAgents.test.ts apps/web/src/TenantAgentsScreen.test.tsx --pool=threads`
  - Passed: 2 files, 4 tests.
- GREEN: `npm.cmd run test:run -- apps/api/src/agents/agents.controller.test.ts --pool=threads`
  - Passed: 1 file, 4 tests.
- GREEN: `npm.cmd run typecheck --workspace @zara/core`
- GREEN: `npm.cmd run typecheck --workspace @zara/api`
- GREEN: `npm.cmd run typecheck --workspace @zara/web`
- RED: `npm.cmd run test:run -- apps/api/src/agents/agents.controller.test.ts -t "toolbelt" --pool=threads`
  - Failed as expected because the reusable-agent toolbelt route did not exist.
- GREEN: `npm.cmd run test:run -- apps/api/src/agents/agents.controller.test.ts --pool=threads`
  - Passed: 1 file, 6 tests.
- RED: `npm.cmd run test:run -- apps/web/src/reusableAgents.test.ts -t "toolbelts" --pool=threads`
  - Failed as expected because the reusable-agent client did not expose a toolbelt mutation.
- RED: `npm.cmd run test:run -- apps/web/src/TenantAgentsScreen.test.tsx -t "connected catalog tool" --pool=threads`
  - Failed as expected because the Agents page had no toolbelt configuration UI.
- GREEN: `npm.cmd run test:run -- apps/web/src/reusableAgents.test.ts apps/web/src/TenantAgentsScreen.test.tsx --pool=threads`
  - Passed: 2 files, 6 tests.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts --pool=threads`
  - Passed: 1 file, 16 tests.
- GREEN: `npm.cmd run typecheck --workspace @zara/api`
- GREEN: `npm.cmd run typecheck --workspace @zara/web`
- RED: `npm.cmd run test:run -- apps/web/src/defaultSandboxWorkflow.test.ts --pool=threads`
  - Failed as expected because the default sandbox workflow still seeded a visual Tool node.
- GREEN: `npm.cmd run test:run -- apps/web/src/defaultSandboxWorkflow.test.ts --pool=threads`
  - Passed: 1 file, 1 test.
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "sandbox runtime surface|published workflow" --pool=threads`
  - Passed: 1 file, 3 tests.
- GREEN: `npm.cmd run typecheck --workspace @zara/web`
- RED: `npm.cmd run test:run -- packages/core/src/runtime.test.ts -t "deterministic manifest|tool declarations|multiple agent-owned" --pool=threads`
  - Failed as expected because the core runtime fixture still compiled the seeded profile lookup from a visual Tool node.
- GREEN: `npm.cmd run test:run -- packages/core/src/runtime.test.ts --pool=threads`
  - Passed: 1 file, 26 tests.
- GREEN: `npm.cmd run typecheck --workspace @zara/core`
- RED/GREEN: `npm.cmd run test:run -- packages/core/src/live-call-session.test.ts -t "assigned tools" --pool=threads`
  - Failed before fixture migration because packet tools still used the visual `tool-profile` node ID, then passed after moving the fixture to `agent-frontdesk:profile-lookup`.
- GREEN: `npm.cmd run test:run -- packages/core/src/sandbox.test.ts --pool=threads`
  - Passed: 1 file, 5 tests.
- GREEN: `npm.cmd run test:run -- packages/core/src/live-call-session.test.ts --pool=threads`
  - Passed: 1 file, 12 tests.
- GREEN: `npm.cmd run typecheck --workspace @zara/core`
- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts -t "assigned tools|connector tool schemas" --pool=threads`
  - Failed as expected while the hand-built compiled manifest still projected `tool-customer-profile`.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts -t "assigned tools|connector tool schemas" --pool=threads`
  - Passed: 1 file, 2 tests.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts -t "integration tool grants" --pool=threads`
  - Passed: 1 file, 1 test.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "agent-requested tool" --pool=threads`
  - Passed: 1 file, 5 tests.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts --pool=threads`
  - Passed: 3 files, 72 tests.

## Pending Work

- Clean up remaining node-shaped tool assignment IDs in API provider/executor tests and web default sandbox fixtures, then remove the retained visual tool-node compatibility path once legacy seeded graph coverage is replaced.
- Consider explicit remove controls for individual reusable-agent toolbelt assignments; the current inline editor can add/replace selected tools while preserving existing assignments.

## Risks

- The runtime now compiles reusable-agent-owned toolbelt assignments, but still retains visual tool-node compatibility for existing saved graphs until a separate tested removal pass deletes that legacy path.
- Auth URL changes must preserve configured `VITE_AUTH_BASE_URL` / `VITE_API_BASE_URL` behavior and only change the unconfigured local fallback.
- Dashboard messaging should not leak sensitive auth/session details.
- The `/agents` slice is now API-backed with file-backed tenant JSON state for local control-plane durability. A future production pass may replace the file repository with normalized Postgres tables without changing the tenant route contract.

## Decisions

- The tenant Agents page is the creation and management surface for reusable concrete agents.
- Workflow canvas should model call flow and handoff, not tool assignment.
- Tools belong to reusable/concrete agent toolbelts and are validated as agent-scoped capabilities.
- Local auth and tenant API clients must share the same default origin.
- Reusable agents are tenant/workspace-scoped API resources. The browser does not own reusable-agent persistence.
- Editing reusable-agent toolbelts validates connector availability and scopes, but does not create workflow/version-scoped runtime grants; publish/runtime remain responsible for scoped execution grants.

## Next Recommended Step

Continue ISSUE-183 with the next bounded RED/GREEN slice: remove the remaining visual tool-node compatibility path or replace legacy seeded graph coverage with reusable-agent toolbelt fixtures, without reintroducing role/role-id fallbacks.
