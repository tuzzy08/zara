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
- Canceled a stuck Coolify deployment that stopped in `npm ci`, then hardened the production Docker install step with no-audit/no-fund flags.
- Follow-up live deployment verification showed the BuildKit npm cache mount could wedge Coolify helper deployments after the underlying build process exited, so the Dockerfile and deployment docs were corrected to use deterministic `npm ci --no-audit --fund=false` without `--mount=type=cache` or `--prefer-offline`.
- Follow-up fix on 2026-06-04: stopped tenant shell auth-context reads from depending on freshly allocated auth snapshot objects, so stable signed-in sessions do not repeatedly call `/api/auth/context` during render cycles and exhaust Better Auth read buckets.
- Follow-up fix on 2026-06-04: raised the default global Better Auth rate-limit bucket from 60 to 300 requests per 60 seconds in API config, Coolify Compose, and deployment env examples while preserving Better Auth's stricter built-in limits for sign-in, sign-up, password-reset, and verification-email paths.
- Follow-up production action on 2026-06-04: updated Coolify production and preview `ZARA_AUTH_RATE_LIMIT_MAX` variables from `60` to `300`, redeployed the app, and verified the live API accepted 70 consecutive unauthenticated `/api/auth/get-session` reads without a 429.
- Follow-up fix on 2026-06-04: removed normal tenant shell subscriptions to Better Auth active-organization and active-member hook readers. The auth client now restores tenant/platform session details from the server-owned `/api/auth/context`, and the tenant shell can open from that context when the raw Better Auth session only contains the signed-in user.
- Follow-up fix on 2026-06-04: removed normal tenant/platform shell dependency on Better Auth `useSession()` reads, moved tenant email sign-in auto-entry to Zara auth-context memberships instead of Better Auth organization list reads, and made production `/api/auth/context` expand organization memberships through one Postgres query against Better Auth tables after the single session read.
- Follow-up deployment hardening on 2026-06-04: confirmed the deployed tenant app makes only one browser `/api/auth/context` request on a fresh signed-out load, confirmed 40 consecutive live `/api/auth/get-session` probes returned HTTP 200, and changed the frontend Nginx config so SPA documents are not cached while hashed assets remain immutable.
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
- RED: `npm.cmd exec -- vitest run apps/api/src/production-dockerfile.test.ts --pool=forks --maxWorkers=1 --reporter=dot` failed while the Dockerfile still used `RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline --no-audit --fund=false`.
- GREEN: `npm.cmd exec -- vitest run apps/api/src/production-dockerfile.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run packages/core/src/deployment-docs.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- RED: `npm.cmd exec -- vitest run apps/web/src/app.test.tsx -t "loads auth context once" --pool=forks --maxWorkers=1 --reporter=verbose` failed because a stable signed-in session called `getContext` 6 times in 50ms.
- RED: `npm.cmd exec -- vitest run apps/api/src/auth/better-auth.instance.test.ts -t "production rate limiting" --pool=forks --maxWorkers=1 --reporter=verbose` failed while the default global rate-limit max was still 60.
- GREEN: `npm.cmd exec -- vitest run apps/web/src/app.test.tsx -t "loads auth context once" --pool=forks --maxWorkers=1 --reporter=dot`
- GREEN: `npm.cmd exec -- vitest run apps/api/src/auth/better-auth.instance.test.ts -t "production rate limiting" --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run apps/api/src/auth/better-auth.instance.test.ts apps/api/src/auth/auth-context.controller.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd exec -- vitest run apps/web/src/app.test.tsx -t "surfaces telephony heartbeats" --pool=forks --maxWorkers=1 --reporter=verbose`
- `npm.cmd exec -- vitest run apps/web/src/app.test.tsx --pool=forks --maxWorkers=1 --reporter=dot`
- `npm.cmd run typecheck --workspace @zara/web`
- `npm.cmd run typecheck --workspace @zara/api`
- Live Coolify probe after env redeploy: `70` consecutive `GET https://al3jsaee27rqqtxju38wjcf3.178.156.251.144.sslip.io/api/auth/get-session` responses returned HTTP 200 and `0` returned HTTP 429.
- RED: `npm.cmd exec -- vitest run packages/auth-client/src/index.test.ts -t "does not mount Better Auth organization readers" --pool=forks --maxWorkers=1 --reporter=verbose` failed while `useSession()` still mounted Better Auth active-organization/member hook readers.
- GREEN: `npm.cmd exec -- vitest run packages/auth-client/src/index.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- GREEN: `npm.cmd exec -- vitest run apps/web/src/app.test.tsx -t "loads auth context once|opens the tenant shell from server-owned auth context|shows an organization chooser|gates tenant routes" --pool=forks --maxWorkers=1 --reporter=dot`
- GREEN: `npm.cmd exec -- vitest run apps/web/src/app.test.tsx --pool=forks --maxWorkers=1 --reporter=dot`
- GREEN: `npm.cmd run typecheck --workspace @zara/auth-client`
- GREEN: `npm.cmd run typecheck --workspace @zara/web`
- GREEN: `npm.cmd run build --workspace @zara/auth-client`
- RED: `npm.cmd exec -- vitest run packages/auth-client/src/index.test.ts -t "does not mount Better Auth session" --pool=forks --maxWorkers=1 --reporter=verbose` failed while normal tenant rendering still consumed Better Auth session snapshots.
- RED: `npm.cmd exec -- vitest run apps/web/src/app.test.tsx -t "no Better Auth session snapshot" --pool=forks --maxWorkers=1 --reporter=verbose` failed before the tenant shell could bootstrap from Zara auth context without a Better Auth session snapshot.
- RED: `npm.cmd exec -- vitest run apps/api/src/auth/auth-context-membership-reader.test.ts --pool=forks --maxWorkers=1 --reporter=verbose` failed while the Postgres membership reader did not exist.
- GREEN: `npm.cmd exec -- vitest run packages/auth-client/src/index.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- GREEN: `npm.cmd exec -- vitest run apps/api/src/auth/auth-context-membership-reader.test.ts apps/api/src/auth/auth-context.controller.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- GREEN: `npm.cmd exec -- vitest run apps/platform-admin/src/index.test.tsx --pool=forks --maxWorkers=1 --reporter=dot`
- GREEN: `npm.cmd exec -- vitest run apps/web/src/app.test.tsx --pool=forks --maxWorkers=1 --reporter=dot`
- GREEN: `npm.cmd run typecheck --workspace @zara/auth-client`
- GREEN: `npm.cmd run typecheck --workspace @zara/web`
- GREEN: `npm.cmd run typecheck --workspace @zara/platform-admin`
- GREEN: `npm.cmd run typecheck --workspace @zara/api`
- GREEN: `npm.cmd run build --workspace @zara/auth-client`
- GREEN: `npm.cmd run build --workspace @zara/web`
- GREEN: `npm.cmd run build --workspace @zara/api`
- GREEN: `npm.cmd run build --workspace @zara/platform-admin`
- Live Coolify deployment check: latest successful deployment is commit `4fcb8b5`.
- Live API probe: `40` consecutive `GET https://al3jsaee27rqqtxju38wjcf3.178.156.251.144.sslip.io/api/auth/get-session` responses returned HTTP 200.
- Live browser probe: fresh tenant app load emitted one browser `GET /api/auth/context` request and no browser `/api/auth/get-session`, `/organization/get-active-member`, or `/organization/get-full-organization` requests.
- RED: `npm.cmd exec -- vitest run apps/api/src/production-dockerfile.test.ts -t "SPA documents" --pool=forks --maxWorkers=1 --reporter=verbose` failed while `deploy/nginx/spa.conf` had no no-cache header for SPA document routes.
- GREEN: `npm.cmd exec -- vitest run apps/api/src/production-dockerfile.test.ts -t "SPA documents" --pool=forks --maxWorkers=1 --reporter=verbose`

