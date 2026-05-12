# ISSUE-009: React Flow visual builder

Issue link: https://github.com/tuzzy08/zara/issues/9

## Goal

Deliver the tenant workflow builder canvas with React Flow interactions and deterministic graph state.

## Work Completed

- Added `@xyflow/react` 12.10.2 to `apps/web`.
- Generated a workflow builder mockup with imagegen and implemented the resulting production-style builder direction.
- Added `apps/web/src/WorkflowBuilder.tsx` with the `/workflows` screen, node library, React Flow canvas, selected-node inspector, validation panel, add-agent action, delete-selected action, and publish-disabled state.
- Wired `/workflows` in `apps/web/src/App.tsx`.
- Added shared graph operations in `packages/core/src/workflow.ts`: create, add, move, connect, delete, and deterministic serialization.
- Added unit coverage in `packages/core/src/workflow.test.ts` for add/move/connect/delete and deterministic serialization.
- Added light app smoke coverage in `apps/web/src/app.test.tsx` for the workflow builder route.
- Updated feature-order docs in `docs/Roadmap.md`, `docs/Issue-Backlog.md`, `docs/Feature-Flows.md`, `docs/Frontend-Architecture.md`, and workflow validation API docs.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/workflow.test.ts` failed on missing `createAgentRoleNode`.
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=threads`
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts apps/web/src/app.test.tsx --pool=threads`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/web`
- Browser validation: `http://127.0.0.1:5173/workflows` at 1536x730 showed no shell horizontal overflow, main scroll region scrolls vertically, and the canvas rendered five builder nodes.
- Browser interaction check: Add agent added a specialist node; Delete selected removed it and restored the five-node draft.

## Pending Work

- Extend the canvas with real tool, handoff, condition, and escalation node editors in ISSUE-011 through ISSUE-014.
- Persist drafts through the backend workflow API when that slice is built.

## Risks And Edge Cases

- React Flow dev runtime consumes the built `@zara/core` package, so shared package builds must stay current until source aliases are introduced.
- Current builder state is in-memory only.
- Tool authorization is represented as validation state until real integration grants are implemented.

## Decisions

- Used `@xyflow/react` 12.10.2, verified as the latest package version during implementation.
- Kept UI tests light and covered graph behavior in shared core tests.
- Treated ISSUE-009, ISSUE-010, and ISSUE-015 as one end-to-end Basic Workflow Builder feature slice.

## Next Recommended Step

Start ISSUE-011, ISSUE-012, and ISSUE-014 as the next builder slice so tool binding, specialist handoff, and human escalation become real publishable node types.
