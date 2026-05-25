# ISSUE-044: Connector health and revocation

Issue link: https://github.com/tuzzy08/zara/issues/44

## Goal

Deliver Connector health and revocation for the Integrations area in the Integrations milestone.

## Acceptance Criteria

- Connection health is visible
- Revoked connections disable tools
- Reconnect flow preserves audit history

## Work Completed

- Added connector health and revocation API routes:
  - `POST /organizations/:orgId/integrations/connections/:connectionId/health-check`
  - `POST /organizations/:orgId/integrations/connections/:connectionId/revoke`
- Extended OAuth connection responses with health posture, revoked status metadata, reconnect linkage, and lifecycle audit events.
- Added reconnect support through `reconnectConnectionId` on the OAuth connect request; the reconnected connection preserves prior audit events and records reconnect start/completion breadcrumbs.
- Revocation now removes the runtime credential material, marks health as revoked, and keeps the connection visible for audit/history.
- Updated tool permission evaluation so active grants tied to revoked connections are denied with `integration_connection_revoked`.
- Fixed integration state persistence to preserve sibling service slices such as tool grants and webhook tool definitions when OAuth/health/revoke writes occur.
- Updated `docs/API.md` and `docs/Integrations.md`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "connector health"` failed with `404` before health/revoke routes existed.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "connector health"`
- RED: `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts -t "revoked"` returned `tool_permission_denied` before revoked-connection handling existed.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts -t "revoked"`
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.persistence.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/app.module.test.ts`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/api`

## Pending Work

- None for ISSUE-044 acceptance.

## Risks And Edge Cases

- Partial outage: health posture can now be surfaced and audited; future provider-specific checks can distinguish degraded vs unhealthy when real provider APIs are integrated.
- Token refresh failure: revoked/unhealthy states are represented without exposing tokens; automatic refresh remains a future provider-specific connector behavior.

## Decisions

- Priority: P1
- Labels: integrations, security, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Revocation is modeled as durable connection state, not deletion, so audit history remains visible.
- Reconnect creates a new connection linked to the revoked predecessor instead of mutating the old credential reference in place.
- Missing connection records continue to behave as ungranted for compatibility with existing sandbox grant tests; explicit revoked records block execution.

## Next Recommended Step

Run final verification, then move to ISSUE-046 integration sync job framework if all checks pass.