## Pending Work

- None for ISSUE-154.

## Risks

- Better Auth logs unknown reset emails during tests; the public response remains normalized and non-enumerating.
- Production must provide a real transactional email webhook before API startup.
- The full `apps/web/src/app.test.tsx` jsdom suite had one transient timing miss looking for `Ringing` during the first long run; the isolated test and a full rerun both passed.

## Decisions

- Use Better Auth supported flows and configure server-owned email delivery instead of custom auth mechanics.
- Keep email verification staged for account security/risky-action readiness rather than globally blocking tenant sign-in in this slice.
- Expose safe session IDs to the browser and map them to Better Auth tokens only inside the server.
- Key tenant shell auth effects by stable session primitives rather than object identity because the normalized auth snapshot can allocate fresh objects on every render.
- Keep the global auth rate-limit bucket read-friendly, relying on Better Auth's built-in stricter rules for sensitive auth-action endpoints.
- Treat `/api/auth/context` as the app-shell read model. Better Auth browser hooks remain available only for explicit auth mutations, while normal shell bootstrap and tenant auto-entry use Zara context reads.
- In production, resolve auth-context memberships from the Better Auth Postgres `member` and `organization` tables instead of issuing Better Auth organization/full-member read endpoints for every shell context request.
- Serve SPA document routes with `Cache-Control: no-store, max-age=0` so a Coolify deployment does not leave users testing an old auth/runtime bundle; keep hashed JS/CSS/assets immutable.

## Next Recommended Step

- Move to ISSUE-155 for platform-admin MFA/passkey and staff auth assurance.
