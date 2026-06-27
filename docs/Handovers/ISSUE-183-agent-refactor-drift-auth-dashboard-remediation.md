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

## Tests Run

- RED/GREEN: `npm.cmd run test:run -- packages/auth-client/src/index.test.ts -t "same local API origin" --pool=threads`
- GREEN: `npm.cmd run test:run -- apps/web/src/apiClient.test.ts --pool=threads`
- GREEN: `npm.cmd run test:run -- apps/web/src/DashboardScreen.test.ts --pool=threads`
- Attempted: `npm.cmd run test:run -- apps/web/src/DashboardScreen.test.tsx -t "auth failures" --pool=threads` and `npm.cmd exec -- vitest run apps/web/src/DashboardScreen.test.tsx --pool=forks --fileParallelism=false --testTimeout 20000 --reporter=verbose -t "auth failures"` both failed before importing tests because Vitest worker startup timed out; the test was replaced with a pure `DashboardScreen.test.ts` classifier test.

## Pending Work

- Add focused RED tests for auth base URL fallback alignment.
- Add focused RED tests for removing the stale Tool toolbox entry and preventing the loading toast path.
- Add focused RED tests for the tenant Agents page/reusable-agent creation path.
- Implement the smallest fixes and update stale docs.
- Review parallel agent findings and integrate only bounded, verified changes.

## Risks

- The runtime still derives `agentToolAssignments` from visual tool nodes; replacing this with reusable-agent toolbelts may require a staged compatibility decision if existing published workflows need migration. The user has already stated not to preserve legacy/fallback behavior, so the code should prefer the new model and reject stale paths rather than silently supporting both.
- Auth URL changes must preserve configured `VITE_AUTH_BASE_URL` / `VITE_API_BASE_URL` behavior and only change the unconfigured local fallback.
- Dashboard messaging should not leak sensitive auth/session details.

## Decisions

- The tenant Agents page is the creation and management surface for reusable concrete agents.
- Workflow canvas should model call flow and handoff, not tool assignment.
- Tools belong to reusable/concrete agent toolbelts and are validated as agent-scoped capabilities.
- Local auth and tenant API clients must share the same default origin.

## Next Recommended Step

Write the failing tests for the confirmed auth/dashboard/toolbox/agents-page behaviors, then implement the smallest passing changes.
