# ISSUE-013: Condition routing nodes

External: [GitHub #13](https://github.com/tuzzy08/zara/issues/13)

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
- Follow-up UI pass now presents condition nodes as `Intent route` nodes. Branches are configured through an intent dropdown plus target selector, raw expression strings are no longer shown in the inspector, and each branch has a delete action beside the existing add-branch control.
- Follow-up builder pass changed new intent-route fallback defaults so they use an explicit exit node when available and otherwise remain unselected for the operator to choose, avoiding accidental fallback loops back to the node that invoked the route.
- Follow-up relationship guard pass made intent routes agent-scoped in the builder, blocked entry/tool-to-intent connections, blocked intent edges through tool handles, and filtered branch targets to valid post-intent destinations instead of tools or the caller agent.
- ISSUE-122 policy migration now validates condition incoming edges, branch targets, and fallback targets through the shared `decideWorkflowNodeRelationship` policy instead of condition-specific local kind checks.
- Updated builder layout and styling in `apps/web/src/styles.css` so the desktop builder uses a 70:30 canvas-to-inspector split after removing the node library rail.
- Updated companion docs in `docs/Feature-Flows.md`, `docs/Runtime-Manifests.md`, `docs/Frontend-Architecture.md`, `docs/API.md`, `docs/Roadmap.md`, and `docs/Issue-Backlog.md`.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/workflow.test.ts` failed before condition helpers and fallback validation existed.
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/workflowBuilderIds.test.ts`
- GREEN: `npm.cmd run typecheck`
- Browser verification at `http://127.0.0.1:4173/workflows` confirmed the condition inspector, fallback exit path, and 70:30 canvas-to-inspector layout.
- RED/GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "intent route branches"`
- Browser validation: `http://127.0.0.1:4173/workflows` confirmed the intent dropdown updates branch routing without showing the raw expression field.
- RED: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "does not default an intent route fallback"` failed while a route added after a selected tool defaulted fallback back to the calling agent.
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "does not default an intent route fallback"`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false packages/core/src/workflow.test.ts`
- RED: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "only lets agents add intent routes|rejects intent route connections"` failed while invalid intent-route relationships were accepted.
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "only lets agents add intent routes|rejects intent route connections"`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx`

## Pending Work

- Issue scope is complete.
- Follow-on runtime execution work moves to ISSUE-018 so the compiler can consume the same condition-route contract.

## Risks And Edge Cases

- No matching branch
- Ambiguous conditions
- Expression grammar is intentionally narrow in v1. Richer predicates and data typing should be added in a future slice instead of broadening the current parser ad hoc.
- Raw expressions still exist internally for shared validator/runtime compatibility, but the tenant builder now derives them from operator-facing intent selections.
- New routes intentionally leave fallback blank when no exit or other terminal node exists. The validator then asks the operator to choose the no-match path instead of hiding an implicit loop.
- Intent-route relationship protection now consumes the shared ISSUE-122 policy. ISSUE-123 remains for repair UX and broader browser QA.

## Decisions

- Priority: P1
- Labels: runtime, frontend, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Condition routes use explicit branch expressions plus a required fallback target.
- Tenant operators configure condition routes through intent selections; the builder derives the internal `intent == "value"` expression for runtime/validation.
- Exit nodes are part of the same builder contract because safe fallback and safe-cycle validation depend on an explicit terminal path.
- Intent routes must sit after an agent in the workflow and use ordinary flow handles, not tool-call or tool-result handles.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then continue with ISSUE-018 so the runtime manifest compiler consumes the same condition, exit, and fallback model that the builder now publishes.
