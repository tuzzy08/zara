# ISSUE-002: NestJS API scaffold

External: [GitHub #2](https://github.com/tuzzy08/zara/issues/2)

Issue link: https://github.com/tuzzy08/zara/issues/2

## Goal

Deliver NestJS API scaffold for the Backend area in the Foundation milestone.

## Acceptance Criteria

- NestJS app boots in test mode
- Health endpoint is covered by a failing-first test
- Module layout is documented

## Status

- Status: done
- Completion: 100%

## Work Completed

- Added the `apps/api` workspace with NestJS 11 runtime and testing dependencies.
- Added a failing-first Vitest integration test for application boot and `GET /health`.
- Implemented the minimal NestJS root module, health module, health controller, and bootstrap entrypoint needed to satisfy the test.
- Documented the production-shaped module layout in `apps/api/README.md`.

## Completed This Pass

- Verified the RED step by running the new test before `AppModule` existed.
- Added the smallest possible health surface to make the test pass without overbuilding the API shell.
- Wired the API workspace into root project references and workspace-wide test discovery.
- Added `build`, `dev`, and `start` scripts to `apps/api/package.json` so the Nest shell can be started directly from npm workspaces.
- Fixed the runtime entrypoint detection in `apps/api/src/main.ts` so Windows argv paths resolve correctly when the API is launched through local TypeScript runners.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/app.module.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/app.module.test.ts`
- Verification: `npm.cmd run typecheck`
- RED: `npm.cmd run test:run -- apps/api/src/entrypoint.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/entrypoint.test.ts`
- Verification: `npm.cmd run start:api` and confirmed `GET http://127.0.0.1:4010/health`

## Remaining Work

- None for issue completion. Domain modules, auth wiring, environment handling, and deployment concerns move to later issues such as issue `#5`, issue `#7`, and issue `#18`.

## Risks And Edge Cases

- Config missing
- Port collision

## Decisions

- Priority: P0
- Labels: backend, tdd-required
- Handover docs are mandatory for every pass on this issue.
- The API scaffold starts with a single health slice and a documented module layout rather than a generic catch-all template.
- Vitest remains the workspace test runner, while Nest testing utilities provide the bootstrapping surface for backend integration tests.

## Next Recommended Step

Issue complete. Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and the next active handover before starting the next issue.
