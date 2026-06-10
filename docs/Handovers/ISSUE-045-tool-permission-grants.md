# ISSUE-045: Tool permission grants

External: [GitHub #45](https://github.com/tuzzy08/zara/issues/45)

Issue link: https://github.com/tuzzy08/zara/issues/45

## Goal

Deliver Tool permission grants for the Integrations area in the Integrations milestone.

## Acceptance Criteria

- Tools require explicit grants by role/workflow
- High-risk tools can require approval
- Unauthorized calls are blocked

## Work Completed

- Added tool grant request/response models to the integrations API.
- Added `POST /organizations/:orgId/integrations/tool-grants` for tenant admins/owners to grant tool execution to a workspace, published workflow, integration connection, and optional role.
- Added `GET /organizations/:orgId/integrations/tool-grants` with workspace/workflow filtering for masked grant listing.
- Persisted tool grants in the existing integration state repository without exposing OAuth tokens or decrypted credential material.
- Added `ToolPermissionGrantsService` and exported it through `IntegrationsModule`.
- Imported `IntegrationsModule` into `SandboxLiveSessionsModule` so live runtime execution can evaluate grants.
- Changed live sandbox tool execution to deny integration-bound tools by default when no matching workflow/role grant exists.
- Added high-risk approval behavior: approval-required grants emit `tool.approval_required` and do not execute the tool registry.
- Kept non-integration tools allowed without an integration grant.
- Updated API and integrations docs with the new grant routes and runtime behavior.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "blocks live integration tool execution"`
  - Failed because ungranted connected tools still executed instead of emitting `tool.failed`.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "blocks live integration tool execution"`
  - Runtime now blocks ungranted integration tools with `tool_permission_denied`.
- RED: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "grant integration tools"`
  - Failed because the tool grant API route did not exist.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "grant integration tools"`
  - Tenant admin grant creation and filtered listing passed.
- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "executes live tool nodes"`
  - Failed because successful tool execution now requires an explicit grant.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "executes live tool nodes"`
  - Granted workflow/role tool execution passed through the live runtime.
- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "requires human approval"`
  - Failed because approval-required grants still executed the tool registry.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "requires human approval"`
  - Runtime now emits `tool.approval_required` and pauses execution.
- Verification: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts`
- Verification: `npm.cmd run test:run -- apps/api/src/integrations/integrations.persistence.test.ts`
- Verification: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- Verification: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts`
- Verification: `npm.cmd run test:run -- apps/api/src/app.module.test.ts`
- Verification: `npm.cmd run typecheck`
- Verification: `npm.cmd run lint`
- Verification: `npm.cmd run build --workspace @zara/api`

## Pending Work

- Add grant revocation/history in ISSUE-044 connector health and revocation, or as a follow-up if needed before broad tenant UI exposure.
- Connect a UI management surface for grants in a later tenant integrations/settings slice.
- Implement the human approval workflow itself in later escalation/approval work; this issue emits the approval-required runtime event and blocks execution.

## Risks And Edge Cases

- Role removed
- Grant changed during call
- Grants currently match the role ID supplied at session start. If active runtime role changes after handoff, role-specific grant evaluation may need to follow the active role transition state.
- Grant revocation is not yet exposed; runtime evaluates the latest persisted grants at execution time once revocation exists.

## Decisions

- Priority: P0
- Labels: integrations, security, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Grants are scoped to published workflow version IDs because live manifests are immutable and active calls pin to a version.
- Role-specific grants are optional; a workflow-level grant can allow a tool across roles in that workflow.
- Integration-bound tools are deny-by-default even when the manifest has a connected `integrationConnectionId`.
- Approval-required grants stop before connector execution and emit `tool.approval_required` rather than `tool.completed`.

## Next Recommended Step

Move to ISSUE-043 Webhook HTTP tool connector so the first tenant-defined tool can execute through the new OAuth/secret/grant safety spine.
