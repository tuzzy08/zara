# Staging Deployment

## Production-Critical Parity

Staging mirrors production-critical services without sharing production data or secrets. It exists to validate release artifacts, migrations, provider integrations, auth origins, and smoke tests before production traffic is touched.

Staging deployment units:

- Tenant app: `apps/web` at `https://staging-app.zara.ai`
- Platform admin app: `apps/platform-admin` at `https://staging-admin.zara.ai`
- NestJS API: `apps/api` at `https://staging-api.zara.ai`

Services that must mirror production shape:

- Durable Postgres with pgvector enabled
- Better Auth with organization plugin enabled
- Separate tenant and platform-admin origins
- API CORS/trusted origins for staging domains only
- Object storage bucket or bucket prefix separate from production
- Provider sandbox accounts for telephony, billing, STT, TTS, model, OAuth, and webhook integrations
- Log, metric, and error collection with staging labels

Staging may use smaller capacity than production, but it must keep the same topology and migration path. Staging must never use production secrets.

## Safe Seed Data

Seed data must be synthetic, reversible, and clearly marked.

Allowed seed data:

- Synthetic tenant organizations, users, and workspaces
- Synthetic phone numbers reserved for provider sandboxes
- Test workflow graphs and published versions
- Fake CRM/helpdesk records in sandbox provider accounts
- Synthetic memory, knowledge, billing, and compliance records

Disallowed seed data:

- Production customer records
- Real caller transcripts or recordings
- Production provider credentials
- Production OAuth refresh tokens
- Production Polar customer IDs, subscription IDs, or webhook secrets
- Real payment card, health, government ID, or other regulated data

Seed refresh process:

1. Reset staging tenant data through a repeatable seed job.
2. Recreate test users and organizations.
3. Recreate provider sandbox connections and webhook URLs.
4. Recreate synthetic workflows, memory, billing state, and telephony routes.
5. Run staging validation before handing the environment to testers.

## Staging Validation

Staging validation runs before production deployment:

- `npm run lint`
- `npm run typecheck`
- `npm run test:run`
- `npm run eval:runtime`
- `npm run eval:pstn`
- `npm run db:check`
- Apply migrations against the staging database.
- Build `apps/api`, `apps/web`, and `apps/platform-admin`.
- Deploy the exact release artifact intended for production.
- Run the production smoke-test list against staging domains.
- Confirm provider webhooks target `https://staging-api.zara.ai`.
- Confirm staging browser bundles use `https://staging-api.zara.ai`.
- Confirm staging billing uses Polar sandbox mode.
- Confirm staging telephony uses provider sandbox/test accounts.
- Confirm staging observability dashboards show calls, latency, errors, cost, integrations, telephony, release version, and `traceId` correlation.
- Confirm the platform-admin AI runtime view shows eval regression status, redacted failing trace IDs, and LangSmith trace check results for protected runtime changes.
- Confirm the platform-admin PSTN call-quality view shows the latest `npm run eval:pstn` result, first-response p95 latency, no-frame timeout count, bridge errors, Twilio stop reasons, and successful Phone test rate for telephony changes.
- Confirm backup/DR restore-test evidence, restore owner, and RPO/RTO posture are current before promotion.

Validation failures block promotion. Fixes must be committed, rebuilt, redeployed to staging, and revalidated before production.

## Drift Controls

Staging drift makes production validation untrustworthy.

Controls:

- Staging uses the same branch/tag artifact that will be promoted to production.
- Staging migration history must match the checked-in migration directory.
- Staging domains stay in Better Auth trusted origins and CORS allowlists.
- Staging secrets are reviewed separately from production secrets.
- Staging provider accounts are named and tagged as staging.
- Scheduled seed refreshes remove ad hoc test data.
- Any manual staging-only config change is recorded in the release notes or codified before promotion.

Drift response:

1. Stop promotion.
2. Identify whether drift is code, schema, seed data, or environment config.
3. Reconcile staging to the release artifact and documented environment shape.
4. Rerun staging validation from the beginning.

## Promotion Criteria

A release can promote from staging to production only when:

- The exact production candidate has run in staging.
- Staging migrations completed successfully.
- Staging smoke tests passed.
- Staging observability and backup/DR release gates passed.
- No production secrets were used in staging.
- Seed data is synthetic and safe.
- Release owner, security owner, and domain owner for touched areas have signed off.

## Staging Smoke Tests

Run the same smoke tests as production, replacing domains with staging domains:

- `GET /api/auth/ok` returns success from `https://staging-api.zara.ai`.
- Tenant app loads at `https://staging-app.zara.ai`.
- Platform admin app loads at `https://staging-admin.zara.ai`.
- Test tenant sign-in creates an active staging organization session.
- Workflow validation and voice sandbox session run against synthetic workflows.
- Billing state returns synthetic Polar sandbox data only.
- Compliance readiness returns general SaaS posture.
- Telephony health checks use sandbox/test provider connections.
- Unsigned provider webhooks are rejected.
- Observability dashboards show the staging release version and correlated `traceId` events.
- Platform-admin runtime observability passes the LangSmith trace check and shows the latest `npm run eval:runtime` result.
- Platform-admin PSTN call quality shows the latest `npm run eval:pstn` result and redacted PSTN trace posture.
- Backup/DR readiness can identify the candidate restore point and latest restore test evidence.
