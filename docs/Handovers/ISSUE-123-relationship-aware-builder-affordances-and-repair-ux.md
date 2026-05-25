# ISSUE-123: Relationship-aware builder affordances and repair UX

Issue link: TBD

Status: Implemented

## Goal

Make the workflow builder's visible controls obey the canonical node relationship policy so operators can only create, reconnect, and repair relationships that make sense for the voice workflow model.

## Work Completed

- Issue created from the workflow builder relationship-rules follow-up.
- ISSUE-122 now provides the shared canonical relationship policy.
- The builder consumes the policy for toolbar enablement, add-node linking, React Flow connect/reconnect validation, tool companion edges, condition target dropdowns, and workflow graph serialization.
- Added policy-aware toolbar affordances for selected tool, condition, handoff, escalation, exit, and entry states so unavailable node actions are disabled with relationship-specific guidance.
- Guarded add-agent, add-handoff, add-escalation, and add-exit actions through the same policy path used for add-tool and add-intent-route.
- Added relationship repair UX in the validation panel. The repair action removes invalid policy edges, restores missing/incorrect policy handle roles, recreates missing policy companion edges, and repairs stale condition/handoff targets to valid nodes.
- Added styling for the repair action so it sits with validation issues instead of becoming another primary toolbar command.

## Tests Run

- RED: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "exposes only policy-valid"` failed while tool-selected toolbar actions still allowed invalid add actions.
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "exposes only policy-valid"`
- RED: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "repairs stale relationship"` failed before the validation panel exposed a repair action.
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "repairs stale relationship"`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false --testTimeout=30000 apps/web/src/app.test.tsx`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npx.cmd eslint apps/web/src/WorkflowBuilder.tsx apps/web/src/WorkflowBuilder.test.tsx`
- GREEN: `npm.cmd run build`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false --testTimeout=30000`
- Browser validation: `http://127.0.0.1:4173/workflows` loaded with no console or page errors, clear canvas recovered to a usable draft, adding a tool from an agent created both call and success return edges, selecting the tool disabled invalid node actions, deleting a route target exposed `Repair relationships`, and repair rewired the route target to a valid agent with validation returning to ready.

## Pending Work

- None for ISSUE-123.

## Risks And Edge Cases

- Repair chooses the first valid policy target for stale condition/handoff references; operators can still change the repaired target in the inspector after validation is restored.
- The repo-wide `npm.cmd run lint` command hung without diagnostics in this environment, so touched frontend files were linted directly with ESLint.

## Decisions

- This issue is no longer blocked by ISSUE-122.
- The canonical relationship rules live outside React Flow specifics in `@zara/core`.
- UI tests should stay focused on critical paths; the relationship matrix belongs in shared unit tests.
- Repair is intentionally surfaced inside validation issues, not the top toolbar, because it is only relevant when a draft has policy-repairable relationship errors.
- Relationship repair is conservative: it does not invent new entry nodes or broad graph structure, and only repairs invalid edges, missing companion edges, and stale relationship-backed target fields.

## Next Recommended Step

Move to the next pending workflow-builder or runtime issue; ISSUE-123 has no remaining acceptance work.
