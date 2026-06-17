# ISSUE-177: Agent-attached route-by-intent policies without visible handoff plumbing

Status: Implemented

External: [Linear ZAR-147](https://linear.app/zara-voice/issue/ZAR-147/issue-177-agent-attached-route-by-intent-policies-without-visible)

## Work Completed

- Created Linear issue ZAR-147 and linked the local backlog entry.
- Added agent-role `routePolicy` workflow config for route-by-intent policies.
- Added draft manifest route policy preservation with source agent metadata.
- Added compiled runtime manifest route policy preservation without requiring visible intent or handoff nodes.
- Added workflow validation for missing route branches, unavailable branch/fallback targets, and direct source-agent self-routing branches.
- Included route policy branch and exit targets in reachability so configured hidden routing targets do not appear unreachable.
- Added deterministic core resolution for agent-attached route policy classifier output.
- Reused existing intent classifier policy guards so model output can only select configured branches or fallback and cannot supply targets.
- Added packet-ready intent facts, configured caller-facing announcement text, and `AgentTransferContext` creation for confident agent targets.
- Added clarify-source-agent fallback behavior for low-confidence classifications with no transfer or announcement.
- Preserved configured route branch order in compiled manifests.
- Wired live sandbox routing to consume compiled agent route policies without visible intent or handoff nodes.
- Added route announcement pre-events so the caller can be informed before transfer.
- Removed Handoff and Intent route creation controls from the tenant workflow builder toolbar and collapsed action menu.
- Removed legacy Handoff and Intent route node rendering, inspectors, validation-detail copy, repair helpers, builder serialization, and related workbench/test support. Loaded legacy nodes are filtered from the tenant builder so old workflows can be recreated afresh.
- Added tenant Agent inspector behavior controls for route-by-intent without adding triage, handoff, or intent-route node types. Route target options are derived from existing workflow agent nodes, branch label/description/examples remain editable, fallback is configurable, and route-capable agents show a compact Routes badge on the canvas.
- Synced Linear ZAR-147 to Done.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/intent-routing.test.ts`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts`
- `npm.cmd run test:run -- packages/core/src/intent-routing.test.ts packages/core/src/workflow.test.ts packages/core/src/runtime.test.ts`
- `npm.cmd run test:run -- packages/core/src/intent-routing.test.ts packages/core/src/workflow.test.ts packages/core/src/runtime.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts`
- `npm.cmd run typecheck:core`
- `npm.cmd run typecheck`
- `npm.cmd run test:run -- apps/web/src/workflowBuilderWorkbench.test.ts`
- Follow-up cleanup verification: `npm.cmd run test:run -- apps/web/src/workflowBuilderWorkbench.test.ts`
- Follow-up cleanup verification: `npm.cmd run typecheck`
- Follow-up routing UX verification: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "configures agent routing" --pool=forks`
- Follow-up routing UX verification: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx --pool=forks`

## Pending Work

- None for the ISSUE-177 acceptance criteria.
- Future UI work can add multi-branch editing polish if product needs more than the current focused single-target route setup in the inspector.

## Risks

- Existing saved workflows that depended on legacy visible Handoff/Intent route nodes need recreation because the tenant builder now filters those node kinds instead of preserving compatibility.
- Runtime callers must pass a packet-scoped `transferId` when creating transfer context to avoid duplicate transfer identifiers across turns.
- Route target UI must continue deriving options from actual workflow nodes. Hard-coded specialist labels would break the manifest/runtime contract.

## Decisions

- Keep route-by-intent attached to the speaking agent for the common operator UX instead of requiring separate visible intent and handoff nodes.
- Remove Handoff and Intent route from the tenant builder surface and compatibility paths; keep Agent, Tool, Escalation, and Exit visible.
- Keep classification runtime-owned and deterministic around configured policy; the active agent does not choose arbitrary targets.
- Keep announcement text configured in route policy so the caller is informed before routing without letting the classifier invent speech.
- Use the same core resolver for sandwich and premium realtime paths.
- Keep a single Agent node type in the tenant builder. Routing is an agent behavior and compact badge, not a separate triage/triangle/intent node.

## Next Recommended Step

Move to the next prioritized issue. Tenant-builder Handoff/Intent route compatibility should stay removed unless a future product slice explicitly reintroduces it.
