# ISSUE-112: Draft manifest live execution on workflows

Issue link: https://github.com/tuzzy08/zara/issues/112

## Goal

Run the current unpublished workflow draft as a live audio sandbox session directly from `/workflows`.

## Acceptance Criteria

- `/workflows` can compile the current validated draft into an ephemeral manifest without publishing
- Voice mode requests microphone access and starts a live sandbox run in the builder drawer
- Runtime events, transcript, and node-by-node progress reflect the real live execution path

## Work Completed

- Added ISSUE-112 to the local backlog, roadmap, and `docs/issues.json`.
- Updated product and frontend docs to define `/workflows` draft sandbox as a live execution surface rather than a local replay surface.

## Tests Run

- Documentation pass only for this issue seed.

## Pending Work

- Replace the draft drawer's local transcript replay with a live transport-backed session.
- Freeze the validated draft manifest for the lifetime of a sandbox run.
- Add smoke coverage for microphone grant/deny and inline event rendering.

## Risks And Edge Cases

- Graph changes while a draft sandbox run is active
- Draft becomes invalid before transport bootstrap completes
- Microphone permission is denied

## Decisions

- Priority: P0
- Labels: frontend, runtime, tdd-required
- Draft-mode sandbox should execute the real workflow path before publish rather than simulating it.
- The drawer remains the right surface for this flow; the change is in transport and execution fidelity, not navigation.

## Next Recommended Step

After transport and providers exist, wire the builder drawer to start and render a live draft session from an ephemeral manifest.
