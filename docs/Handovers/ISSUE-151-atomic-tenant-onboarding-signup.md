# ISSUE-151: Atomic tenant onboarding signup

Status: Implemented
Date: 2026-05-31
External: [Linear ZAR-97](https://linear.app/zara-voice/issue/ZAR-97/issue-151-atomic-tenant-onboarding-signup)

## Work Completed

- Created the external Linear issue and reconciled it with the local backlog.
- Captured atomic tenant onboarding as dependent on the server-owned auth context.
- Added `POST /api/auth/onboarding/signup` as a NestJS-owned tenant onboarding action.
- The onboarding action validates tenant names, creates or resumes the Better Auth user, creates the tenant organization, sets the active organization, initializes workspace state, grants the owner access to `workspace-support`, and returns the tenant context needed by the app.
- Added recoverable partial-failure behavior so a failure after user creation can be retried with the same payload.
- Added duplicate tenant-name protection that blocks known duplicate slugs before creating another user and maps Better Auth slug collisions to the same actionable duplicate-name response.
- Updated `packages/auth-client` tenant signup to call the server-owned onboarding endpoint instead of the client-side Better Auth organization sequence.
- Added tenant UI smoke coverage for recoverable retry and duplicate-name signup errors.
- Updated API, frontend architecture, architecture, roadmap, backlog, and workspace contract notes.

## Tests Run

- `npm.cmd exec -- vitest run apps/api/src/auth/auth-onboarding.controller.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run packages/auth-client/src/index.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run apps/web/src/app.test.tsx --pool=threads --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run apps/api/src/auth/better-auth.controller.test.ts apps/api/src/auth/auth-context.controller.test.ts apps/api/src/auth/auth-onboarding.controller.test.ts packages/auth-client/src/index.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd run typecheck`

## Pending Work

- None for ISSUE-151.

## Risks

- No open ISSUE-151 risks. Tenant slug uniqueness is enforced through the onboarding registry for known local retries and the Better Auth organization slug check/create path for provider-detected collisions.

## Decisions

- Treat this as a product onboarding action, not a raw client-side Better Auth sequence.
- Use retryable server responses for partial user-created/org-not-created failures rather than leaving the user on a dead-end signup screen.
- Use `workspace-support` as the default owner workspace for the current onboarding baseline.

## Next Recommended Step

- Move to ISSUE-152: Tenant organization and workspace chooser.
