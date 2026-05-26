# ISSUE-131: Tenant auth organization reactivation

Issue link: https://github.com/tuzzy08/zara/issues/116

## Status

Implemented.

## Goal

Fix returning tenant account access after self-serve signup so users do not land in the tenant-access-required state after signing out and signing back in.

## Work Completed

- Added focused shared auth-client coverage for tenant organization restoration after email sign-in.
- Updated tenant email sign-in to list the signed-in user's organizations and set the first organization active for the tenant app.
- Kept platform-admin sign-in from activating tenant organizations.
- Added focused signup validation so blank or whitespace-only tenant organization names are rejected before user creation.
- Updated API, roadmap, and backlog docs to record the Better Auth active-organization behavior.

## Tests Run

- RED: `npm.cmd run test:run -- packages/auth-client/src/index.test.ts -t "restores the user's tenant organization" --pool=threads`
  - Failed because email sign-in did not list organizations or set one active.
- GREEN: `npm.cmd run test:run -- packages/auth-client/src/index.test.ts -t "restores the user's tenant organization" --pool=threads`
- RED: `npm.cmd run test:run -- packages/auth-client/src/index.test.ts -t "rejects signup" --pool=threads`
  - Failed because whitespace tenant names reached organization creation after the user was created.
- GREEN: `npm.cmd run test:run -- packages/auth-client/src/index.test.ts --pool=threads`
- GREEN: `npm.cmd run typecheck --workspace @zara/auth-client`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "gates tenant routes|exposes tenant signup" --pool=threads`
- GREEN: `npm.cmd run test:run -- apps/api/src/auth/better-auth.controller.test.ts -t "self-serve" --pool=threads`

## Pending Work

- No required acceptance work remains.
- Future multi-tenant account UX can replace first-organization restoration with an explicit organization picker.

## Risks And Edge Cases

- Better Auth persists memberships but does not automatically set an active organization on fresh sign-in sessions.
- The tenant app now restores the first available organization. This is correct for current self-serve single-tenant signup, but multi-tenant users may later need a chooser.
- Signup still depends on Better Auth organization creation succeeding after user creation; if organization creation fails, the shared client returns the Better Auth error.

## Decisions

- Keep the fix inside `packages/auth-client` so both the tenant app and tests use the same Zara-shaped auth boundary.
- Scope organization restoration to the tenant client only, preserving platform-admin separation.
- Treat blank tenant names as client-boundary validation to avoid creating orphan user accounts.

## Next Recommended Step

Close ISSUE-131.
