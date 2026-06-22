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
- Follow-up hardening on 2026-06-22: removed trust in legacy client-spoofable platform-admin headers for signed-in staff mutation posture and audit actors. Signed-in staff posture now derives session age from the Better Auth session and defaults to password assurance unless server-owned assurance is supplied. Non-production harness authority uses explicit `x-zara-test-*` headers only, and signed-in audit actors come from the Better Auth user ID instead of request headers.

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
- RED 2026-06-22: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts -t "rejects spoofed client step-up headers" --pool=forks --maxWorkers=1 --reporter=dot` failed as expected because spoofed `x-zara-auth-assurance` plus `x-zara-session-age-seconds` allowed a signed-in staff mutation (`expected 403`, received `200`).
- GREEN 2026-06-22: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts -t "rejects spoofed client step-up headers" --pool=forks --maxWorkers=1 --reporter=dot` passed.
- RED 2026-06-22: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts -t "audits signed-in staff mutations" --pool=forks --maxWorkers=1 --reporter=dot` failed as expected because the server-owned test step-up path was not yet available for signed-in staff (`expected 200`, received `403`).
- GREEN 2026-06-22: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts -t "audits signed-in staff mutations" --pool=forks --maxWorkers=1 --reporter=dot` passed.
- GREEN 2026-06-22: `npm.cmd run test:run -- apps/api/src/platform-admin/platform-admin.controller.test.ts --pool=forks --maxWorkers=1 --reporter=dot` passed, 8 tests.
- GREEN 2026-06-22: `npm.cmd run test:run -- apps/api/src/auth/auth-context.controller.test.ts --pool=forks --maxWorkers=1 --reporter=dot` passed, 8 tests.
- GREEN 2026-06-22: `npm.cmd run test:run -- apps/api/src/app.module.test.ts --pool=forks --maxWorkers=1 --reporter=dot` passed, 2 tests.
- BLOCKED 2026-06-22: `npm.cmd run build --workspace @zara/api` failed on unrelated pre-existing TypeScript errors in `apps/api/src/runtime-sessions/runtime-sessions.service.ts` and `apps/api/src/telephony/telephony.service.ts`.

## Pending Work

- None.

## Risks

- Production must configure `ZARA_PLATFORM_STAFF_ROLES`; otherwise signed-in staff users will not receive a platform role.
- The current MFA/passkey posture is enforced from server-side assurance signals; production identity setup must provide `mfa` or `passkey` assurance for protected mutations.
- Until a production identity provider supplies server-owned MFA/passkey assurance, signed-in production staff sessions remain password-assured for protected mutation checks and must not be upgraded by client headers.
- API build verification is currently blocked by unrelated runtime/telephony TypeScript errors outside this issue's files.

## Decisions

- Platform-admin auth remains separate from tenant auth and must carry platform role plus MFA/passkey posture for risky operations.
- Password-only staff sessions may read permitted staff surfaces but cannot mutate.
- Platform support can run only support-scoped actions after MFA/passkey step-up; readonly never mutates.
- Impersonation requires platform owner/admin plus MFA/passkey step-up and fresh session age.
- Legacy client headers `x-zara-auth-assurance`, `x-zara-session-age-seconds`, `x-zara-session-authenticated-at`, `x-zara-auth-now`, and `x-zara-actor-user-id` are not platform-admin authority. Non-production tests/local harnesses must use explicit `x-zara-test-*` authority headers.

## Next Recommended Step

- Clear the unrelated API build errors, then rerun `npm.cmd run build --workspace @zara/api` as the remaining broad verification gate.
