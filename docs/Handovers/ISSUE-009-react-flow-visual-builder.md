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
- Added a post-slice builder polish pass:
  - delete actions now expose an `Undo delete` control only after a node is removed
  - a `Clear canvas` action resets the draft to the entry-point-only state instead of forcing manual deletes
  - the entry node now exposes only its outbound handle
  - the sandbox launch action uses the green success treatment
  - the inspector and sandbox drawer now use fixed panel heights with internal scrolling
- Added response-edge support so tool nodes and intermediary agent nodes can draw return edges back to the calling node. Return edges are styled distinctly on the canvas, serialize through the shared workflow graph contract, and no longer trigger unsafe-cycle validation.
- Fixed the builder interaction gap for response edges: agent and tool cards now expose explicit opposite-side return handles and the canvas runs in loose connection mode, so operators can draw both the forward call edge and the reverse response edge between the same two nodes.
- Removed the raw manifest preview panel from the selected-node inspector; publish and sandbox still derive the preview internally.
- Follow-up builder ergonomics pass renamed the condition tool to `Intent route`, removed the visible `Add` prefix from node-creation tools, moved agent tool-call/result handles to the top of agent cards, moved tool call/result handles underneath tool cards, and constrained tool result edges to return only to the caller node.
- Follow-up tool-add pass now disables the Tool toolbar action unless an agent node is selected, creates both the call edge and the return-success edge when a tool is added from an agent, and leaves intent-route fallback targets blank unless an explicit exit node is available.
- Follow-up intent-route guard pass now disables Intent route unless an agent node is selected, rejects entry/tool-to-intent connections, rejects intent edges through tool handles, and filters condition route targets away from tools and the caller agent.
- ISSUE-122 policy migration replaced builder-local relationship checks with `decideWorkflowNodeRelationship` from `@zara/core`; add-node linking, connect, reconnect, tool companion edges, condition target filtering, and serialized edge handle roles now consume the shared policy.
- ISSUE-123 completed the builder-side relationship affordance and repair pass: selected-node toolbar actions now disable invalid add paths, and validation issues can repair stale policy relationships.

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
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/web`
- Browser interaction polish: deleting the selected condition node exposed `Undo delete`, restoring the node removed that button again, clearing the canvas left the entry point in place, and the entry node reported one source handle and zero target handles.
- RED: `npm.cmd run test:run -- packages/core/src/workflow.test.ts -t "return edges"` failed because return edge semantics were dropped during serialization.
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts -t "return edges"`
- RED: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "opens an inline sandbox drawer" --pool=threads` failed while the manifest preview remained visible in the inspector.
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "opens an inline sandbox drawer" --pool=threads`
- RED: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "allows return edges" --pool=forks` failed because React Flow did not receive loose connection mode and agent/tool nodes did not expose opposite-side return handles.
- GREEN: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "allows return edges" --pool=forks`
- GREEN: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx apps/web/src/app.test.tsx -t "allows return edges|opens an inline sandbox drawer|publishes builder manifests" --pool=forks`
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts packages/core/src/runtime.test.ts`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "opens an inline sandbox drawer|applies the balanced runtime profile" --pool=threads`
- GREEN: `npm.cmd run typecheck`
- Browser validation: `http://127.0.0.1:4173/workflows` created a reverse `success` return edge by dragging from the Zendesk tool return handle back to the Front desk agent return handle.
- RED/GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "places tool-call handles|concise node tools|intent route branches|reusable specialist|returns tool results"`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx apps/web/src/app.test.tsx`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build`
- Browser validation: `http://127.0.0.1:4173/workflows` confirmed concise toolbar labels, intent route branch controls, seeded default specialist templates, two top agent handles, two bottom tool handles, zero side handles on tool nodes, and no relevant console errors.
- RED: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "only lets agents add tools|does not default an intent route fallback"` failed while tools were still addable from non-agent selections and intent-route fallback defaulted back to the caller after a tool selection.
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "only lets agents add tools|does not default an intent route fallback"`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx`
- RED: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "rejects tool call connections"` failed while agent-to-tool flow-handle connections were still accepted.
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "rejects tool call connections"`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx`
- RED: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "only lets agents add intent routes|rejects intent route connections"` failed while Intent route was enabled from non-agent selections and entry-to-intent connections mutated graph state.
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "only lets agents add intent routes|rejects intent route connections"`
- GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx`

## Pending Work

- Core builder-node types are now implemented through ISSUE-017.
- Persist drafts through the backend workflow API when that slice is built.

## Risks And Edge Cases

- React Flow dev runtime consumes the built `@zara/core` package, so shared package builds must stay current until source aliases are introduced.
- Current builder state is in-memory only.
- Tool authorization is represented as validation state until real integration grants are implemented.
- Return edges are currently a shared graph and manifest contract; deeper runtime execution semantics for choosing a return path after tool failure versus success still belong in the live executor.
- Return handles add a second small connection target on both sides of agent/tool cards; future visual polish can make the two handle roles clearer without changing the graph contract.
- Tool result edges are intentionally restricted to the direct caller edge. If a tool result is connected elsewhere, the builder ignores the connection and prompts the operator to return results to the calling agent.
- The Tool toolbar action is now intentionally agent-scoped; selecting entry, tool, handoff, intent-route, escalation, or exit nodes disables tool creation.
- Intent-route fallback is the unmatched-intent path. It should route to an explicit exit, handoff, escalation, or other operator-chosen target rather than silently loop to the node that invoked the route.
- ISSUE-122 and ISSUE-123 centralized the relationship matrix across shared validation, builder affordances, and validation-panel repair UX.

## Decisions

- Used `@xyflow/react` 12.10.2, verified as the latest package version during implementation.
- Kept UI tests light and covered graph behavior in shared core tests.
- Treated ISSUE-009, ISSUE-010, and ISSUE-015 as one end-to-end Basic Workflow Builder feature slice.
- The visualizer remains primary on desktop; the inspector is secondary and should stay around a 75:25 split unless a later design pass intentionally changes it.
- `Clear canvas` intentionally preserves the inbound entry point so operators can restart a draft without getting stranded on a truly empty canvas with no way to add a new entry node.
- Response edges are represented as `WorkflowEdge.kind = "return"` rather than ordinary conditional flow edges so tool/agent callbacks do not weaken unsafe-cycle validation.
- Agent/tool handle placement is domain-specific: agents use top handles for tool calls/results and side handles for normal flow, while tools use only bottom handles for call/result traffic.
- The workflow inspector should show node configuration and validation only; raw manifest internals are reserved for publish/sandbox/compiler paths.
- Intent routes are agent-scoped because caller intent can only be known after an agent has listened/classified the caller turn; they use ordinary flow handles and should not attach through agent/tool call-return handles.

## Next Recommended Step

Start ISSUE-018 as the next slice so the current publishable builder can execute inside the sandbox runtime using the same graph and manifest contracts.
