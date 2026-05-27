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
- Hardened shared auth session normalization so Better Auth refetch windows stay in a loading state instead of showing tenant-access-required.
- Restored tenant roles from the full organization membership payload when the active-member hook has not returned a role yet.
- Added a tenant mirror for durable Postgres auth so Better Auth organizations are upserted into the product `tenants` table with the same ID.
- Stopped forwarding Better Auth callback redirects from tenant sign-in/sign-up so organization restoration requests are not aborted mid-login.
- Added an explicit auth-client build script and root build ordering so the web app is built against the current shared auth client.

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
- RED: `npm.cmd run test:run -- packages/auth-client/src/index.test.ts -t "keeps tenant session pending|restores tenant organization role" --pool=threads --maxWorkers=1 --no-isolate --reporter=dot`
  - Failed because refetching auth snapshots reported `isPending: false`, and full organization membership roles were not used as a fallback.
- GREEN: `npm.cmd run test:run -- packages/auth-client/src/index.test.ts -t "keeps tenant session pending|restores tenant organization role" --pool=threads --maxWorkers=1 --no-isolate --reporter=dot`
- GREEN: `npm.cmd run test:run -- packages/auth-client/src/index.test.ts --pool=threads --maxWorkers=1 --no-isolate --reporter=dot`
- GREEN: `npm.cmd run typecheck --workspace @zara/auth-client -- --pretty false`
- RED: `npm.cmd run test:run -- packages/auth-client/src/index.test.ts -t "keeps the restored tenant organization available" --pool=threads --maxWorkers=1 --no-isolate --reporter=dot`
  - Failed because the tenant app could still see a signed-in user with `organization: null` while Better Auth hooks caught up after `set-active`.
- GREEN: `npm.cmd run test:run -- packages/auth-client/src/index.test.ts -t "keeps the restored tenant organization available" --pool=threads --maxWorkers=1 --no-isolate --reporter=dot`
- RED: `npm.cmd run test:run -- packages/auth-client/src/index.test.ts -t "restores the user's tenant organization" --pool=threads --maxWorkers=1 --no-isolate --reporter=dot`
  - Failed because `callbackURL` was forwarded into Better Auth sign-in and could abort organization restoration requests.
- GREEN: `npm.cmd run test:run -- packages/auth-client/src/index.test.ts -t "restores the user's tenant organization" --pool=threads --maxWorkers=1 --no-isolate --reporter=dot`
- GREEN: `npm.cmd run build --workspace @zara/auth-client -- --pretty false`
- LIVE PROBE: Node fetch against `http://127.0.0.1:4010/api/auth` with a trusted Origin confirmed signup, organization create, signout, signin, organization list, set-active, get-session, get-full-organization, and get-active-member all work against the running API.
- BLOCKED: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "gates tenant routes behind login and supports sign out" --pool=threads --maxWorkers=1 --no-isolate --reporter=dot`
  - Vitest timed out starting the worker before importing the test file.
- BLOCKED: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "gates tenant routes behind login and supports sign out" --pool=forks --maxWorkers=1 --reporter=dot`
  - Vitest timed out starting the worker before importing the test file.
- RED: `npm.cmd run test:run -- apps/api/src/auth/tenant-mirror.test.ts apps/api/src/auth/organization-model.test.ts --pool=threads --maxWorkers=1 --no-isolate --reporter=dot`
  - Failed because no tenant mirror module existed and the organization plugin was not injectable.
- GREEN: `npm.cmd run test:run -- apps/api/src/auth/tenant-mirror.test.ts apps/api/src/auth/organization-model.test.ts --pool=threads --maxWorkers=1 --no-isolate --reporter=dot`
- GREEN: `npm.cmd run test:run -- apps/api/src/auth/better-auth.instance.test.ts apps/api/src/auth/tenant-mirror.test.ts apps/api/src/auth/organization-model.test.ts --pool=threads --maxWorkers=1 --no-isolate --reporter=dot`
- GREEN: `npm.cmd run typecheck --workspace @zara/api -- --pretty false`
- GREEN: `npx.cmd eslint packages/auth-client/src/index.ts packages/auth-client/src/index.test.ts apps/web/src/App.tsx apps/api/src/auth/better-auth.instance.ts apps/api/src/auth/organization-model.ts apps/api/src/auth/tenant-mirror.ts apps/api/src/auth/tenant-mirror.test.ts apps/api/src/auth/organization-model.test.ts`
- GREEN: `npm.cmd run build --workspace @zara/web`
- BROWSER SMOKE: local `http://127.0.0.1:4173` signup -> signout -> sign-in now opens the tenant shell. Network trace shows sign-in, organization list, set-active, get-full-organization, and get-active-member all complete successfully.

## Pending Work

- No required acceptance work remains.
- Future multi-tenant account UX can replace first-organization restoration with an explicit organization picker.

## Risks And Edge Cases

- Better Auth persists memberships but does not automatically set an active organization on fresh sign-in sessions.
- The tenant app now restores the first available organization. This is correct for current self-serve single-tenant signup, but multi-tenant users may later need a chooser.
- Signup still depends on Better Auth organization creation succeeding after user creation; if organization creation fails, the shared client returns the Better Auth error.
- Better Auth query atoms can briefly hold stale signed-in session data while refetching after organization activation; the shared client now treats that as pending to avoid a false tenant-access-required screen.
- The full organization response includes member roles, so the tenant client can recover organization context even when the active-member hook lags or fails.
- Existing Better Auth organizations created before the tenant mirror will still need a one-time backfill into `tenants`.
- Better Auth `callbackURL` redirects can interrupt tenant restoration; tenant auth forms now rely on app navigation after the shared client finishes sign-in/sign-up work.

## Decisions

- Keep the fix inside `packages/auth-client` so both the tenant app and tests use the same Zara-shaped auth boundary.
- Scope organization restoration to the tenant client only, preserving platform-admin separation.
- Treat blank tenant names as client-boundary validation to avoid creating orphan user accounts.
- Treat Better Auth organization ID as the canonical product tenant ID and mirror it into `tenants` for product-table foreign keys.

## Next Recommended Step

Close ISSUE-131.
