# ISSUE-102: Workspace settings and access management

Issue link: https://github.com/tuzzy08/zara/issues/102

## Goal

Give workspace admins safe controls for workspace settings and member access.

## Work Completed

- Added shared `@zara/core` workspace domain operations for rename, archive, restore, membership role changes, membership revocation, and audit entry creation.
- Enforced final-owner protection and archive blocking when active sessions exist.
- Implemented tenant workspace settings UI in `apps/web` with workspace directory, rename/archive/restore controls, role grants and revocations, and audit history.
- Added `packages/core/src/workspace-seed.ts` so the tenant shell and Nest workspace module share the same seeded workspace directory contract.
- Added NestJS `WorkspacesModule` with workspace state, create, mutate, access-mark, membership role, and membership revoke routes under `/organizations/:orgId/workspaces/*`.
- Switched the tenant shell and workspace settings flow from browser-local workspace persistence to API-backed workspace state, while keeping only the last active workspace ID browser-local for UX continuity.
- Added latest-response guarding in `apps/web` so slower initial workspace fetches cannot overwrite fresher mutations from rename, create, archive, or membership actions.
- Added shared Nest CORS configuration for local tenant app origins so the workspace API is reachable from split local frontend ports.

## Tests Run

- `npm.cmd run test:run -- apps/api/src/workspaces/workspaces.controller.test.ts`
- `npm.cmd run test:run -- packages/core/src/workspace.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=threads`
- `npm.cmd run typecheck`

## Pending Work

- Move the in-memory Nest workspace store onto Postgres-backed tenant data once the persistence layer is scheduled.
- Add authenticated Better Auth tenant guards and workspace-level permission checks on the new routes.
- Feed live active sandbox/runtime session counts into archive checks instead of the current explicit `activeSessionCount` parameter.
- Add a documented local API startup path so browser verification can run against the actual Nest process without manual trial and error.

## Risks And Edge Cases

- Removing the final workspace owner.
- Archived workspace still has active calls or sandbox sessions.

## Decisions

- Workspace admin actions must be auditable and permission-checked server-side.
- Current issue scope is now satisfied with API-backed workspace state in the tenant app, even though the Nest module still uses an in-memory store.
- Workspace access and audit history stay scoped by both tenant and workspace IDs in both the UI state and Nest module responses.

## Next Recommended Step

Add Better Auth-backed authorization plus durable Postgres persistence to the new workspace routes before telephony, memory, and monitoring begin depending on them.
