# ISSUE-001: Project workspace setup

Issue link: https://github.com/tuzzy08/zara/issues/1

## Goal

Deliver Project workspace setup for the Setup area in the Foundation milestone.

## Acceptance Criteria

- npm workspace installs cleanly
- TypeScript project references compile
- Repository has root scripts for typecheck and tests

## Work Completed

- Added root `test` and `test:run` scripts with Vitest.
- Added workspace package manifests and TypeScript project references for `apps/web`, `apps/platform-admin`, `packages/ui`, `packages/api-client`, and `packages/auth-client`.
- Added minimal source entry files for the new app workspaces so the repo-wide `tsc -b` build stays green.
- Updated `AGENTS.md` so `DESIGN.md` is mandatory reading for UI work and production-quality UI language is enforced.

## Tests Run

- `npm.cmd run typecheck`
- `npm.cmd run test:run -- packages/core/src/index.test.ts`

## Pending Work

- Add real app scaffolds and dev/build scripts when issue `#8`, issue `#85`, and issue `#98` are active.
- Add CI coverage for the new root test script under issue `#6`.
- Keep `DESIGN.md` aligned with actual UI direction as the frontend work begins.

## Risks And Edge Cases

- Windows PowerShell npm shim
- Empty repo with no prior commits

## Decisions

- Priority: P0
- Labels: setup, tdd-required
- Handover docs are mandatory for every pass on this issue.
- The monorepo now reserves two frontend apps from the start: `apps/web` and `apps/platform-admin`.
- Root testing uses Vitest for fast workspace-level feedback.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Roadmap.md, and this handover. Then continue with issue `#2` or deepen issue `#3` by expanding the shared core contracts behind failing tests.
