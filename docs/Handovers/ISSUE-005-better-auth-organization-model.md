# ISSUE-005: Better Auth organization model

Issue link: https://github.com/tuzzy08/zara/issues/5

## Goal

Deliver Better Auth organization model for the Backend area in the Foundation milestone.

## Acceptance Criteria

- Users can belong to organizations
- Roles gate organization resources
- Session tests cover tenant isolation

## Status

- Status: done
- Completion: 100%

## Work Completed

- Added a Better Auth-backed organization model in `apps/api/src/auth/organization-model.ts` with Zara tenant roles: `owner`, `admin`, `builder`, `operator`, and `viewer`.
- Added a Nest `AuthModule` and `OrganizationAccessService` for session-scoped organization membership and permission checks.
- Added focused session tests that prove multi-organization membership, role-based resource gating, active-organization isolation, and stale-session rejection.
- Installed `better-auth@1.6.10` into the API workspace and kept the Nest auth surface generator-based for module/service shells.

## Completed This Pass

- Used Nest CLI generators to create the initial auth module and service shells, then normalized the generated paths back into `src/auth/`.
- Built the Better Auth organization model around product roles rather than the default `owner/admin/member` trio so the backend matches the documented Zara role system.
- Kept the issue scoped to organization modeling and authorization checks instead of pretending the full auth transport layer was complete.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/auth/organization-access/organization-access.service.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/auth/organization-access/organization-access.service.test.ts`
- Verification: `npm.cmd run test:run -- apps/api/src/auth/organization-access/organization-access.service.test.ts apps/api/src/database/schema.test.ts apps/api/src/app.module.test.ts packages/core/src/env.test.ts packages/core/src/index.test.ts`
- Verification: `npm.cmd run typecheck`

## Remaining Work

- None for issue completion. Better Auth transport wiring, database-backed sessions, invites, and frontend auth clients are tracked in later issues such as issue `#6`, issue `#83`, and issue `#86`.

## Risks And Edge Cases

- User removed during session
- Invite accepted twice

## Decisions

- Priority: P0
- Labels: backend, security, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Better Auth is used here for the organization role model and access-control definitions, while the full HTTP auth surface remains intentionally deferred to later auth integration issues.
- Session authorization is scoped to the active organization by default, so cross-tenant access attempts fail even if the same user belongs to multiple organizations.
- The initial auth role set matches the product docs: `owner`, `admin`, `builder`, `operator`, and `viewer`.

## Next Recommended Step

Issue complete. Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and the next active handover before starting the next issue.
