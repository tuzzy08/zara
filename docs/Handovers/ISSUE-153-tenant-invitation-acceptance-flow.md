# ISSUE-153: Tenant invitation acceptance flow

Status: Implemented
Date: 2026-05-31
External: [Linear ZAR-99](https://linear.app/zara-voice/issue/ZAR-99/issue-153-tenant-invitation-acceptance-flow)

## Work Completed

- Added Zara-owned invitation API routes for create, list, revoke, and accept under `/api/auth/invitations`.
- Wrapped Better Auth organization invitations with product validation for tenant role, invited email, active workspace access intent, recipient matching, invitation status, expiry, and cross-tenant revoke/accept failures.
- Added existing-user and new-user acceptance paths; acceptance sets the Better Auth organization active and grants only the configured workspace role when workspace intent is present.
- Added stable product failure codes for wrong email, revoked, already accepted, expired, forbidden/cross-tenant, unavailable workspace, and post-accept workspace grant failure.
- Added normalized auth-client invitation helpers and restored accepted tenant sessions after invite acceptance.
- Added tenant Settings UI controls to invite a teammate into the selected workspace and revoke pending invitations.
- Added Postgres schema/migration support for invitation workspace intent fields.
- Updated API, frontend architecture, security/compliance, architecture, roadmap, and backlog docs.

## Tests Run

- `npm.cmd exec -- vitest run apps/api/src/auth/auth-invitations.controller.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run packages/auth-client/src/index.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run apps/web/src/app.test.tsx -t "invite and revoke pending teammates" --pool=threads --maxWorkers=1 --reporter=verbose`
- `npm.cmd exec -- vitest run apps/web/src/app.test.tsx --pool=threads --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run apps/api/src/auth/auth-invitations.controller.test.ts apps/api/src/auth/auth-context.controller.test.ts apps/api/src/auth/auth-onboarding.controller.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run apps/api/src/database/schema.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run apps/api/src/auth/auth-invitations.controller.test.ts apps/api/src/auth/auth-context.controller.test.ts apps/api/src/auth/auth-onboarding.controller.test.ts apps/api/src/database/schema.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd run typecheck`

## Pending Work

- None for ISSUE-153.

## Risks

- Invitation workspace intent currently follows the same in-memory workspace-state baseline as the existing workspace API; production durability remains tied to the broader workspace persistence plan.
- Better Auth invitation workspace intent has a Postgres migration in this issue; deploys must run migrations before enabling the new invitation UI.

## Decisions

- Better Auth remains the organization membership and invitation authority; Zara routes own the product contract, workspace intent, user-facing failure codes, and audit projection.
- Tenant Settings is the first UI surface for owner/admin invitation management because workspace access intent is easiest to understand when anchored to the selected workspace.
- Workspace access from invitations is optional; users accepted without workspace intent become tenant members but do not receive an active workspace unless separately granted.

## Next Recommended Step

- Move to ISSUE-154 for account security flows and session controls.
