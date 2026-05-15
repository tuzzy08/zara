# ISSUE-113: Published manifest live execution on sandbox

Issue link: https://github.com/tuzzy08/zara/issues/113

## Goal

Run published workflows through the same live audio sandbox pipeline on `/sandbox`.

## Acceptance Criteria

- `/sandbox` starts the same live audio pipeline for published workflow versions
- Workspace-safe published workflow selection gates session start
- Cost-optimized, balanced, and premium runtime profiles all start through the live session transport

## Work Completed

- Replaced the standalone `/sandbox` screen's local adapter flow with the shared live sandbox session hook.
- Wired published workflow selection to compile the chosen published manifest and start a live session through `POST /organizations/:orgId/sandbox/live-sessions`.
- Added live transcript rendering, runtime event rendering, streamed audio playback, typed caller turns, and microphone-driven voice turns to the standalone sandbox.
- Updated docs so `/sandbox` is described as the published-manifest live execution surface rather than a local simulation surface.

## Tests Run

- `npm.cmd run test:run -- apps/web/src/app.test.tsx`
- `npm.cmd run test:run -- apps/web/src/liveSandboxAudio.test.ts`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build --workspace @zara/web`

## Pending Work

- No remaining issue-local blockers. Follow ISSUE-114 and ISSUE-115 for deeper live tool execution and provider-session hardening on top of the published sandbox transport.

## Risks And Edge Cases

- Published version is archived after selection but before session start
- Active workspace changes during session bootstrap
- Browser refresh occurs during a live sandbox run

## Decisions

- Priority: P0
- Labels: frontend, runtime, tdd-required
- `/sandbox` and `/workflows` should share the same session engine; they differ only in manifest source.
- Published-mode sandbox remains the place to compare existing releases, but it must use the same live audio transport as draft mode.
- Premium, balanced, and cost-optimized workflows now all enter the browser sandbox through the same live session API contract.

## Next Recommended Step

Move to ISSUE-114 so published sandbox runs can surface richer live tool execution traces alongside transcript and routing events.
