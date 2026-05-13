# ISSUE-013: Condition routing nodes

Issue link: https://github.com/tuzzy08/zara/issues/13

## Goal

Deliver Condition routing nodes for the Runtime area in the MVP Builder milestone.

## Acceptance Criteria

- Condition node validates expression shape
- Fallback branch is required
- Router tests cover branch selection

## Work Completed

- Added RED coverage in `packages/core/src/workflow.test.ts` for condition branch selection, invalid expressions, invalid targets, and required fallback behavior.
- Implemented first-class condition-route contracts in `packages/core/src/workflow.ts`, including `createConditionNode`, branch expression parsing, fallback validation, and route resolution helpers.
- Added exit-node support to the shared workflow graph so condition fallbacks can terminate safely instead of implying an open loop.
- Updated `apps/web/src/WorkflowBuilder.tsx` with condition-node creation from the top toolbar, condition inspector editing, fallback routing, and manifest preview output.
- Updated builder layout and styling in `apps/web/src/styles.css` so the desktop builder uses a 70:30 canvas-to-inspector split after removing the node library rail.
- Updated companion docs in `docs/Feature-Flows.md`, `docs/Runtime-Manifests.md`, `docs/Frontend-Architecture.md`, `docs/API.md`, `docs/Roadmap.md`, and `docs/Issue-Backlog.md`.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/workflow.test.ts` failed before condition helpers and fallback validation existed.
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/workflowBuilderIds.test.ts`
- GREEN: `npm.cmd run typecheck`
- Browser verification at `http://127.0.0.1:4173/workflows` confirmed the condition inspector, fallback exit path, and 70:30 canvas-to-inspector layout.

## Pending Work

- Issue scope is complete.
- Follow-on runtime execution work moves to ISSUE-018 so the compiler can consume the same condition-route contract.

## Risks And Edge Cases

- No matching branch
- Ambiguous conditions
- Expression grammar is intentionally narrow in v1. Richer predicates and data typing should be added in a future slice instead of broadening the current parser ad hoc.

## Decisions

- Priority: P1
- Labels: runtime, frontend, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Condition routes use explicit branch expressions plus a required fallback target.
- Exit nodes are part of the same builder contract because safe fallback and safe-cycle validation depend on an explicit terminal path.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then continue with ISSUE-018 so the runtime manifest compiler consumes the same condition, exit, and fallback model that the builder now publishes.
