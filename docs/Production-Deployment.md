# Production Deployment

## Production Environment

Production runs public deployment units behind separate origins:

- Tenant app: `apps/web` at `https://app.zara.ai`
- Platform admin app: `apps/platform-admin` at `https://admin.zara.ai`
- NestJS API: `apps/api` at `https://api.zara.ai`
- Premium PSTN realtime workers: two separate Coolify Dockerfile Applications built with target `realtime-worker` and distinct worker-specific origins

The API is the authority for auth, organizations, workspaces, telephony, integrations, memory, billing, compliance, and live sandbox transport. The tenant and platform-admin apps are static Vite builds configured with production API/auth origins. Production must use durable Postgres with pgvector enabled, object storage for recordings and exports, provider webhook URLs on the production API origin, and managed log/metric collection.

Production-critical environment variables:

- `NODE_ENV=production`
- `ZARA_ENV=production`
- `DATABASE_URL`
- `OBJECT_STORAGE_ENDPOINT`
- `OBJECT_STORAGE_REGION`
- `OBJECT_STORAGE_ACCESS_KEY_ID`
- `OBJECT_STORAGE_SECRET_ACCESS_KEY`
- `OBJECT_STORAGE_FORCE_PATH_STYLE`
- `RECORDINGS_BUCKET`
- `ASSETS_BUCKET`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL=https://api.zara.ai`
- `API_PUBLIC_URL=https://api.zara.ai`
- `ZARA_TRUSTED_ORIGINS=https://app.zara.ai,https://admin.zara.ai`
- `ZARA_PLATFORM_STAFF_ROLES=admin@zara.ai=platform_owner,support@zara.ai=platform_support`
- `VITE_API_BASE_URL=https://api.zara.ai`
- `VITE_AUTH_BASE_URL=https://api.zara.ai`
- `TELEPHONY_CREDENTIAL_MASTER_KEY`
- `TELEPHONY_CREDENTIAL_KEY_VERSION`
- `TELEPHONY_CREDENTIAL_LEGACY_KEYS` when rotating keys
- `ZARA_TWILIO_WEBHOOK_URL=https://api.zara.ai/telephony/webhooks/twilio` when the Twilio webhook path cannot be derived from `API_PUBLIC_URL`
- `ZARA_TWILIO_MEDIA_STREAM_BASE_URL=wss://api.zara.ai/telephony/twilio/media-streams` when the Twilio media stream path cannot be derived from `API_PUBLIC_URL`
- a distinct Coolify service domain in `https://host:4020` form for each worker application
- a distinct `PSTN_WORKER_PUBLIC_MEDIA_URL=wss://host/telephony/twilio/media-streams` value advertised by each Dockerfile worker application; the checked-in Compose baseline accepts `REALTIME_WORKER_PUBLIC_URL` and maps it to this worker variable
- `PSTN_ADMISSION_REDIS_URL`
- a unique `PSTN_WORKER_ID` in each worker application and the same deployed artifact identifier in `PSTN_WORKER_RELEASE_ID`
- worker heartbeat, drain, resource, WebSocket, and concurrency limits from `deploy/coolify.env.example`
- Provider secrets for AssemblyAI, Cartesia, OpenAI, Twilio, OAuth connectors, Polar, and webhook signing
- `ZARA_RELEASE_ID` with the exact immutable API release candidate ID
- `BILLING_CHARGE_DELIVERY_ENABLED=false` unless the persisted ISSUE-248 gate passes for the same catalog and release

## Release Process

For the VPS/Coolify path, use `docs/Coolify-Deployment.md` and the root `compose.coolify.yml` file so npm workspace packages are built from the repository root.

1. Create a release branch or tag from a green `main`.
2. Confirm CI has passed `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run eval:runtime`, `npm run eval:pstn`, and `npm run db:check`.
3. Build all deployable units with `npm run build`.
4. Review generated migration diff and confirm it matches the intended schema change.
5. Build the API and realtime-worker targets from the same release artifact with migrations gated but not yet applied to live traffic.
6. Run migration preflight against production with the release artifact.
7. Apply migrations during an approved release window.
8. Confirm both realtime workers are healthy, then apply Zara's serial drain-and-replace procedure to one worker at a time. Drain the selected worker, wait for owned calls to finish or the forced deadline and terminal persistence, replace it without process overlap using a fresh worker ID, verify its exact endpoint and new-release heartbeat, restore eligibility, and only then repeat for the sibling.
9. Deploy the API, then tenant and platform-admin static artifacts.
10. Shift new call traffic gradually to the new API and verified worker release.
11. Confirm observability dashboards, alert thresholds, backup restore point, and rollback owner are ready.
12. Run production smoke tests before announcing the release complete.

Releases that touch telephony, runtime, auth, billing, memory, or migrations require an explicit rollback owner and an active-call review before traffic shift.

Both workers must run the same `PSTN_WORKER_RELEASE_ID` from the production candidate. Configure each as a separate Coolify Dockerfile Application with a distinct domain that routes only to that application. Coolify's overlapping rolling update must remain disabled. Every replacement receives a fresh immutable process-level worker ID and follows Zara's non-overlapping serial drain-and-replace procedure. The checked-in Docker Compose resource is the single-worker baseline and does not provide rolling updates or the two-worker HA topology.

