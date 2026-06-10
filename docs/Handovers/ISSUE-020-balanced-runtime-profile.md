# ISSUE-020: Balanced runtime profile

External: [GitHub #20](https://github.com/tuzzy08/zara/issues/20)

Issue link: https://github.com/tuzzy08/zara/issues/20

## Goal

Deliver Balanced runtime profile for the Runtime area in the Sandbox milestone.

## Acceptance Criteria

- Balanced profile uses stronger routing and TTS options
- Per-agent override is supported
- Cost estimate reflects profile

## Work Completed

- Added runtime profile contracts to `@zara/core`, including `cost-optimized`, `balanced`, and `premium-realtime`.
- Implemented balanced profile policy resolution with a stronger routing floor and higher-quality TTS voice selection.
- Wired runtime cost estimation to profile multipliers so balanced calls cost more than the default profile.
- Added workflow-level runtime profile selection in `apps/web` and surfaced the selected profile in the draft sandbox plus manifest preview.
- Added per-agent runtime profile override controls in the workflow inspector.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/runtime-profiles.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=threads`
- `npm.cmd run typecheck`

## Pending Work

- Replace browser-local runtime profile state with persisted NestJS workflow draft state once workflow APIs are implemented.
- Add explicit quota and provider-capacity handling when runtime adapters move behind live provider credentials.

## Risks And Edge Cases

- Language fallback
- Provider quota exceeded

## Decisions

- Priority: P1
- Labels: runtime, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Balanced now enforces a `standard` routing floor and `neural-hd` TTS voice even when the base workflow runtime remains the sandwich pipeline.
- Per-agent overrides are implemented in shared core contracts first, then surfaced lightly in the builder UI.

## Next Recommended Step

Expand runtime-policy persistence and API-backed draft storage when the workflow control-plane routes land.
