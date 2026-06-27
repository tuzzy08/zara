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

## Pending Work

- Move reusable-agent persistence to a backend repository/API if product requirements require cross-browser or multi-user durability.
- Add the tenant-facing toolbelt assignment surface for reusable agents, then compile those assignments into runtime agent tool capabilities without using visual Tool nodes.
- Review parallel agent findings and integrate only bounded, verified changes.

## Risks

- The runtime still derives `agentToolAssignments` from visual tool nodes for existing saved workflow compatibility; replacing this with reusable-agent toolbelts remains pending and should be driven by focused tests before changing runtime/core behavior.
- Auth URL changes must preserve configured `VITE_AUTH_BASE_URL` / `VITE_API_BASE_URL` behavior and only change the unconfigured local fallback.
- Dashboard messaging should not leak sensitive auth/session details.
- The `/agents` slice currently uses browser-local storage, so reusable agents are real inside the tenant app session but are not yet shared across browsers, users, or devices.

## Decisions

- The tenant Agents page is the creation and management surface for reusable concrete agents.
- Workflow canvas should model call flow and handoff, not tool assignment.
- Tools belong to reusable/concrete agent toolbelts and are validated as agent-scoped capabilities.
- Local auth and tenant API clients must share the same default origin.
- For this bounded pass, `/agents` uses a local app state/store slice because no existing reusable-agent persistence API is present and the user requested avoiding backend work when possible.

## Next Recommended Step

Continue ISSUE-183 with the next bounded RED/GREEN slice: reusable-agent toolbelt assignment UI plus backend/runtime toolbelt compilation, without reintroducing visual Tool nodes or role/role-id fallbacks.
