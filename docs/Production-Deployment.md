# Production Deployment

## Production Environment

Production runs the three public deployment units behind separate origins:

- Tenant app: `apps/web` at `https://app.zara.ai`
- Platform admin app: `apps/platform-admin` at `https://admin.zara.ai`
- NestJS API: `apps/api` at `https://api.zara.ai`

The API is the authority for auth, organizations, workspaces, telephony, integrations, memory, billing, compliance, and live sandbox transport. The tenant and platform-admin apps are static Vite builds configured with production API/auth origins. Production must use durable Postgres with pgvector enabled, object storage for recordings and exports, provider webhook URLs on the production API origin, and managed log/metric collection.

Production-critical environment variables:

- `NODE_ENV=production`
- `ZARA_ENV=production`
- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL=https://api.zara.ai`
- `ZARA_TRUSTED_ORIGINS=https://app.zara.ai,https://admin.zara.ai`
- `VITE_API_BASE_URL=https://api.zara.ai`
- `VITE_AUTH_BASE_URL=https://api.zara.ai`
- `TELEPHONY_CREDENTIAL_MASTER_KEY`
- `TELEPHONY_CREDENTIAL_KEY_VERSION`
- `TELEPHONY_CREDENTIAL_LEGACY_KEYS` when rotating keys
- Provider secrets for AssemblyAI, Cartesia, OpenAI, Twilio, OAuth connectors, Polar, and webhook signing

## Release Process

For the VPS/Coolify path, use `docs/Coolify-Deployment.md` and the root `compose.coolify.yml` file so npm workspace packages are built from the repository root.

1. Create a release branch or tag from a green `main`.
2. Confirm CI has passed `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run eval:runtime`, `npm run eval:pstn`, and `npm run db:check`.
3. Build all deployable units with `npm run build`.
4. Review generated migration diff and confirm it matches the intended schema change.
5. Deploy the API artifact first with migrations gated but not yet applied to live traffic.
6. Run migration preflight against production with the release artifact.
7. Apply migrations during an approved release window.
8. Deploy tenant and platform-admin static artifacts.
9. Shift traffic gradually to the new API and frontend versions.
10. Confirm observability dashboards, alert thresholds, backup restore point, and rollback owner are ready.
11. Run production smoke tests before announcing the release complete.

Releases that touch telephony, runtime, auth, billing, memory, or migrations require an explicit rollback owner and an active-call review before traffic shift.

## Secrets

Secrets live only in the deployment platform secret manager. They must not be committed, printed in logs, embedded in static frontend bundles, or copied from staging.

Secret handling rules:

- Rotate provider and encryption secrets through versioned deployment variables.
- Keep `TELEPHONY_CREDENTIAL_LEGACY_KEYS` only for the migration window required to read old envelopes.
- Register provider webhooks against `https://api.zara.ai`, never local or staging URLs.
- Keep Polar production credentials separate from Polar sandbox credentials.
- Verify Better Auth trusted origins include only the production tenant and admin origins.
- Confirm browser bundles contain only public `VITE_` values and never provider tokens.

## Migrations

Migrations use the Drizzle migration set under `apps/api/src/database/migrations`.

Migration release rules:

- `npm run db:check` must pass before deployment.
- Every migration is reviewed for locks, destructive statements, extension changes, and backfill impact.
- Long backfills run as separate jobs before constraints are tightened.
- A failed migration stops the release and triggers the rollback path below.
- Schema changes used by active calls must be backward compatible until all old API instances are drained.

Failed migration response:

1. Stop traffic shift and keep old API instances serving.
2. Capture migration logs and database error details.
3. If no writes occurred, revert the release artifact and retry after a fixed migration.
4. If partial writes occurred, run the documented forward-fix or compensating migration reviewed by the release owner.
5. Do not deploy frontend changes that depend on the failed schema.

## Rollback

Rollback must preserve active calls and tenant data.

Application rollback:

