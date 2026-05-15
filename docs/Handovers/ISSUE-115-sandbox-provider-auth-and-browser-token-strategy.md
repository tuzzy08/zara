# ISSUE-115: Sandbox provider auth and browser token strategy

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

## Tests Run

- Documentation pass only for this issue seed.

## Pending Work

- Add token minting, validation, expiry, replay protection, and audit writes for sandbox transport sessions.
- Decide the exact token format and signing strategy for live browser sandbox transport.
- Add RED/GREEN coverage for replay, expiry, and cross-workspace misuse.

## Risks And Edge Cases

- Transport token expires during bootstrap
- WebSocket token is replayed from another tab or browser
- Session is started with a valid token but mismatched workspace context

## Decisions

- Priority: P0
- Labels: security, backend, runtime, tdd-required
- Provider auth for browser sandbox belongs entirely on the server side.
- Sandbox transport security is a first-class issue, not an implementation detail hidden inside provider adapters.

## Next Recommended Step

Define the session token contract alongside ISSUE-109 transport creation so provider-backed sandbox execution starts with the right security boundary.
