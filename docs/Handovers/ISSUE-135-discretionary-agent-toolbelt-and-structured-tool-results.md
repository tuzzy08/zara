# ISSUE-135: Discretionary agent toolbelt and structured tool results

Status: Implemented
Date: 2026-05-27
External: [Linear ZAR-68](https://linear.app/zara-voice/issue/ZAR-68/issue-135-discretionary-agent-toolbelt-and-structured-tool-results)

## Work Completed

- Created the implementation issue in `docs/Issue-Backlog.md`.
- Added tool-capability and structured result standards in `docs/Agent-Tool-And-Transfer-Standard.md`.
- Linked the target tool model from architecture, manifest, feature-flow, roadmap, and testing docs.
- Moved Linear `ZAR-68` and local `ISSUE-135` records to `In Progress` before implementation.
- Compiled tool nodes into required `agentToolAssignments` and kept those assignments out of mandatory graph traversal.
- Removed the legacy router/service `toolInvocations` path so assigned tools are not executed automatically.
- Added agent action parsing for `respond` and `call_tool`, plus prompt context that exposes only the safe packet projection.
- Added live sandbox execution for agent-requested tools with assignment checks, required-input checks, grants, approval gates, idempotency keys, structured packet results, and safe output projection back to the same agent.
- Follow-up on 2026-07-01: refactored the workflow inspector Toolbelt card to select Integration before Tools, show provider labels such as Zendesk/HubSpot instead of account/domain strings, load tools from the selected provider connection, and support checkbox multi-select assignment to the selected agent.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/runtime.test.ts --testNamePattern "compiles a deterministic manifest"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts --testNamePattern "assigned tools"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts packages/core/src/runtime.test.ts --testNamePattern "compiles a deterministic manifest|assigned tools|walks condition"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts --testNamePattern "does not execute assigned live tools|executes one agent-requested tool|missing required input|approval-required results|does not check grants|does not request human approval"`
- `npm.cmd run test:run -- packages/core/src/agent-action.test.ts packages/core/src/turn-runtime-packet.test.ts packages/core/src/runtime.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts apps/api/src/sandbox-live-sessions/sandbox-text-model-prompts.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- `npm.cmd run typecheck`
- RED on 2026-07-01: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "multi-assign tools" --pool=forks` failed while the inspector still had tool-first selection and no Integration control.
- GREEN on 2026-07-01: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "multi-assign tools" --pool=forks`
- Regression verification on 2026-07-01: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/WorkflowBuilder.test.tsx apps/web/src/workflowBuilderToolCatalog.test.ts --pool=forks`
- Reusable-agent guard on 2026-07-01: `npm.cmd run test:run -- apps/web/src/TenantAgentsScreen.test.tsx -t "assign a connected catalog tool" --pool=forks`
- Typecheck verification on 2026-07-01: `npm.cmd run typecheck --workspace @zara/web`

## Pending Work

- None for ISSUE-135 acceptance.
- ISSUE-137 should deepen policy hardening for full JSON-schema validation, timeout/rate-limit reporting, and broader invalid model-command coverage.

## Risks

- Existing builder mental models may still need UI copy updates to emphasize tools as agent capabilities.
- Full JSON-schema validation is intentionally deferred to policy hardening; this pass enforces required inputs and assignment boundaries.
- Multiple tools selected from the same integration are saved as separate agent assignments. Cross-provider assignment still requires choosing the other integration and adding those tools separately.

## Decisions

- Tools are agent capabilities used at the agent's discretion.
- Assigned tools may be unused for an entire call.
- Tool results return to the same agent as structured context.
- Tool events are emitted from packet facts; full raw output stays off the model-facing projection.
- Toolbelt UI labels integration choices by provider name, not credential/account preview, so users choose Zendesk/HubSpot first and then choose tools.

## Next Recommended Step

- Move to ISSUE-136 / Linear ZAR-69 for structured transfer context.
