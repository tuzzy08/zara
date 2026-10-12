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

- Signup through the browser, a real verification token delivered to the local
  inbox, rejected invalid verification token, successful verification, sign-out,
  rejected password, and successful sign-in. Session cookies must be secure and HTTP-only.
- Two separate browser sessions and organizations, an owner-created workspace,
  denied cross-tenant reads and writes, forged test-auth headers, anonymous access,
  unchanged owner data, and continued access to the second tenant's own data.

The email capture service replaces only the external email delivery boundary.
Auth, sessions, organization membership and API authorization are real. Workspace
state is currently process-local in the app; this suite does not claim persistence
across API restarts. Signup does not yet require email verification, and this suite
does not add password confirmation or a new signup policy.

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
