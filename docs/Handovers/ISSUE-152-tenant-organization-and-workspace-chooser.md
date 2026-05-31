# ISSUE-152: Tenant organization and workspace chooser

Status: Implemented
Date: 2026-05-31
External: [Linear ZAR-98](https://linear.app/zara-voice/issue/ZAR-98/issue-152-tenant-organization-and-workspace-chooser)

## Work Completed

- Created the external Linear issue and reconciled it with the local backlog.
- Captured explicit tenant/workspace choice as the replacement for silent first-organization restoration.
- Updated the shared auth client so email sign-in auto-enters only single-membership users, leaves multi-tenant users unselected, and exposes explicit Better Auth-backed tenant selection.
- Updated `GET /api/auth/context` so signed-in users with no active organization still receive tenant membership summaries, while active workspace is returned only for accessible active workspace memberships.
- Added the tenant organization chooser before tenant routes render for multi-tenant users.
- Scoped last active workspace storage per tenant organization and ignored stored workspaces that are archived or inaccessible to the signed-in user.
- Updated API, architecture, frontend architecture, roadmap, and backlog docs.

## Tests Run

- `npm.cmd exec -- vitest run packages/auth-client/src/index.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run apps/api/src/auth/auth-context.controller.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run packages/auth-client/src/index.test.ts apps/api/src/auth/auth-context.controller.test.ts apps/api/src/auth/auth-onboarding.controller.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run apps/web/src/app.test.tsx --pool=threads --maxWorkers=1 --reporter=dot`
- `npm.cmd run typecheck`

## Pending Work

- None for ISSUE-152.

## Risks

- No open ISSUE-152 risks. Multi-tenant sign-in now requires explicit tenant choice before tenant routes render.

## Decisions

- Keep single-tenant sign-in frictionless while adding explicit choice for multi-tenant accounts.
- Treat workspace restore as tenant-scoped and membership-aware browser state, not tenant authority.

## Next Recommended Step

- Move to ISSUE-153: Tenant invitation acceptance flow.
