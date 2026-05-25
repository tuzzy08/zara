# ISSUE-122: Canonical workflow node relationship policy

Issue link: TBD

Status: Implemented

## Goal

Create a shared workflow node relationship policy so builder UI, graph validation, and runtime-facing manifests agree on which node kinds can connect, which handle roles they use, and which edges are flow versus return edges.

## Work Completed

- Added an explicit `workflowNodeRelationshipRules` matrix in `@zara/core`.
- Modeled source node kind, target node kind, edge kind, canonical handle roles, and tool auto-return companion edges.
- Added `decideWorkflowNodeRelationship` so callers receive an allowed/disallowed decision with stable reason codes, messages, suggestions, edge kind, handle roles, and companion edge metadata.
- Modeled these relationships:
  - entry to first agent only
  - agent to agent flow
  - delegated agent return to caller when a prior forward path exists
  - agent tool call through tool-call handles
  - tool result return to the direct calling agent through result handles
  - agent to intent route through normal flow handles
  - intent route to agent, handoff, escalation, or exit through normal flow handles
  - intent route cannot target the agent that produced the intent
  - agent to handoff, escalation, and exit
  - handoff to agent
- Extended workflow edges with optional canonical source/target handle roles.
- Wired `validateWorkflowGraph` to reject invalid relationships with stable relationship error codes.
- Wired condition branch and fallback validation to the same policy.
- Migrated the workflow builder from local relationship guards to the shared policy for toolbar enablement, add-node linking, connect, reconnect, tool companion edges, condition target options, and workflow graph serialization.
- Updated live sandbox websocket test fixtures to use canonical tool call/result handle roles.

## Tests Run

- RED: `npm.cmd run test:run -- --pool=forks --fileParallelism=false packages/core/src/workflow.test.ts -t "models canonical node relationships"` failed before the relationship matrix existed.
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false packages/core/src/workflow.test.ts -t "models canonical node relationships"`
- RED: `npm.cmd run test:run -- --pool=forks --fileParallelism=false packages/core/src/workflow.test.ts -t "decides relationships"` failed before the decision API existed.
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false packages/core/src/workflow.test.ts -t "decides relationships"`
- RED: `npm.cmd run test:run -- --pool=forks --fileParallelism=false packages/core/src/workflow.test.ts -t "validates graph edges against"` failed before validation consumed the policy.
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false packages/core/src/workflow.test.ts -t "validates graph edges against"`
- RED: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "rejects tool call connections"` failed before builder connections consumed canonical tool handle rules.
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "rejects tool call connections"`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false packages/core/src/workflow.test.ts`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/app.test.tsx`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "executes live tool nodes|blocks live integration tool execution|requires human approval"`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false --testTimeout=30000`
- Browser validation: entry/tool selection disables intent route creation, agent selection enables it, tool call creation auto-creates the return edge to the caller, intent route creation links from the agent through a normal flow edge, no tool-to-intent edge is created, and there were no console errors.

## Pending Work

- None for ISSUE-122.
- ISSUE-123 is now implemented, so the relationship-rules slice has both the canonical policy and builder repair UX in place.

## Risks And Edge Cases

- Existing drafts with invalid relationships now fail validation with stable policy errors and can be repaired from the builder validation panel through ISSUE-123.
- Return edges for tools and delegated agents are distinct from ordinary forward flow through explicit `return` edge kind and canonical handle roles.
- Condition route edge labels and fallback edges stay synchronized with condition node config; invalid existing condition targets can now be repaired by ISSUE-123's validation-panel action.

## Decisions

- The canonical policy lives in `@zara/core`; React Flow only maps visual handle IDs to policy handle roles.
- Missing handle roles on older graph edges are tolerated by validation, but builder-created edges now serialize canonical handle roles.
- Tool calls auto-create the tool result return companion edge from the policy metadata.
- Intent routes use condition nodes in the current domain model.

## Next Recommended Step

Move to the next pending workflow-builder or runtime issue; ISSUE-122 and ISSUE-123 now close the relationship-rules slice.
