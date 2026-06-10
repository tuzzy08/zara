# ISSUE-125: Workflow builder workbench deepening

External: [Linear ZAR-134](https://linear.app/zara-voice/issue/ZAR-134/issue-125-workflow-builder-workbench-deepening)

## Goal

Deepen the workflow builder workbench so selected-node action state, route-target eligibility, relationship decisions, and React Flow handle mapping are owned by a focused module while the visible builder behavior remains unchanged.

## Acceptance Criteria

- Workflow builder selected-node action state is owned by a focused workbench module with a small public interface.
- React Flow handle-role mapping and relationship decisions are kept out of the screen component while preserving existing builder behavior.
- Focused tests cover action availability, route-target eligibility, and canonical handle mapping without rendering the full builder screen.

## Work Completed

- Created ISSUE-125 as the issue-specific handover for this architecture deepening pass.
- Updated the local backlog and roadmap to track the workflow builder workbench issue.
- Added focused workbench coverage in `apps/web/src/workflowBuilderWorkbench.test.ts`.
- Extracted selected-node action resolution, route-target eligibility, canonical relationship decisions, and React Flow handle-role mapping into `apps/web/src/workflowBuilderWorkbench.ts`.
- Rewired `WorkflowBuilderScreen` to consume the extracted workbench state and relationship helpers while preserving existing toolbar, route-target, repair, and handle behavior.
- Kept the existing ISSUE-123 normal-flow handle fix intact while moving the handle IDs behind the workbench module interface.
- Documented the builder workbench module in `docs/Architecture.md`, `docs/Frontend-Architecture.md`, and `docs/Testing-Strategy.md`.

## Tests Run

- RED: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/workflowBuilderWorkbench.test.ts`
  - Failed as expected because `./workflowBuilderWorkbench` did not exist yet.
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/workflowBuilderWorkbench.test.ts`
  - Passed: 1 file, 2 tests.
- Retry after extraction: `npm.cmd run test:run -- apps/web/src/workflowBuilderWorkbench.test.ts apps/web/src/WorkflowBuilder.test.tsx`
  - Passed: 2 files, 17 tests.
- Typecheck: `npm.cmd run typecheck --workspace @zara/web`
  - Passed after tightening the route-target optionality guard in the extracted module.
- Targeted lint: `npx.cmd eslint apps/web/src/WorkflowBuilder.tsx apps/web/src/WorkflowBuilder.test.tsx apps/web/src/workflowBuilderWorkbench.ts apps/web/src/workflowBuilderWorkbench.test.ts`
  - Passed.
- Build: `npm.cmd run build --workspace @zara/web`
  - Passed.
  - Vite reported the existing large client chunk warning after minification.
- Docs follow-up: `git diff --check`
  - Passed with Git's existing Windows line-ending conversion warnings only.

Notes:
- `npm.cmd run test:run -- --pool=forks --fileParallelism=false --testTimeout=30000 apps/web/src/WorkflowBuilder.test.tsx` hit a Vitest fork worker startup timeout before importing tests. The same screen suite passed in the subsequent non-fork run.

## Pending Work

- No required acceptance work remains for ISSUE-125.
- Future workbench passes can extract node creation commands or validation-panel repair orchestration once each has focused RED coverage.

## Risks And Edge Cases

- Empty canvas or stale selected node must still fall back to a usable selected node.
- Selected tool, entry, condition, handoff, escalation, and exit nodes must expose only policy-valid actions.
- Normal flow handles must stay separate from tool call/result handles.
- Existing ISSUE-123 repair behavior and dirty worktree changes must be preserved.

## Decisions

- Start with the workbench relationship adapter because it is pure enough for focused RED/GREEN coverage and currently makes the screen file carry policy knowledge.
- Keep the public visual builder behavior unchanged; this is an architecture deepening pass, not a feature expansion.
- Treat React Flow handle IDs as part of the workbench module interface because they encode the builder's canonical handle-role mapping.
- Keep the workbench module free of React rendering dependencies so action and relationship behavior can be tested without mounting the full screen.

## Next Recommended Step

Pick the next workflow builder boundary only after identifying a behavior that can be covered with a focused failing test, with node creation commands as the likely next candidate.
