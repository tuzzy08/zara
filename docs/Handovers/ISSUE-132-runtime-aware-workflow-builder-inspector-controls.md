# ISSUE-132: Runtime-aware workflow builder inspector controls

External: [Linear ZAR-140](https://linear.app/zara-voice/issue/ZAR-140/issue-132-runtime-aware-workflow-builder-inspector-controls)

Status: Implemented
Date: 2026-05-26

## Work Completed

- Added failing workflow-builder coverage for runtime-specific agent inspector controls, blank/latest workflow startup, toolbar workflow-name removal, supported-language dropdown multi-select, and caller fallback options.
- Changed `/workflows` startup so an empty workspace opens a blank entry canvas and a workspace with saved workflows opens the most recently published workflow by `createdAt`.
- Removed the inline workflow name input beside the workflow dropdown; workflow naming remains in the publish dialog.
- Scoped agent model controls by runtime profile:
  - cost-optimized and balanced show text model tier/provider/model controls.
  - premium realtime shows realtime provider/model controls.
- Replaced the native supported-language multi-select with a compact dropdown-style checkbox menu.
- Added the calling agent to intent-route fallback target options, kept branch target options filtered to post-intent destinations, and updated shared validation so explicit fallback-to-caller loop edges are valid.
- Made default specialist templates explicit so reusable templates remain available now that the builder no longer depends on a seeded sample canvas.
- Updated `DESIGN.md`, `docs/Frontend-Architecture.md`, `docs/Roadmap.md`, and `docs/Issue-Backlog.md`.
- Follow-up on 2026-06-04: changed the tool inspector from a single global tool-action dropdown to provider-first selection with a second provider-specific tool dropdown.
- Follow-up on 2026-06-04: aligned the builder tool catalog with the backend connector tool IDs, including Zendesk `zendesk.tickets.search`, `zendesk.tickets.create`, and `zendesk.tickets.update`.
- Follow-up on 2026-06-04: removed hardcoded inspector connection fixtures; the connection dropdown now uses tenant integration connections fetched from the integrations API and preserves a loaded node's existing binding if it is not in the fetched list.
- Follow-up on 2026-06-04: removed user-editable HTTP method, URL, token, headers, and body fields from the tool inspector for built-in provider tools; provider request details stay Zara-owned catalog metadata.
- Follow-up on 2026-06-04: aligned workflow-builder CI coverage with missing-credential behavior after removing hardcoded inspector connections; newly added tool nodes now surface the repair/auth marker until a real tenant connection is selected.
- Follow-up on 2026-06-11: changed the workflow builder tool inspector to fetch active integration tool grants, list only configured agent tools, bind the selected tool to a grant-backed connection/risk/approval posture, and replace editable authorization/approval checkboxes with read-only policy metadata.
- Follow-up on 2026-06-11: changed agent model tier/provider controls so changing the tier selects the matching configured model automatically instead of leaving a stale model selection in place.
- Follow-up on 2026-06-11: added provider-scoped multi-tool selection for tool nodes. One visual tool node can now select multiple active configured tools for the same provider/connection, and core expands that node into multiple runtime tool bindings and agent assignments while preserving the primary tool node ID for backwards compatibility.

## Tests Run

- `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx --pool=forks`
- `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx apps/web/src/workflowBuilderWorkbench.test.ts --pool=forks`
- `npm.cmd run test:run -- packages/core/src/workflow.test.ts --pool=forks`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=forks`
- `npm.cmd run test:run -- --pool=forks`
- `npm.cmd run typecheck`
- Browser smoke attempted at `http://127.0.0.1:4176/workflows`; the local app rendered the sign-in page, so authenticated builder UI could not be visually verified in-browser during this pass.
- Follow-up on 2026-06-04: `npm.cmd exec -- vitest run apps/web/src/workflowBuilderToolCatalog.test.ts apps/web/src/workflowBuilderPublish.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- Follow-up on 2026-06-04: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-04: `git diff --check`
- Follow-up on 2026-06-04 CI repair: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/WorkflowBuilder.test.tsx --reporter=verbose`
- Follow-up on 2026-06-04 CI repair: `npm.cmd run test:run`
- Follow-up on 2026-06-04 CI repair: `npm.cmd run lint`
- Follow-up on 2026-06-04 CI repair: `npm.cmd run typecheck`
- Follow-up on 2026-06-04 CI repair: `npm.cmd run eval:runtime`
- Follow-up on 2026-06-04 CI repair: `npm.cmd run eval:pstn`
- Follow-up on 2026-06-04 CI repair: `npm.cmd run db:check`
- UI test and browser smoke were skipped during the 2026-06-04 follow-up at the user's request.
- Follow-up on 2026-06-11: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx`
- Follow-up on 2026-06-11: `npm.cmd run test:run -- packages/core/src/runtime.test.ts packages/core/src/workflow.test.ts`
- Follow-up on 2026-06-11: `npm.cmd run build --workspace @zara/core`
- Follow-up on 2026-06-11: `npm.cmd run typecheck --workspace @zara/core`
- Follow-up on 2026-06-11: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-11: `npm.cmd run typecheck --workspace @zara/api`
- Follow-up on 2026-06-11: `npm.cmd run lint`

## Pending Work

- Run authenticated browser QA against `/workflows` to verify the rendered inspector/menu behavior in the real tenant shell when UI testing is back in scope.

## Risks

- Most-recent workflow startup depends on published version `createdAt`; imported or legacy versions with odd timestamps may need normalization.
- Explicit fallback-to-caller loops are valid only when represented as a condition-labeled fallback edge; branch target selectors still exclude the caller in the builder.
- If the integrations API cannot be reached, new provider tool nodes start with missing credentials; loaded workflow nodes keep their saved connection label/status in the selector.
- Built-in connector request metadata remains in the graph for validation/runtime compatibility, but the inspector no longer exposes those endpoint fields for tenant editing.
- Tool grant safety posture is now derived from configured grants in the inspector; workflow authors should not manually toggle whether a configured provider tool requires account authorization or human approval.
- Multi-tool selection is intentionally limited to active grants for the selected provider/connection. Cross-provider selection still requires separate visual tool nodes.

## Decisions

- Kept workflow naming in publish flow to avoid a second text field beside the workflow selector.
- Kept text and realtime settings mutually exclusive in the inspector based on the effective role runtime, including inherited workflow runtime.
- Kept reusable specialist defaults independent of the canvas seed so blank startup does not remove template shortcuts.
- Treated the tool connection dropdown as the tenant credential/grant binding for runtime execution, not as an API endpoint or parameter selector.
- Kept built-in provider API URLs and payload shapes inside Zara-owned connector metadata; tenant-facing configuration belongs on the integrations page and is limited to provider-required credentials such as Zendesk subdomain, email, and API token.

## Next Recommended Step

- Browser-smoke `/workflows` with a seeded/local authenticated tenant session when UI testing is re-enabled.
