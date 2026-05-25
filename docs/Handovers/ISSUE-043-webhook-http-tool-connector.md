# ISSUE-043: Webhook HTTP tool connector

Issue link: https://github.com/tuzzy08/zara/issues/43

## Goal

Deliver Webhook HTTP tool connector for the Integrations area in the Integrations milestone.

## Acceptance Criteria

- Tenant can define HTTP tool schema
- Secrets are injected securely
- Timeout and retry policy are enforced

## Work Completed

- Added webhook HTTP tool definition API:
  - `POST /organizations/:orgId/integrations/webhook-tools`
  - `GET /organizations/:orgId/integrations/webhook-tools`
- Added `WebhookHttpToolsService` with tenant-admin gating, HTTPS URL validation, bounded timeout/retry policy validation, masked public schemas, and encrypted bearer-token storage.
- Extended integration persistence with webhook tool schemas plus encrypted webhook secret envelopes.
- Wired the live sandbox default tool registry to resolve `secret://webhook-http-tools/:toolId/auth-token` inside the runtime before outbound execution.
- Added runtime retry for transient 5xx/network failures and timeout enforcement with clear timeout errors.
- Updated `docs/API.md` and `docs/Integrations.md` with the new contract.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "webhook HTTP tools"` failed with `404` before the route/service existed.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "webhook HTTP tools"`
- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts -t "secret references"` failed because secret references were rejected as unresolved.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts -t "secret references"`
- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts -t "retries transient"` failed on first `503`.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts -t "retries transient"`
- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts -t "timeout policy"` failed with a generic abort error instead of a timeout error.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts -t "timeout policy"`
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.persistence.test.ts -t "webhook HTTP tool schemas"`
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.persistence.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/app.module.test.ts`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/api`

## Pending Work

- None for ISSUE-043 acceptance.

## Risks And Edge Cases

- Slow endpoint: covered by stored timeout policy and runtime abort handling.
- Transient provider failure: covered by stored retry policy for network/5xx responses.
- Prompt injection in response: current live sandbox telemetry publishes the safe execution summary and duration, not the raw webhook response body, so malicious response text is not surfaced into the event timeline or model response path by this connector slice.

## Decisions

- Priority: P1
- Labels: integrations, security, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Webhook tool definitions require HTTPS URLs.
- Retry policy is bounded to 1-5 attempts and 0-10000ms backoff; timeout is bounded to 100-30000ms.
- Runtime injects bearer auth only if the webhook request has no explicit `authorization` header.

## Next Recommended Step

Run final verification, then move to ISSUE-044 connector health and revocation if all checks pass.
