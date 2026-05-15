# ISSUE-112: Draft manifest live execution on workflows

Issue link: https://github.com/tuzzy08/zara/issues/112

## Goal

Run the current unpublished workflow draft as a live audio sandbox session directly from `/workflows`.

## Acceptance Criteria

- `/workflows` can compile the current validated draft into an ephemeral manifest without publishing
- Voice mode requests microphone access and starts a live sandbox run in the builder drawer
- Runtime events, transcript, and node-by-node progress reflect the real live execution path

## Work Completed

- Compiled validated draft graphs into ephemeral runtime manifests through `apps/web/src/sandboxRuntimeManifest.ts`.
- Replaced the builder drawer's local replay session with the shared live sandbox session hook in `apps/web/src/useLiveSandboxSession.ts`.
- Wired `/workflows` draft mode to create live sandbox sessions, open the websocket transport, render transcript plus runtime events, and request microphone access for voice mode.
- Routed-number mode now verifies telephony posture first, then starts the same live sandbox session against the published manifest for the selected routed number.
- Updated product and frontend docs so the builder drawer is documented as a live execution surface.

## Tests Run

- `npm.cmd run test:run -- apps/web/src/app.test.tsx`
- `npm.cmd run test:run -- apps/web/src/liveSandboxAudio.test.ts`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build --workspace @zara/web`

## Pending Work

- No remaining issue-local blockers. Follow ISSUE-114 and ISSUE-115 for deeper live tool execution and provider-session hardening on top of the new builder transport.

## Risks And Edge Cases

- Graph changes while a draft sandbox run is active
- Draft becomes invalid before transport bootstrap completes
- Microphone permission is denied

## Decisions

- Priority: P0
- Labels: frontend, runtime, tdd-required
- Draft-mode sandbox should execute the real workflow path before publish rather than simulating it.
- The drawer remains the right surface for this flow; the change is in transport and execution fidelity, not navigation.
- `/workflows` and `/sandbox` share one browser hook for session lifecycle, transport, transcript, events, microphone capture, and audio playback.

## Next Recommended Step

Move to ISSUE-114 so tool nodes emit richer execution events through the live sandbox timeline.