1. Freeze new traffic shift.
2. Keep current API instances alive until active calls drain or are transferred to fallback.
3. Route new traffic back to the last known-good API artifact.
4. Redeploy the last known-good tenant and platform-admin builds.
5. Re-run smoke tests against the restored version.

Database rollback:

- Prefer forward fixes over destructive down migrations.
- Only run a down migration when it is documented as safe and no newer writes depend on the changed schema.
- For rollback with active calls, preserve call-session, telephony execution, transport-token, and audit records until sessions complete.

Provider rollback:

- Keep old webhook handlers routable until providers confirm endpoint changes.
- Do not rotate secrets during rollback unless the release failed because of secret exposure.

## Deployment Checklist

- [ ] CI is green on the release commit.
- [ ] `npm run build` completed locally or in release CI.
- [ ] `npm run eval:runtime` completed for protected prompt, model, routing, tool, transfer, and policy changes.
- [ ] `npm run eval:pstn` completed for telephony, Twilio bridge, PSTN sandwich, latency, call-quality, and production activation changes.
- [ ] `npm run db:check` completed with no uncommitted migration drift.
- [ ] Production `DATABASE_URL` points to the production database.
- [ ] Better Auth production URL and trusted origins match production domains.
- [ ] Tenant app, platform-admin app, and API artifacts are versioned.
- [ ] Provider webhook URLs target `https://api.zara.ai`.
- [ ] Telephony credential key version and legacy keys are reviewed.
- [ ] Polar is set to production mode with production webhook secret.
- [ ] Migration plan and rollback owner are recorded.
- [ ] `docs/Observability-Dashboards.md` has been reviewed for current dashboard coverage, alert thresholds, and trace correlation.
- [ ] Platform-admin AI runtime observability has a passing LangSmith trace check or a recorded LangSmith outage override with local deterministic eval pass and owner signoff.
- [ ] Platform-admin PSTN call quality shows acceptable first-response latency, no-frame timeout, bridge-error, Twilio stop-reason, and successful Phone test posture, or an owner-approved provider-outage exception is recorded.
- [ ] `docs/Backup-Disaster-Recovery.md` has a current restore point, restore owner, RPO/RTO posture, and object-storage recovery plan.
- [ ] `docs/Production-Readiness-Checklist.md` is complete, current, and has no unchecked critical release gates.
- [ ] Active calls are checked before traffic shift.
- [ ] Smoke tests pass after traffic shift.

## Smoke Tests

Run these after each production deployment:

- `GET /api/auth/ok` returns success from `https://api.zara.ai`.
- Tenant app loads at `https://app.zara.ai` and reaches the sign-in screen.
- Platform admin app loads at `https://admin.zara.ai` and rejects tenant-only access.
- Sign in with a production test tenant and confirm active organization state.
- Open `/workflows`, validate an existing workflow, and confirm publish validation errors are readable.
- Start a typed sandbox session for a test workflow and verify events replay.
- Read `/organizations/:orgId/billing/state` and confirm no provider secrets are present.
- Read `/organizations/:orgId/compliance/readiness` and confirm general SaaS posture.
- Run a telephony connection health check against a non-customer test connection.
- Confirm provider webhook signature validation rejects an unsigned request.
- Confirm calls, latency, errors, cost, integrations, and telephony dashboards show the release version and `traceId` correlation.
- Confirm platform-admin runtime observability shows the latest `npm run eval:runtime` result and LangSmith trace check without exposing unredacted trace data.
- Confirm platform-admin PSTN call quality shows the latest `npm run eval:pstn` result, first-response p95 latency, no-frame timeout count, Twilio stop reasons, and successful Phone test rate.
- Confirm the backup/DR owner can identify the active restore point and latest restore test evidence.

## Ownership

The release owner coordinates deployment, database migration, rollback, dashboard readiness, backup/DR readiness, and smoke-test signoff. Security signs off releases that change auth, secrets, provider credentials, cross-tenant dashboard exposure, backup recovery posture, or compliance behavior. Billing signs off releases that change Polar, usage, cost dashboards, or budget behavior.
