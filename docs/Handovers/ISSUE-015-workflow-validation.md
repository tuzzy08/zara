# ISSUE-015: Workflow validation

Issue link: https://github.com/tuzzy08/zara/issues/15

## Goal

Deliver shared workflow validation with actionable errors that can block publish.

## Work Completed

- Added `validateWorkflowGraph` and validation result/error types in `packages/core/src/workflow.ts`.
- Validation catches missing entry nodes, duplicate node IDs, missing edge endpoints, unreachable nodes, unsafe cycles without exit conditions, missing agent role fields, duplicate agent role names, unsupported language codes, and tool nodes missing authorization.
- Added stable validation codes and actionable suggestions for UI/API display.
- Wired validation into the tenant workflow builder so the Publish button is disabled while errors exist and the inspector shows the active issues.
- Documented the validation contract in `docs/API.md`.
- Added contract-style tests in `packages/core/src/workflow.test.ts` for missing entry, unreachable nodes, unsafe cycles, missing tool auth, and invalid agent roles.
- Added a UX pass over builder-side validation messaging:
  - grouped repeated unreachable-node errors into one issue with affected node labels
  - added friendlier builder copy for agent, tool, condition, escalation, and edge failures
  - added a draft-only validation issue when the entry node is no longer connected to a first agent
- Added targeted builder connection guards for intent-route semantics:
  - intent routes can only be created from agent nodes
  - intent route inputs reject entry/tool sources and tool handles
  - intent route outputs only target post-intent workflow nodes
  - tool return edges remain scoped to the calling agent
- Replaced the targeted relationship validation follow-up with the shared ISSUE-122 policy:
  - `validateWorkflowGraph` now rejects invalid node relationships with stable `relationship.*` codes
  - condition branch and fallback targets validate against the same policy
  - workflow edges can carry canonical source/target handle roles
- ISSUE-123 added builder repair UX for stale relationship validation errors, including invalid edges, missing policy companion edges, and stale condition/handoff target references.
- Follow-up pass on 2026-05-25 made validation status more ubiquitous by adding a toolbar status chip that shows whether the current draft is ready or has active issues, even when the inspector is not focused.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/workflow.test.ts` failed before validation exports existed.
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts`
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts apps/web/src/app.test.tsx --pool=threads`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/web`
- RED: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "only lets agents add intent routes|rejects intent route connections"` failed before the intent-route relationship guards existed.
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "only lets agents add intent routes|rejects intent route connections"`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false --testTimeout=30000`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false packages/core/src/workflow.test.ts`
- Browser validation: workflow builder showed a publish-blocking `tool.missing_authorization` issue for the Zendesk lookup node.
- Browser validation polish: deleting the condition node now shows a single `Reconnect or remove disconnected nodes` message listing the affected nodes, rather than four repeated unreachable-node warnings.
- Browser validation: agent-selected intent route creation was enabled, entry/tool-selected intent route creation was disabled, the tool auto-return edge stayed connected to the caller, and no tool-to-intent edge was created.
- RED: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "validation status" --pool=threads` failed before the builder exposed validation state outside the inspector.
- GREEN: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "validation status" --pool=threads`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/WorkflowBuilder.test.tsx apps/web/src/liveSandboxAudio.test.ts apps/web/src/liveSandboxEventFormatting.test.ts --pool=threads`
- GREEN: `npm.cmd run typecheck --workspace @zara/web`

## Pending Work

- Move validation behind the NestJS workflow validation route when workflow draft persistence exists.
- Add manifest-preview validation for runtime, telephony, memory, budget, and integration references in ISSUE-017.

## Risks And Edge Cases

- Unsafe cycle detection currently treats cycles without an edge condition as invalid; branch-aware safe loops should be refined with condition nodes.
- Tool authorization validation uses credential-reference fields until the integration grant model is implemented.

## Decisions

- Validation lives in `@zara/core` first so the frontend and future NestJS controller cannot drift.
- Validation errors use stable code strings so API responses, UI messages, tests, and handovers can reference the same contract.
- The builder can layer small UI-only validation summaries on top of the shared core contract when that improves operator comprehension without changing backend validation semantics.
- ISSUE-122 replaced scattered relationship checks with a canonical policy in `@zara/core`.
- Validation state should appear in both focused inspector detail and broader workflow chrome so operators do not have to hunt for publish blockers.

## Next Recommended Step

Move to the next pending validation or runtime issue; ISSUE-123 has closed the stale relationship repair UX follow-up.
