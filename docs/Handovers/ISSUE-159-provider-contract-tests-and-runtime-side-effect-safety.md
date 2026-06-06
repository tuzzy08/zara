# ISSUE-159: Provider contract tests and runtime side-effect safety

Status: Implemented
External: [Linear ZAR-113](https://linear.app/zara-voice/issue/ZAR-113/issue-159-provider-contract-tests-and-runtime-side-effect-safety)

## Goal

Add provider contract tests, structured runtime failure outcomes, and write side-effect safety before expanding providers.

## Work Completed

- Created the Linear issue and local backlog entry, then moved ZAR-113 and the local issue from Pending to In Progress for the implementation pass.
- Added a mocked provider contract harness for all current built-in connector tools: Zendesk ticket search/create/update, HubSpot contact lookup/note create/deal stage update, Google Calendar availability/event create, and Notion search/page create/task create.
- Replaced synthetic execution for those provider-backed tools with server-owned documented endpoint calls, provider auth headers, input validation, normalized Zara outputs, rate-limit mapping, tenant isolation, and secret redaction.
- Kept built-in API URLs, paths, auth construction, and provider payload shapes inside the connector executor; tenant input cannot override those endpoints.
- Added connection-health degradation for provider execution failures through `IntegrationsService` so persisted state and the in-memory connection list stay synchronized.
- Added runtime tool failure classification for auth revoked, permission denied, not found, rate limited, provider unavailable, timeout, validation error, generic failure, and post-send side-effect unknown outcomes.
- Added side-effect ledger events for write-like live sandbox tools with deterministic idempotency keys, pending/succeeded/failed/unknown statuses, retry posture, provider, connection, tool, and safe error metadata.
- Added post-call CRM sync retry blocking when a matching live-call side effect is unknown or already succeeded, preventing blind duplicate writes.
- Included failed and approval-required tool outcomes in post-call summaries with redaction so operators can see safe failure context.
- Confirmed existing registry metadata carries documentation references and docs-verified dates for implemented tools.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts --pool=threads` failed before the classifier module existed.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts --pool=threads` passed after adding classifier coverage.
- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "post-send side-effect timeouts" --pool=threads` failed before side-effect ledger events existed.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "post-send side-effect timeouts" --pool=threads` passed after ledger recording and unknown-outcome classification.
- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts -t "side-effect ledger has an unknown write" --pool=threads` failed with a retry allowed before the post-call sync guard.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts -t "side-effect ledger has an unknown write|failed-tool outcomes" --pool=threads` passed after the retry guard and summary projection.
- RED/GREEN: focused connector contract tests failed first for each provider-backed path that still used synthetic execution, then passed after adding documented provider request handling.
- `npm.cmd run test:run -- apps/api/src/integrations/connector-tools.contract.test.ts apps/api/src/integrations/integrations.controller.test.ts` passed with 29 tests.
- `npm.cmd run test:run -- apps/api/src/integrations/connector-tools.contract.test.ts apps/api/src/integrations/integrations.controller.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts` passed with 79 tests.
- `npm.cmd run typecheck --workspace @zara/api` passed.

## Pending Work

- None for ISSUE-159 acceptance criteria.

## Risks And Edge Cases

- Optional live provider smoke tests remain credential-gated and should not block ordinary CI.
- Future provider-specific idempotency headers can be added where a provider offers a documented idempotency key contract; the current ledger keeps Zara retry behavior safe even when the provider does not.
- Notion task creation uses the connected account/default parent reference in v1; later setup UX can add explicit Notion destination selection without reopening this safety baseline.

## Decisions

- Ordinary CI uses mocked provider contracts, not live third-party calls.
- Built-in provider tools expose curated Zara business actions, not raw provider operations.
- Provider APIs, paths, auth headers, payload shape, and default connector metadata remain server-owned.
- Post-send write timeouts are treated as unknown outcomes and require manual review instead of automatic retry.

## Next Recommended Step

Start ISSUE-160 knowledge-base add/import snapshot workflow.
