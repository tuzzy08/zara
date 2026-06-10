# ISSUE-039: Zendesk connector

External: [GitHub #39](https://github.com/tuzzy08/zara/issues/39)

Issue link: https://github.com/tuzzy08/zara/issues/39

## Goal

Deliver Zendesk connector for the Integrations area in the Integrations milestone.

## Acceptance Criteria

- Connector can search/create/update tickets
- Tool schemas are typed
- Rate limits are handled

## Work Completed

- Added OAuth connector tool schema and execution routes through the integrations controller:
  - `GET /organizations/:orgId/integrations/connectors/:provider/tools`
  - `POST /organizations/:orgId/integrations/connectors/:provider/tools/:toolId/execute`
- Added `ConnectorToolsService` with tenant-scoped connection lookup, encrypted OAuth credential opening, connection revocation checks, and required-scope enforcement.
- Added typed Zendesk tool schemas for:
  - `zendesk.tickets.search`
  - `zendesk.tickets.create`
  - `zendesk.tickets.update`
- Added deterministic local Zendesk execution behavior for ticket search/create/update without calling external APIs.
- Added structured Zendesk rate-limit handling that returns HTTP 429 with `retryAfterSeconds` and never exposes OAuth tokens.
- Follow-up on 2026-06-04: added secure Zendesk API-token profile configuration with tenant-supplied subdomain, email, and API token only; provider API URLs remain Zara-owned connector metadata.
- Follow-up on 2026-06-04: moved API-token-backed `zendesk.tickets.create` to Zendesk's documented Tickets API shape: `POST https://{subdomain}.zendesk.com/api/v2/tickets` with a top-level `ticket` object containing `subject`, `requester.email`, `comment.body`, and `priority`.
- Follow-up on 2026-06-04: API-token Zendesk connections now report healthy credentials in connection health checks without exposing token material.
- Follow-up on 2026-06-04: fixed Zendesk credential saves when `ZARA_INTEGRATION_STATE_DIR` is present but blank by falling back to the default `.zara/integrations` store.
- Updated `docs/API.md` and `docs/Integrations.md`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "Zendesk ticket tools"` failed with `404` before connector tool routes existed.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "Zendesk ticket tools"`
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts apps/api/src/integrations/integrations.persistence.test.ts apps/api/src/integrations/tool-permission-grants.service.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/api`
- RED: `npm.cmd exec -- vitest run apps/api/src/integrations/integrations.controller.test.ts -t "configure Zendesk API token" --pool=forks --maxWorkers=1 --reporter=dot` failed with `404` before the secure configure route existed.
- GREEN: `npm.cmd exec -- vitest run apps/api/src/integrations/integrations.controller.test.ts -t "configure Zendesk API token" --pool=forks --maxWorkers=1 --reporter=dot`
- RED: `npm.cmd exec -- vitest run apps/api/src/integrations/integrations.controller.test.ts -t "documented Tickets API" --pool=forks --maxWorkers=1 --reporter=dot` failed while the executor still required OAuth access-token credentials.
- GREEN: `npm.cmd exec -- vitest run apps/api/src/integrations/integrations.controller.test.ts -t "documented Tickets API" --pool=forks --maxWorkers=1 --reporter=dot`
- RED: `npm.cmd exec -- vitest run apps/api/src/integrations/integrations.controller.test.ts -t "configure Zendesk API token" --pool=forks --maxWorkers=1 --reporter=dot` failed while API-token health checks reported missing credentials.
- GREEN: `npm.cmd exec -- vitest run apps/api/src/integrations/integrations.controller.test.ts -t "configure Zendesk API token" --pool=forks --maxWorkers=1 --reporter=dot`
- GREEN: `npm.cmd exec -- vitest run apps/api/src/integrations/integrations.controller.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- GREEN: `npm.cmd exec -- vitest run apps/api/src/integrations/integrations.persistence.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- GREEN: `npm.cmd run typecheck --workspace @zara/api`
- RED: `npm.cmd exec -- vitest run apps/api/src/integrations/integrations.controller.test.ts -t "blank" --pool=forks --maxWorkers=1 --reporter=dot` failed with `mkdir ''` and HTTP 500 when saving Zendesk credentials.
- GREEN: `npm.cmd exec -- vitest run apps/api/src/integrations/integrations.controller.test.ts -t "blank" --pool=forks --maxWorkers=1 --reporter=dot`
- GREEN: `npm.cmd exec -- vitest run apps/api/src/persistence/tenant-json-state.repository.test.ts apps/api/src/integrations/integrations.persistence.test.ts apps/api/src/integrations/integrations.controller.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- GREEN: `npm.cmd run typecheck --workspace @zara/api`
- GREEN: `git diff --check`
- GREEN: `npx.cmd eslint apps/api/src/integrations/integrations.module.ts apps/api/src/integrations/integrations.controller.test.ts`

## Pending Work

- None for ISSUE-039 acceptance.

## Risks And Edge Cases

- Expired token
- Ticket field validation
- Real Zendesk API pagination, search/update provider calls, optional custom fields, tags, collaborators, uploads, and token rotation remain provider-client expansion work.
- Blank integration state directory environment values are treated as unset so credential saves use the default local state path instead of calling `mkdir("")`.

## Decisions

- Priority: P1
- Labels: integrations, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Connector execution requires the matching tenant connection and required scopes.
- Rate limits are represented as structured retryable HTTP 429 responses.
- Built-in connector API hosts and paths are not tenant-configurable. Zendesk derives `https://{subdomain}.zendesk.com` from the tenant's validated subdomain and owns the `/api/v2/tickets` path inside connector code.
- Zara uses Zendesk's Tickets API for workflow agent/admin tools because those tools execute with tenant-owned agent/admin credentials. A future unauthenticated or end-user self-service submission flow should be modeled as a separate Requests API tool.

## Next Recommended Step

Extend Zendesk search/update to real provider calls and add provider-profile configuration screens for the next non-OAuth connectors as they move from deterministic local behavior to live API execution.
