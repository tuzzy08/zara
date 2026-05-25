# ISSUE-083: Frontend auth client setup

Issue link: https://github.com/tuzzy08/zara/issues/83

## Goal

Deliver Frontend auth client setup for the Auth area in the Foundation milestone.

## Acceptance Criteria

- Better Auth React client is configured for both Vite apps
- Login, logout, and session state work against the NestJS auth backend
- Route guards cover unauthenticated, tenant, and platform-admin users

## Work Completed

- Added `better-auth` to `packages/auth-client` and implemented the shared frontend auth boundary for both Vite apps.
- `packages/auth-client` now normalizes Better Auth React `useSession`, email/password sign-in, and sign-out into Zara-specific session, tenant organization, and platform-role shapes.
- Wired the tenant app through the shared auth client:
  - unauthenticated sessions render a tenant sign-in screen before dashboard routes
  - signed-in sessions with an active organization render the existing tenant shell
  - the profile menu exposes sign-out and returns to the sign-in gate
  - signed-in users without an active organization see a tenant-access-required state
- Added a minimal platform-admin app auth gate:
  - unauthenticated users see the Zara Admin sign-in gate
  - tenant-only sessions see a platform-access-required state
  - sessions with a platform role render the platform operations shell
- Updated API and frontend architecture docs with the frontend auth-client contract.
- Follow-up pass on 2026-05-22 fixed the missing NestJS Better Auth backend mount that caused `Cannot POST /api/auth/sign-in/email`.
- Added `BetterAuthController` under `/api/auth/*`, Better Auth email/password server configuration, and local/test memory-adapter storage so `/api/auth/ok`, `/api/auth/sign-up/email`, and `/api/auth/sign-in/email` are reachable through the Nest app.
- Extended `packages/auth-client` with normalized email/password sign-up.
- Added a tenant `/signup` route state to the unauthenticated gate and a production-facing account creation form.
- Follow-up pass on 2026-05-23 implemented self-serve tenant signup:
  - enabled the Better Auth organization plugin on the Nest auth instance with Zara organization roles
  - extended the signup form to collect organization name
  - updated the shared auth client so signup creates the user, creates the organization, sets it active, and normalizes active organization/member role hooks into the tenant session contract
  - added durable Better Auth core and organization Postgres tables plus migration SQL

## Tests Run

- RED: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "gates tenant routes" --pool=forks` failed because the workflow shell rendered without a session gate.
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "gates tenant routes" --pool=forks` passed after wiring the tenant auth gate and sign-out flow.
- RED: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx` failed because `PlatformAdminApp` was not exported.
- GREEN: `npm.cmd run test:run -- apps/platform-admin/src/index.test.tsx` passed after adding the platform-admin auth gate.
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=forks`
- GREEN: `npm.cmd run typecheck --workspace @zara/auth-client`
- GREEN: `npm.cmd run typecheck --workspace @zara/web`
- GREEN: `npm.cmd run typecheck --workspace @zara/platform-admin`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/platform-admin/src/index.test.tsx --pool=forks`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/web`
- GREEN: `npm.cmd run build --workspace @zara/platform-admin`
- GREEN: `npm.cmd run build`
- RED: `npm.cmd run test:run -- apps/api/src/auth/better-auth.controller.test.ts --pool=forks` failed because `/api/auth/ok` and email auth routes returned 404.
- GREEN: `npm.cmd run test:run -- apps/api/src/auth/better-auth.controller.test.ts --pool=forks`
- RED: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "exposes tenant signup" --pool=forks` failed because `/signup` still rendered the sign-in form.
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "exposes tenant signup" --pool=forks`
- GREEN: `npm.cmd run test:run -- apps/api/src/auth/better-auth.controller.test.ts apps/web/src/app.test.tsx apps/platform-admin/src/index.test.tsx --pool=forks`
- GREEN: `npm.cmd run typecheck --workspace @zara/auth-client`
- GREEN: `npm.cmd run typecheck --workspace @zara/api`
- GREEN: `npm.cmd run typecheck --workspace @zara/web`
- GREEN: `npm.cmd run typecheck --workspace @zara/platform-admin`
- RED: `npm.cmd run test:run -- apps/api/src/auth/better-auth.controller.test.ts -t "self-serve" --pool=forks` failed because `/api/auth/organization/create` returned 404 without the organization plugin.
- RED: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "exposes tenant signup" --pool=forks` failed because `/signup` did not collect an organization name.
- GREEN: `npm.cmd run test:run -- apps/api/src/auth/better-auth.controller.test.ts -t "self-serve" --pool=forks`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "exposes tenant signup" --pool=forks`
- RED: `npm.cmd run test:run -- apps/api/src/database/schema.test.ts -t "Better Auth" --pool=forks` failed because durable Better Auth tables were not in the schema.
- GREEN: `npm.cmd run test:run -- apps/api/src/database/schema.test.ts -t "Better Auth" --pool=forks`
- GREEN: `npm.cmd run test:run -- apps/api/src/auth/better-auth.controller.test.ts apps/api/src/database/schema.test.ts apps/web/src/app.test.tsx apps/platform-admin/src/index.test.tsx --pool=forks`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build`
- GREEN: live API smoke on `http://127.0.0.1:4010` for sign-up, organization create, organization set-active, and active member lookup.

## Pending Work

- None for ISSUE-083 acceptance.

## Risks And Edge Cases

- Trusted origin missing
- Session expires while app is open
- Local/test Better Auth uses the memory adapter so auth is available without a local Postgres instance; staging and production must keep the configured database and Better Auth tables available.
- Self-serve signup slug generation appends a timestamp suffix to reduce collisions; invite-first onboarding can later provide tenant-approved slugs or domains.

## Decisions

- Priority: P0
- Labels: auth, frontend, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Keep the shared package interface small and Zara-shaped instead of leaking Better Auth response internals into app components.
- Treat platform-admin as a separate app-level auth gate; tenant organization membership is not sufficient for staff-console access.
- The Better Auth server route belongs in Nest under `/api/auth/*`; the Vite clients should continue pointing at the API origin, not a separate frontend route.
- Tenant self-serve signup should create and activate an owner organization immediately so users do not land in the tenant-access-required state after creating an account.

## Next Recommended Step

ISSUE-083 acceptance is closed. Move to the next pending feature slice item.
