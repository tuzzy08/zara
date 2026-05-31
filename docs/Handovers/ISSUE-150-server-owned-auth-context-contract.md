# ISSUE-150: Server-owned auth context contract

Status: Implemented
Date: 2026-05-31
External: [Linear ZAR-96](https://linear.app/zara-voice/issue/ZAR-96/issue-150-server-owned-auth-context-contract)

## Work Completed

- Created the external Linear issue and reconciled it with the local backlog.
- Defined the first auth-hardening slice as a server-owned auth context contract.
- Added `GET /api/auth/context` as a NestJS-owned endpoint that derives the signed-in user, active tenant organization, memberships, active/default workspace, platform role, and flattened tenant/platform permission summaries from the request context.
- Added a safe signed-out context that does not leak tenant or platform data.
- Added shared auth-client `getContext()` support that calls the server-owned context endpoint with cookies included and normalizes the response.
- Updated `docs/API.md`, `docs/Frontend-Architecture.md`, `docs/Roadmap.md`, and `docs/Issue-Backlog.md` with the implemented baseline.

## Tests Run

- `npm.cmd exec -- vitest run apps/api/src/auth/auth-context.controller.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run packages/auth-client/src/index.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run apps/api/src/auth/better-auth.controller.test.ts apps/api/src/auth/auth-context.controller.test.ts packages/auth-client/src/index.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd run typecheck --workspace @zara/auth-client`
- `npm.cmd run typecheck`

## Pending Work

- ISSUE-151 should replace the current two-step signup with atomic/resumable tenant onboarding.
- ISSUE-152 should move tenant and workspace selection onto the server-owned context baseline.

## Risks

- Platform role is still represented by the existing request-header authority until the later platform-admin MFA/passkey hardening slice replaces that with stronger staff identity assurance.
- Active workspace selection falls back to the default seeded workspace when the signed-in user does not yet have explicit workspace membership.

## Decisions

- Start with a server-owned context before signup, chooser, invitation, or MFA changes.
- Keep frontend guards as UX only; API authorization remains authoritative.
- Use HTTP 200 plus a safe signed-out body for unauthenticated context reads so both Vite apps can consume one stable shape.

## Next Recommended Step

- Move to ISSUE-151: atomic tenant onboarding signup.
