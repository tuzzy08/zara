# ISSUE-154: Account security flows and session controls

Status: Implemented
Date: 2026-05-31
External: [Linear ZAR-100](https://linear.app/zara-voice/issue/ZAR-100/issue-154-account-security-flows-and-session-controls)

## Work Completed

- Created the external Linear issue and reconciled it with the local backlog.
- Captured email verification, password reset, rate limiting, and session controls as a separate account-security slice.
- Added Better Auth production security resolution with required 32+ character `BETTER_AUTH_SECRET`, production-only secure cookies/proxy headers, database-backed auth rate limiting, reset-token TTL, verification-token TTL, and password-reset session revocation.
- Added server-owned auth email delivery with in-memory test capture, local logging, and required production `ZARA_AUTH_EMAIL_WEBHOOK_URL`.
- Added Zara-owned account-security API routes for no-enumeration reset requests, signed-in email verification requests, safe session listing, and selected session revocation.
- Added shared auth-client methods for reset request/submit, verification request, session list, and session revoke.
- Added tenant UI for sign-in reset requests, `/reset-password?token=...`, and Settings account security/session controls.
- Added the durable Better Auth `rateLimit` table and idempotent `0006_auth_rate_limit_table.sql` migration required by production database-backed rate limiting.
- Patched the live Coolify Postgres deployment with the same `rateLimit` table and verified public auth endpoints returned HTTP 200.
- Canceled a stuck Coolify deployment that stopped in `npm ci`, then hardened the production Docker install step with a BuildKit npm cache mount plus no-audit/no-fund flags before retrying the live deploy.
- Updated API, frontend, security, Coolify deployment, env example, roadmap, and backlog docs.

## Tests Run

- `npm.cmd exec -- vitest run apps/api/src/auth/better-auth.instance.test.ts apps/api/src/auth/auth-account-security.controller.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run packages/auth-client/src/index.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run apps/web/src/app.test.tsx --pool=forks --maxWorkers=1 --reporter=dot -t "password reset|reset-password|verification email"`
- `npm.cmd exec -- vitest run apps/api/src/auth/better-auth.instance.test.ts apps/api/src/auth/auth-account-security.controller.test.ts packages/auth-client/src/index.test.ts apps/web/src/app.test.tsx --pool=forks --maxWorkers=1 --reporter=dot -t "Better Auth runtime security|Auth account security controller|tenant auth client|password reset|reset-password|verification email"`
- `npm.cmd exec -- vitest run apps/api/src/auth/better-auth.instance.test.ts apps/api/src/auth/auth-account-security.controller.test.ts apps/api/src/auth/auth-context.controller.test.ts apps/api/src/auth/auth-onboarding.controller.test.ts apps/api/src/auth/auth-invitations.controller.test.ts apps/api/src/database/schema.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run apps/web/src/app.test.tsx --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd run build --workspace @zara/auth-client`
- `npm.cmd run build --workspace @zara/api`
- `curl -k https://al3jsaee27rqqtxju38wjcf3.178.156.251.144.sslip.io/api/auth/ok`
- `curl -k https://al3jsaee27rqqtxju38wjcf3.178.156.251.144.sslip.io/api/auth/context`
- `npm.cmd run build --workspace @zara/web`
- `npm.cmd run build --workspace @zara/platform-admin`
- `npm.cmd run build`
- RED: `npm.cmd exec -- vitest run apps/api/src/production-dockerfile.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- GREEN: `npm.cmd exec -- vitest run apps/api/src/production-dockerfile.test.ts --pool=forks --maxWorkers=1 --reporter=dot`

## Pending Work

- None for ISSUE-154.

## Risks

- Better Auth logs unknown reset emails during tests; the public response remains normalized and non-enumerating.
- Production must provide a real transactional email webhook before API startup.

## Decisions

- Use Better Auth supported flows and configure server-owned email delivery instead of custom auth mechanics.
- Keep email verification staged for account security/risky-action readiness rather than globally blocking tenant sign-in in this slice.
- Expose safe session IDs to the browser and map them to Better Auth tokens only inside the server.

## Next Recommended Step

- Move to ISSUE-155 for platform-admin MFA/passkey and staff auth assurance.
