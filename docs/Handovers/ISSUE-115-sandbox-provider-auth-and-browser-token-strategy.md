# ISSUE-115: Sandbox provider auth and browser token strategy

External: [GitHub #115](https://github.com/tuzzy08/zara/issues/115)

Issue link: https://github.com/tuzzy08/zara/issues/115

## Goal

Secure live sandbox provider access with short-lived browser transport tokens.

## Acceptance Criteria

- Browser sandbox sessions use short-lived transport tokens and never receive long-lived provider secrets
- Session tokens are scoped to tenant, workspace, manifest source, and expiry
- Replay, expiry, and cross-workspace misuse are rejected and audited

## Work Completed

- Added ISSUE-115 to the local backlog, roadmap, and `docs/issues.json`.
- Updated security, architecture, and API docs to require short-lived sandbox transport tokens and server-owned provider credentials.
- Replaced the plain transport token bootstrap with an HMAC-signed token contract in `apps/api/src/sandbox-live-sessions/sandbox-live-sessions.service.ts`.
- Bound websocket authorization to organization, workspace, manifest source, token hash, expiry, and one-time consumption through `authorizeTransportConnection(...)`.
- Added transport security audit capture for accepted, replayed, expired, invalid, source-mismatch, and workspace-mismatch connection attempts.
- Updated `apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket-bridge.ts` so the browser must provide `token`, `workspaceId`, and `source` during websocket bootstrap.
- Updated `apps/web/src/liveSandboxTransport.ts` and `apps/web/src/useLiveSandboxSession.ts` so both tenant sandbox surfaces include the scoped websocket bootstrap contract automatically.
- Confirmed the browser-facing sandbox path still receives only Zara transport tokens and runtime events; Cartesia and AssemblyAI provider keys remain server-owned for cost-optimized, balanced, and premium sessions.
- Kept provider-readiness failures on the live-session API boundary so missing server-side keys block microphone capture before any browser recording state begins.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- RED: `npm.cmd run test:run -- apps/web/src/liveSandboxTransport.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- GREEN: `npm.cmd run test:run -- apps/web/src/liveSandboxTransport.test.ts apps/web/src/app.test.tsx`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/cartesia-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts apps/api/src/sandbox-live-sessions/assemblyai-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/assemblyai-stt.provider.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts`
- GREEN: `npm.cmd run typecheck --workspace @zara/api`
- GREEN: `npm.cmd run build`

## Pending Work

- No remaining ISSUE-115 blockers.

## Risks And Edge Cases

- Transport token expires during bootstrap
- WebSocket token is replayed from another tab or browser
- Session is started with a valid token but mismatched workspace context
- Provider readiness errors are expected to remain actionable setup feedback without exposing provider secret names or values to the browser transport.

## Decisions

- Priority: P0
- Labels: security, backend, runtime, tdd-required
- Provider auth for browser sandbox belongs entirely on the server side.
- Sandbox transport security is a first-class issue, not an implementation detail hidden inside provider adapters.
- Workspace and source scope belong in the websocket handshake itself so copied session URLs cannot quietly drift across builder and published contexts.
- Speech-provider readiness is a server-side admission check; the browser should only learn that provider setup is required and should never receive provider credentials.

## Next Recommended Step

Carry the same audit vocabulary into future monitoring surfaces so platform operators can review blocked sandbox bootstrap attempts alongside call and provider health telemetry.
