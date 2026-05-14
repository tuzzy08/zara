# ISSUE-001: Project workspace setup

Issue link: https://github.com/tuzzy08/zara/issues/1

## Goal

Deliver Project workspace setup for the Setup area in the Foundation milestone.

## Acceptance Criteria

- npm workspace installs cleanly
- TypeScript project references compile
- Repository has root scripts for typecheck and tests

## Status

- Status: done
- Completion: 100%

## Work Completed

- Added root `test` and `test:run` scripts with Vitest.
- Added workspace package manifests and TypeScript project references for `apps/web`, `apps/platform-admin`, `packages/ui`, `packages/api-client`, and `packages/auth-client`.
- Added minimal source entry files for the new app workspaces so the repo-wide `tsc -b` build stays green.
- Updated `AGENTS.md` so `DESIGN.md` is mandatory reading for UI work and production-quality UI language is enforced.

## Completed This Pass

- Confirmed the workspace now includes the reserved frontend and shared-package topology described in the docs.
- Verified the root scripts and project references hold after the shared package and API scaffold additions.
- Added root `dev`, `dev:api`, `dev:web`, `start`, `start:api`, `preview:web`, and `build` scripts so local startup does not require memorizing workspace-specific commands.
- Added `concurrently`, `tsx`, and `dotenv-cli` as root dev dependencies to support the shared local startup flow.

## Tests Run

- `npm.cmd run typecheck`
- `npm.cmd run test:run -- packages/core/src/index.test.ts`
- `npm.cmd run test:run -- packages/core/src/ci-quality-gates.test.ts`
- `npm.cmd run build`
- Verification: `npm.cmd run dev` and confirmed `http://127.0.0.1:4010/health` and `http://127.0.0.1:4173` both respond

## Remaining Work

- None for issue completion. Future app-level scaffolds, CI wiring, and UI implementation are tracked under issue `#6`, issue `#8`, issue `#85`, and issue `#98`.

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

Issue complete. Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Roadmap.md, and the next active handover before starting the next issue.
