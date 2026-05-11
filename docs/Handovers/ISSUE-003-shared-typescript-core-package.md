# ISSUE-003: Shared TypeScript core package

Issue link: https://github.com/tuzzy08/zara/issues/3

## Goal

Deliver Shared TypeScript core package for the Setup area in the Foundation milestone.

## Acceptance Criteria

- Core package exports public domain types
- No app imports private implementation paths
- Typecheck passes

## Work Completed

- Added a first public runtime surface to `@zara/core` for shared app and role constants.
- Added a focused Vitest suite that asserts the public runtime exports for tenant roles, platform roles, and frontend app ids.
- Added a package `exports` map so consumers are nudged toward the package entrypoint instead of private paths.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/index.test.ts` failed because the runtime exports were undefined.
- GREEN: `npm.cmd run test:run -- packages/core/src/index.test.ts`
- Verification: `npm.cmd run typecheck`

## Pending Work

- Expand the shared core package with manifest, auth, telephony, and platform-admin contracts as later issues activate.
- Add consumer-facing package imports from the new frontend and backend workspaces once those slices are live.
- Keep package boundaries clean as `packages/ui`, `packages/api-client`, and `packages/auth-client` start to fill in.

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

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Frontend-Architecture.md, docs/Platform-Admin.md, and this handover. Then add the next smallest shared contract behind a failing test, likely auth or organization role data needed by issue `#2` and issue `#5`.