## Secrets

Secrets live only in the deployment platform secret manager. They must not be committed, printed in logs, embedded in static frontend bundles, or copied from staging.

Secret handling rules:

- Rotate provider and encryption secrets through versioned deployment variables.
- Keep recording and asset buckets private, versioned, and tenant-prefix isolated.
- Keep `TELEPHONY_CREDENTIAL_LEGACY_KEYS` only for the migration window required to read old envelopes.
- Register provider webhooks against `https://api.zara.ai`, never local or staging URLs.
- Confirm routed imported Twilio numbers have their Voice URL set to the production Zara webhook after route save.
- Keep Polar production credentials separate from Polar sandbox credentials.
- Verify Better Auth trusted origins include only the production tenant and admin origins.
- Verify `BETTER_AUTH_URL`, `VITE_API_BASE_URL`, and `VITE_AUTH_BASE_URL` are same-site with the tenant/admin app origins. A custom tenant domain such as `https://zharaai.com` needs a same-site API domain such as `https://api.zharaai.com`, not a Coolify `sslip.io` helper URL baked into the browser bundle.
- Verify `ZARA_PLATFORM_STAFF_ROLES` contains only active Zara staff accounts and is reviewed before release.
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
2. Mark affected realtime workers draining so they stop advertising capacity while retaining their claimed calls.
3. Bring up last-known-good workers and require healthy registry heartbeats before routing new premium calls.
4. Keep current API and worker instances alive until active calls drain. Never transfer an in-progress premium media socket to the API or silently change its runtime.
5. Route new traffic back to the last known-good API artifact.
6. Redeploy the last known-good tenant and platform-admin builds.
7. Re-run smoke tests against the restored version.

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
- [ ] Better Auth production URL, browser auth/API base URLs, and trusted origins match same-site production domains.
- [ ] Tenant app, platform-admin app, and API artifacts are versioned.
- [ ] Two separate worker applications use the same candidate release ID, rolling updates are disabled, each running process has a unique immutable worker ID, and enabled-provider credentials match advertised capabilities.
- [ ] Worker readiness is healthy, registry heartbeat age is below the configured TTL, and at least one compatible worker has an available slot before premium traffic is enabled.
- [ ] Each Coolify worker domain is configured as `https://host:4020`; each advertised media URL uses `wss://host/telephony/twilio/media-streams`, preserves WebSocket upgrades, and targets that exact worker.
- [ ] Every advertised worker ID resolves to its own media endpoint, or worker-aware ingress routes the signed target deterministically; no random replica routing sits between Twilio and the selected worker.
- [ ] Deployed staging evidence covers effective WebSocket idle behavior, non-overlapping serial replacement, worker drain and stop grace, terminal persistence, and effective file-descriptor limits for both worker applications.
- [ ] Provider webhook URLs target `https://api.zara.ai`.
- [ ] Telephony credential key version and legacy keys are reviewed.
- [ ] Polar is set to production mode with production webhook secret.
- [ ] Real charge delivery is disabled, or the persisted approval, internal and selected-tenant canaries, reconciliation, and drills are current and match `POLAR_BILLING_CATALOG_ID` and `ZARA_RELEASE_ID`.
- [ ] The emergency charge-stop procedure in `docs/Runbooks/billing-charge-release-gate.md` is ready and preserves ledger and outbox facts.
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
- Start a voice sandbox session for a test workflow and verify events replay.
- Read `/organizations/:orgId/billing/state` and confirm no provider secrets are present.
- Read `/organizations/:orgId/compliance/readiness` and confirm general SaaS posture.
- Run a telephony connection health check against a non-customer test connection.
- Confirm provider webhook signature validation rejects an unsigned request.
- Confirm an unavailable or draining worker causes premium call setup to fail closed before Twilio receives a media stream URL.
- Run the protocol simulator duplicate-media scenario and confirm one worker owns the call, the duplicate socket closes with `4409`, and only one provider connection opens.
- Confirm calls, latency, errors, cost, integrations, and telephony dashboards show the release version and `traceId` correlation.
- Confirm platform-admin runtime observability shows the latest `npm run eval:runtime` result and LangSmith trace check without exposing unredacted trace data.
- Confirm platform-admin PSTN call quality shows the latest `npm run eval:pstn` result, first-response p95 latency, no-frame timeout count, Twilio stop reasons, and successful Phone test rate.
- Confirm platform-admin sign-in rejects a tenant-only account, accepts a configured staff account, and blocks a password-only protected mutation until MFA/passkey assurance is present.
- Confirm the backup/DR owner can identify the active restore point and latest restore test evidence.

## Ownership

The release owner coordinates deployment, database migration, rollback, dashboard readiness, backup/DR readiness, and smoke-test signoff. Security signs off releases that change auth, secrets, provider credentials, cross-tenant dashboard exposure, backup recovery posture, or compliance behavior. Billing signs off releases that change Polar, usage, cost dashboards, or budget behavior.
