# Signup and tenant-isolation E2E

Requirements: Node 22 or later, npm, Docker with Compose, and free local port 8443.

```sh
npm ci
npx playwright install chromium
npm run test:e2e
```

On Linux, use `npx playwright install --with-deps chromium` first.

The runner builds the existing production API and tenant web targets. It starts
disposable PostgreSQL (with pgvector), Redis, an email capture service, and Caddy.
Auth runs in production mode with secure cookies over local HTTPS. Test browser
contexts ignore certificate errors for this local self-signed HTTPS setup.
The target URL is fixed to loopback; the runner accepts no production URL override.
The root `.env` is not loaded. All container credentials are disposable constants.
The internal Docker network prevents provider calls. Billing delivery is disabled.
No production service, database, email address, or provider token is required.

The suite covers:

- Signup through the browser, recovery-mode correction, password confirmation and
  show/hide controls, a separate success page, a real verification token delivered
  to the local inbox, rejected invalid verification token, rendered verification
  email action, server-confirmed verified page, direct dashboard entry from saved
  organization details without form re-entry, concurrent repeated completion,
  denied anonymous completion and verification-link replay, sign-out, rejected
  password, and successful sign-in. Session cookies must be secure and HTTP-only.
- Two separate browser sessions and organizations, an owner-created workspace,
  denied cross-tenant reads and writes, forged test-auth headers, anonymous access,
  unchanged owner data, and continued access to the second tenant's own data.

The email capture service replaces only the external email delivery boundary.
Auth, sessions, organization membership and API authorization are real. Two API
instances share a disposable Postgres database. The control-plane tests verify
workspace state and audit records across concurrent writes and restart, last-owner
protection, revoked access after organization membership replacement, stable
workspace identity after name reuse, publication conflicts and durable manifests.
They also check API SIGTERM exit and session recovery. A companion real
Nest/Postgres integration probe checks database availability during drain and pool
closure afterward; it does not simulate a live provider call. A synthetic Zendesk
configuration checks that rejected publication cannot create tool grants without
calling an external provider. Original signup organization details are stored in Postgres.
Signup requires email verification before password sign-in. Native verification
creates a session; the waiting-page URL itself grants no access. The verified
page reads server status and completes the owned organization on Continue setup.
Tests respect the provider's sign-in rate limit and its bounded Retry-After.
Better Auth applies a separate sign-up/sign-in limit of three requests per
10-second window. The control-plane signup helper retries a rate-limited signup
once after 11 seconds. Its suite also waits 11 seconds in `afterAll`, outside the
browser test clock, so its shared-IP signup traffic does not consume the next
browser suite's allowance. The production limiter remains enabled and unchanged.

Artifacts are in `artifacts/e2e/<run-id>/`: HTML report, JUnit results, browser traces,
failure screenshots, service logs, image IDs and run metadata with source/lock hashes.
Use `npx playwright show-report artifacts/e2e/<run-id>/report` to inspect the report.
Use `npx playwright show-trace <trace.zip>` to inspect a trace. Traces contain
disposable auth data. Do not publish them on a public website.

CI uses the same command and uploads artifacts on success or failure for seven
days. CI execution is only verified after the workflow runs on GitHub.
The runner returns a nonzero exit code on startup, test or cleanup failure.
It removes only its unique Compose project's containers and volumes, including
when a test fails. Each run uses a fresh database. Run this command, not a bare
`playwright test`, for a repeatable clean run.
