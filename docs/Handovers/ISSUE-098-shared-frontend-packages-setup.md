# ISSUE-098: Shared frontend packages setup

Issue link: https://github.com/tuzzy08/zara/issues/98

## Goal

Deliver Shared frontend packages setup for the Frontend area in the Foundation milestone.

## Acceptance Criteria

- `packages/ui`, `packages/api-client`, and `packages/auth-client` are planned or scaffolded for shared frontend code
- Shared packages do not depend on tenant-only or admin-only app code
- Typecheck covers shared package boundaries

## Status

- Status: done
- Completion: 100%

## Work Completed

- Added `packages/ui`, `packages/api-client`, and `packages/auth-client` to the npm workspace and TypeScript project references.
- Added minimal source entry files and package manifests so the shared packages participate in workspace typechecking without depending on app code.
- Added explicit package `exports` maps to each shared frontend package to reinforce entrypoint-only consumption.

## Completed This Pass

- Confirmed the shared frontend packages live outside `apps/web` and `apps/platform-admin`, keeping ownership boundaries clean from the start.
- Verified the shared package scaffolds remain generic and safe for both tenant and platform-admin use.

## Tests Run

- `npm.cmd run typecheck`

## Remaining Work

- None for issue completion. Actual UI components, auth helpers, and typed HTTP clients are tracked in later feature issues such as issue `#83`, issue `#85`, and issue `#97`.

## Risks And Edge Cases

- Circular workspace dependency
- Admin-only component leaks into tenant app

## Decisions

- Priority: P1
- Labels: frontend, platform-admin, tdd-required
- Handover docs are mandatory for every pass on this issue.
- This issue covers shared package setup, not feature implementation inside those packages.
- The shared frontend packages must stay app-agnostic so `apps/web` and `apps/platform-admin` can evolve independently.

## Next Recommended Step

Issue complete. Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Platform-Admin.md, docs/Roadmap.md, and the next active handover before starting the next issue.
