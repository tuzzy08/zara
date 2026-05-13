# ISSUE-009: React Flow visual builder

Issue link: https://github.com/tuzzy08/zara/issues/9

## Goal

Deliver the tenant workflow builder canvas with React Flow interactions and deterministic graph state.

## Work Completed

- Added `@xyflow/react` 12.10.2 to `apps/web`.
- Generated a workflow builder mockup with imagegen and implemented the resulting production-style builder direction.
- Added `apps/web/src/WorkflowBuilder.tsx` with the `/workflows` screen, React Flow canvas, selected-node inspector, validation panel, add-agent action, delete-selected action, and publish-disabled state.
- Wired `/workflows` in `apps/web/src/App.tsx`.
- Added shared graph operations in `packages/core/src/workflow.ts`: create, add, move, connect, delete, and deterministic serialization.
- Added unit coverage in `packages/core/src/workflow.test.ts` for add/move/connect/delete and deterministic serialization.
- Added light app smoke coverage in `apps/web/src/app.test.tsx` for the workflow builder route.
- Follow-up builder cleanup removed the redundant node library rail, moved node creation fully into the top toolbar, reduced the minimap footprint, and set the desktop workspace to a 70:30 canvas-to-inspector split.
- Added `apps/web/src/workflowBuilderIds.ts` and `apps/web/src/workflowBuilderIds.test.ts` so newly added nodes always get monotonic IDs even after deletes.
- Added post-delivery builder refinements so existing edges can be reconnected, node kinds have distinct accent borders and matching icon colors, the minimap mirrors those accents, and the desktop workspace now runs at a 75:25 canvas-to-inspector split.
- Updated feature-order docs in `docs/Roadmap.md`, `docs/Issue-Backlog.md`, `docs/Feature-Flows.md`, `docs/Frontend-Architecture.md`, and workflow validation API docs.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/workflow.test.ts` failed on missing `createAgentRoleNode`.
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=threads`
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts apps/web/src/app.test.tsx --pool=threads`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/web`
- GREEN: `npm.cmd run test:run -- apps/web/src/workflowBuilderIds.test.ts apps/web/src/app.test.tsx`
- GREEN: `npm.cmd run test:run -- apps/web/src/workflowBuilderTheme.test.ts packages/core/src/workflow.test.ts`
- Browser validation: `http://127.0.0.1:5173/workflows` at 1536x730 showed no shell horizontal overflow, main scroll region scrolls vertically, and the canvas rendered five builder nodes.
- Browser interaction check: Add agent added a specialist node; Delete selected removed it and restored the five-node draft.
- Browser refinement check: `http://127.0.0.1:4173/workflows` at 1918x947 showed the reclaimed builder space going to the canvas, with no empty third column and no duplicate-key console errors after reload.
- Browser interaction refinement: selecting an edge now surfaces React Flow edge updater handles, confirming reconnectable links are exposed in the live canvas.

## Pending Work

- Core builder-node types are now implemented through ISSUE-017.
- Persist drafts through the backend workflow API when that slice is built.

## Risks And Edge Cases

- React Flow dev runtime consumes the built `@zara/core` package, so shared package builds must stay current until source aliases are introduced.
- Current builder state is in-memory only.
- Tool authorization is represented as validation state until real integration grants are implemented.

## Decisions

- Used `@xyflow/react` 12.10.2, verified as the latest package version during implementation.
- Kept UI tests light and covered graph behavior in shared core tests.
- Treated ISSUE-009, ISSUE-010, and ISSUE-015 as one end-to-end Basic Workflow Builder feature slice.
- The visualizer remains primary on desktop; the inspector is secondary and should stay around a 75:25 split unless a later design pass intentionally changes it.

## Next Recommended Step

Start ISSUE-018 as the next slice so the current publishable builder can execute inside the sandbox runtime using the same graph and manifest contracts.
