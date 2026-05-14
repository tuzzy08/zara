# ISSUE-102: Workspace settings and access management

Issue link: https://github.com/tuzzy08/zara/issues/102

## Goal

Give workspace admins safe controls for workspace settings and member access.

## Work Completed

- Added shared `@zara/core` workspace domain operations for rename, archive, restore, membership role changes, membership revocation, and audit entry creation.
- Enforced final-owner protection and archive blocking when active sessions exist.
- Implemented tenant workspace settings UI in `apps/web` with workspace directory, rename/archive/restore controls, role grants and revocations, and audit history.
- Persisted workspace memberships and workspace audit entries in browser-local state alongside workspace switching.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/workspace.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=threads`
- `npm.cmd run typecheck`

## Pending Work

- Replace browser-local persistence with NestJS workspace settings APIs once those routes exist.
- Add live active-session counts from runtime/sandbox state before archive actions become server-backed.

## Risks And Edge Cases

- Removing the final workspace owner.
- Archived workspace still has active calls or sandbox sessions.

## Decisions

- Workspace admin actions must be auditable and permission-checked server-side.
- Current issue scope is satisfied in the tenant app with shared domain safeguards, while server-enforced authorization remains a follow-on API slice.
- Workspace access and audit history stay scoped by both tenant and workspace IDs even in browser-local persistence.

## Next Recommended Step

Move the same rename/archive/membership contracts behind authenticated NestJS workspace routes when the workspace backend module is scheduled.
