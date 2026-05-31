# ISSUE-155: Platform admin MFA and staff auth hardening

Status: Implemented
Date: 2026-05-31
External: [Linear ZAR-101](https://linear.app/zara-voice/issue/ZAR-101/issue-155-platform-admin-mfa-and-staff-auth-hardening)

## Work Completed

- Created the external Linear issue and reconciled it with the local backlog.
- Captured staff auth hardening as a separate platform-admin slice after auth context and account-security controls.
- Added platform auth posture to the server-owned auth context, including role, assurance level, session age, MFA/passkey flags, mutation/support/impersonation booleans, and stable reason codes.
- Added server-side platform staff authority resolution from `ZARA_PLATFORM_STAFF_ROLES` signed-in email mappings while preserving non-production role-header testing.
- Hardened platform-admin guards so active staff reads require a non-expired staff session, core mutations require owner/admin plus MFA/passkey step-up, support actions require support/admin plus MFA/passkey step-up, and impersonation requires owner/admin plus MFA/passkey step-up.
- Added audit facts for staff mutation assurance level and session age.
- Extended `@zara/auth-client` to normalize platform auth posture and restore platform-admin session state from the server-owned context after staff sign-in.
- Updated the platform-admin UI with a dedicated staff sign-in form, tenant-only restricted state, expired-session sign-in-again state, sign-out control, assurance badge, and disabled mutation controls when MFA/passkey step-up is missing.
- Updated API, architecture, frontend, security, platform-admin, deployment, roadmap, and backlog docs.

## Tests Run

- `npm.cmd exec -- vitest run apps/api/src/auth/auth-context.controller.test.ts apps/api/src/platform-admin/platform-admin.controller.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run apps/api/src/auth/auth-context.controller.test.ts apps/api/src/platform-admin/platform-admin.controller.test.ts --pool=forks --maxWorkers=1 --reporter=dot -t "configured staff|signed-in staff"`
- `npm.cmd exec -- vitest run packages/auth-client/src/index.test.ts --pool=forks --maxWorkers=1 --reporter=dot -t "platform admin"`
- `npm.cmd exec -- vitest run apps/api/src/auth/auth-context.controller.test.ts apps/api/src/platform-admin/platform-admin.controller.test.ts packages/auth-client/src/index.test.ts apps/platform-admin/src/index.test.tsx --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run apps/api/src/auth/better-auth.instance.test.ts apps/api/src/auth/auth-context.controller.test.ts apps/api/src/auth/auth-account-security.controller.test.ts apps/api/src/platform-admin/platform-admin.controller.test.ts packages/auth-client/src/index.test.ts apps/platform-admin/src/index.test.tsx --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd run build --workspace @zara/auth-client`
- `npm.cmd run build --workspace @zara/api`
- `npm.cmd run build --workspace @zara/web`
- `npm.cmd run build --workspace @zara/platform-admin`
- `npm.cmd run build`

## Pending Work

- None.

## Risks

- Production must configure `ZARA_PLATFORM_STAFF_ROLES`; otherwise signed-in staff users will not receive a platform role.
- The current MFA/passkey posture is enforced from server-side assurance signals; production identity setup must provide `mfa` or `passkey` assurance for protected mutations.

## Decisions

- Platform-admin auth remains separate from tenant auth and must carry platform role plus MFA/passkey posture for risky operations.
- Password-only staff sessions may read permitted staff surfaces but cannot mutate.
- Platform support can run only support-scoped actions after MFA/passkey step-up; readonly never mutates.
- Impersonation requires platform owner/admin plus MFA/passkey step-up and fresh session age.

## Next Recommended Step

- Move to the next planned issue after committing ZAR-101.
