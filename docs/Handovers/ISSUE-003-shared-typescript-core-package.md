# ISSUE-003: Shared TypeScript core package

External: [GitHub #3](https://github.com/tuzzy08/zara/issues/3)

Issue link: https://github.com/tuzzy08/zara/issues/3

## Goal

Deliver Shared TypeScript core package for the Setup area in the Foundation milestone.

## Acceptance Criteria

- Core package exports public domain types
- No app imports private implementation paths
- Typecheck passes

## Status

- Status: done
- Completion: 100%

## Work Completed

- Added a first public runtime surface to `@zara/core` for shared app and role constants.
- Added a focused Vitest suite that asserts the public runtime exports for tenant roles, platform roles, and frontend app ids.
- Added a package `exports` map so consumers are nudged toward the package entrypoint instead of private paths.

## Completed This Pass

- Confirmed the public core entrypoint remains the only supported import surface after the workspace expansion.
- Kept the core package lightweight so later auth, manifest, telephony, and memory contracts can land in focused follow-up issues.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/index.test.ts` failed because the runtime exports were undefined.
- GREEN: `npm.cmd run test:run -- packages/core/src/index.test.ts`
- Verification: `npm.cmd run typecheck`

## Remaining Work

- None for issue completion. Future auth, manifest, telephony, and memory contracts are intentionally split into later issues instead of bloating this foundation issue.

## Risks And Edge Cases

- Breaking shared contracts
- Circular package imports

## Decisions

- Priority: P0
- Labels: setup, backend, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Shared runtime constants now include `frontendApps`, `tenantRoles`, and `platformRoles`.
- The package entrypoint is the only supported import surface for `@zara/core`.

## Next Recommended Step

Issue complete. Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Platform-Admin.md, and the next active handover before starting the next issue.
