# ISSUE-113: Published manifest live execution on sandbox

Issue link: https://github.com/tuzzy08/zara/issues/113

## Goal

Run published workflows through the same live audio sandbox pipeline on `/sandbox`.

## Acceptance Criteria

- `/sandbox` starts the same live audio pipeline for published workflow versions
- Workspace-safe published workflow selection gates session start
- Cost-optimized, balanced, and premium runtime profiles all start through the live session transport

## Work Completed

- Added ISSUE-113 to the local backlog, roadmap, and `docs/issues.json`.
- Updated product and API docs to define `/sandbox` as the published-manifest live execution surface once the transport layer lands.

## Tests Run

- Documentation pass only for this issue seed.

## Pending Work

- Replace the current local runtime adapter in `/sandbox` with live transport-backed execution.
- Reconcile premium realtime bootstrap with the new shared session transport.
- Add smoke coverage for published workflow selection and session start/stop.

## Risks And Edge Cases

- Published version is archived after selection but before session start
- Active workspace changes during session bootstrap
- Browser refresh occurs during a live sandbox run

## Decisions

- Priority: P0
- Labels: frontend, runtime, tdd-required
- `/sandbox` and `/workflows` should share the same session engine; they differ only in manifest source.
- Published-mode sandbox remains the place to compare existing releases, but it must use the same live audio transport as draft mode.

## Next Recommended Step

Once transport and provider adapters are in place, switch `/sandbox` startup from local adapter boot to live session creation.
