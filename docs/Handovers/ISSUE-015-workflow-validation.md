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

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/workflow.test.ts` failed before validation exports existed.
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts`
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts apps/web/src/app.test.tsx --pool=threads`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/web`
- Browser validation: workflow builder showed a publish-blocking `tool.missing_authorization` issue for the Zendesk lookup node.
- Browser validation polish: deleting the condition node now shows a single `Reconnect or remove disconnected nodes` message listing the affected nodes, rather than four repeated unreachable-node warnings.

## Pending Work

- Move validation behind the NestJS workflow validation route when workflow draft persistence exists.
- Add branch-aware validation for condition nodes in ISSUE-013.
- Add manifest-preview validation for runtime, telephony, memory, budget, and integration references in ISSUE-017.

## Risks And Edge Cases

- Unsafe cycle detection currently treats cycles without an edge condition as invalid; branch-aware safe loops should be refined with condition nodes.
- Tool authorization validation uses credential-reference fields until the integration grant model is implemented.

## Decisions

- Validation lives in `@zara/core` first so the frontend and future NestJS controller cannot drift.
- Validation errors use stable code strings so API responses, UI messages, tests, and handovers can reference the same contract.
- The builder can layer small UI-only validation summaries on top of the shared core contract when that improves operator comprehension without changing backend validation semantics.

## Next Recommended Step

Implement ISSUE-013 condition routing before allowing safe loop/branch publishing semantics.
