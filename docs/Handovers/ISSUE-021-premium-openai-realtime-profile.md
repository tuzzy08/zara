# ISSUE-021: Premium OpenAI Realtime profile

Issue link: https://github.com/tuzzy08/zara/issues/21

## Goal

Deliver Premium OpenAI Realtime profile for the Runtime area in the Sandbox milestone.

## Acceptance Criteria

- Premium profile is opt-in by policy
- Session creation is server-side
- Tool and handoff events are observed

## Work Completed

- Added premium realtime profile policy resolution in `@zara/core`.
- Implemented premium realtime session creation with budget gating and observed tool/handoff event contracts.
- Added NestJS runtime session module, controller, and service for `POST /runtime/realtime/sessions`.
- Surfaced premium realtime in the workflow builder and published sandbox UI, including the server-session requirement banner.
- Wired the published tenant sandbox to request a realtime session from Nest before premium typed or microphone runs begin.
- Added inline premium session state in the sandbox UI for transport URL, expiry, pending state, and control-plane failure messages.
- Moved the local API fallback away from port `3000` to Zara's `4010` default so premium sandbox bootstrap does not accidentally hit unrelated local apps.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/runtime-profiles.test.ts`
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/runtime-sessions.controller.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=threads`
- `npm.cmd run typecheck`

## Pending Work

- Replace the current in-browser turn simulation with a full server-backed premium media path once the realtime plane is connected.
- Add explicit outage-path tests for upstream realtime unavailability once the availability source is modeled instead of passed as a request flag.

## Risks And Edge Cases

- Realtime unavailable
- Budget disallows premium

## Decisions

- Priority: P1
- Labels: runtime, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Premium realtime remains opt-in through workflow or role policy; non-premium roles receive a conflict instead of silently upgrading.
- Server-side session creation is intentionally narrow right now: it accepts a compiled manifest contract and returns a transport/session summary.
- Published sandbox runs must ask the control plane for a premium session before any premium browser run starts; they do not silently skip the server bootstrap.

## Next Recommended Step

Replace the local premium turn simulation with a true server-backed transport path once the realtime plane is ready to consume the returned session contract.
