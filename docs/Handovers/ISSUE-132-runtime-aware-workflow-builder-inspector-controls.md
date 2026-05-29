# ISSUE-132: Runtime-aware workflow builder inspector controls

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

## Tests Run

- `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx --pool=forks`
- `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx apps/web/src/workflowBuilderWorkbench.test.ts --pool=forks`
- `npm.cmd run test:run -- packages/core/src/workflow.test.ts --pool=forks`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=forks`
- `npm.cmd run test:run -- --pool=forks`
- `npm.cmd run typecheck`
- Browser smoke attempted at `http://127.0.0.1:4176/workflows`; the local app rendered the sign-in page, so authenticated builder UI could not be visually verified in-browser during this pass.

## Pending Work

- Run authenticated browser QA against `/workflows` to verify the rendered inspector/menu behavior in the real tenant shell.

## Risks

- Most-recent workflow startup depends on published version `createdAt`; imported or legacy versions with odd timestamps may need normalization.
- Explicit fallback-to-caller loops are valid only when represented as a condition-labeled fallback edge; branch target selectors still exclude the caller in the builder.

## Decisions

- Kept workflow naming in publish flow to avoid a second text field beside the workflow selector.
- Kept text and realtime settings mutually exclusive in the inspector based on the effective role runtime, including inherited workflow runtime.
- Kept reusable specialist defaults independent of the canvas seed so blank startup does not remove template shortcuts.

## Next Recommended Step

- Browser-smoke `/workflows` with a seeded/local authenticated tenant session.
