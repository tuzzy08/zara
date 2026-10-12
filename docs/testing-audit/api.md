# API and PSTN test-signal audit

Date: 2026-10-12

## Scope and method

Inventoried 272 test files under apps/api and apps/pstn-protocol-simulator. Searched source assertions, schema snapshots, metadata-only checks, and assertion-free scaffolds. Read deletion candidates and retained boundary tests. This is a targeted signal audit, not a claim that every remaining assertion is optimal. No production code changed. No live provider or production tests were run.

Removed 21 complete files (44 declared cases) and eight cases from five retained files: 52 cases in total. Tests which execute failure, tenancy, money, persistence, protocol, or startup behavior remain. A unit label alone is not deletion evidence.

## Deleted cases and evidence

SQL text presence cannot prove a constraint, transaction, or rollback works. Exact column-name arrays are change detectors, not persistence tests. Metadata-only module tests repeat decorator configuration without booting the graph. These deletions follow the explicit ban on change-detector tests; they do not claim complete E2E equivalence.

### apps/api/src/database/billing-schema.test.ts

Source/schema change detector. Retained executable checks: `.github/workflows/migration-check.yml` runs `db:check`, `db:migrate`, real PostgreSQL migration suites, and rollback queries. `postgres-billing-ledger.repository.test.ts` exercises idempotent writes, catalog reads, webhook replay, and tenant isolation; `postgres-telephony-incremental.repository.postgres.test.ts` exercises durable telephony. These are not a claim that all historic constraint edge cases have E2E coverage.

- defines tenant-owned customer, immutable catalog, and append-only ledger tables
- defines tenant-owned payment, credit, webhook, and outbox records

### apps/api/src/database/migration-0016-billing.test.ts

Source/schema change detector. Retained executable checks: `.github/workflows/migration-check.yml` runs `db:check`, `db:migrate`, real PostgreSQL migration suites, and rollback queries. `postgres-billing-ledger.repository.test.ts` exercises idempotent writes, catalog reads, webhook replay, and tenant isolation; `postgres-telephony-incremental.repository.postgres.test.ts` exercises durable telephony. These are not a claim that all historic constraint edge cases have E2E coverage.

- creates immutable financial tables and a guarded rollback

### apps/api/src/database/migration-0018-billing-reservations.test.ts

Source/schema change detector. Retained executable checks: `.github/workflows/migration-check.yml` runs `db:check`, `db:migrate`, real PostgreSQL migration suites, and rollback queries. `postgres-billing-ledger.repository.test.ts` exercises idempotent writes, catalog reads, webhook replay, and tenant isolation; `postgres-telephony-incremental.repository.postgres.test.ts` exercises durable telephony. These are not a claim that all historic constraint edge cases have E2E coverage.

- creates reservation tables and rolls them back before the billing foundation

### apps/api/src/database/migration-0023-subscription-reservations.test.ts

Source/schema change detector. Retained executable checks: `.github/workflows/migration-check.yml` runs `db:check`, `db:migrate`, real PostgreSQL migration suites, and rollback queries. `postgres-billing-ledger.repository.test.ts` exercises idempotent writes, catalog reads, webhook replay, and tenant isolation; `postgres-telephony-incremental.repository.postgres.test.ts` exercises durable telephony. These are not a claim that all historic constraint edge cases have E2E coverage.

- adds pinned plan and separate platform risk and reservation state

### apps/api/src/database/migration-0028-billing-release-evidence.test.ts

Source/schema change detector. Retained executable checks: `.github/workflows/migration-check.yml` runs `db:check`, `db:migrate`, real PostgreSQL migration suites, and rollback queries. `postgres-billing-ledger.repository.test.ts` exercises idempotent writes, catalog reads, webhook replay, and tenant isolation; `postgres-telephony-incremental.repository.postgres.test.ts` exercises durable telephony. These are not a claim that all historic constraint edge cases have E2E coverage.

- adds immutable scoped evidence and explicit outbox promotion without data promotion
- ships a guarded rollback that preserves evidence and promoted outbox facts

### apps/api/src/database/migration-0029-billing-charge-promotion.test.ts

Source/schema change detector. Retained executable checks: `.github/workflows/migration-check.yml` runs `db:check`, `db:migrate`, real PostgreSQL migration suites, and rollback queries. `postgres-billing-ledger.repository.test.ts` exercises idempotent writes, catalog reads, webhook replay, and tenant isolation; `postgres-telephony-incremental.repository.postgres.test.ts` exercises durable telephony. These are not a claim that all historic constraint edge cases have E2E coverage.

- adds immutable promotion and drill operation evidence
- ships a guarded rollback that refuses to remove evidence

### apps/api/src/database/migration-0030-billing-release-evidence-integrity.test.ts

Source/schema change detector. Retained executable checks: `.github/workflows/migration-check.yml` runs `db:check`, `db:migrate`, real PostgreSQL migration suites, and rollback queries. `postgres-billing-ledger.repository.test.ts` exercises idempotent writes, catalog reads, webhook replay, and tenant isolation; `postgres-telephony-incremental.repository.postgres.test.ts` exercises durable telephony. These are not a claim that all historic constraint edge cases have E2E coverage.

- adds durable provider evidence and typed drill execution evidence
- ships a guarded rollback and applies it before 0029

### apps/api/src/database/migration-0031-billing-adjustment-evidence-integrity.test.ts

Source/schema change detector. Retained executable checks: `.github/workflows/migration-check.yml` runs `db:check`, `db:migrate`, real PostgreSQL migration suites, and rollback queries. `postgres-billing-ledger.repository.test.ts` exercises idempotent writes, catalog reads, webhook replay, and tenant isolation; `postgres-telephony-incremental.repository.postgres.test.ts` exercises durable telephony. These are not a claim that all historic constraint edge cases have E2E coverage.

- binds adjustment evidence to tenant-qualified ledger and audit facts
- ships a guarded rollback before 0030

### apps/api/src/database/migration-0032-provider-evidence-scope.test.ts

Source/schema change detector. Retained executable checks: `.github/workflows/migration-check.yml` runs `db:check`, `db:migrate`, real PostgreSQL migration suites, and rollback queries. `postgres-billing-ledger.repository.test.ts` exercises idempotent writes, catalog reads, webhook replay, and tenant isolation; `postgres-telephony-incremental.repository.postgres.test.ts` exercises durable telephony. These are not a claim that all historic constraint edge cases have E2E coverage.

- replaces global source identity with tenant catalog cycle identity
- ships a guarded rollback before 0031

### apps/api/src/database/migration-0033-provider-billing-scopes.test.ts

Source/schema change detector. Retained executable checks: `.github/workflows/migration-check.yml` runs `db:check`, `db:migrate`, real PostgreSQL migration suites, and rollback queries. `postgres-billing-ledger.repository.test.ts` exercises idempotent writes, catalog reads, webhook replay, and tenant isolation; `postgres-telephony-incremental.repository.postgres.test.ts` exercises durable telephony. These are not a claim that all historic constraint edge cases have E2E coverage.

- creates an immutable tenant-qualified provider scope table

### apps/api/src/database/migration-0034-provider-scope-tenant-isolation.test.ts

Source/schema change detector. Retained executable checks: `.github/workflows/migration-check.yml` runs `db:check`, `db:migrate`, real PostgreSQL migration suites, and rollback queries. `postgres-billing-ledger.repository.test.ts` exercises idempotent writes, catalog reads, webhook replay, and tenant isolation; `postgres-telephony-incremental.repository.postgres.test.ts` exercises durable telephony. These are not a claim that all historic constraint edge cases have E2E coverage.

- prevents one provider scope from belonging to two tenants

### apps/api/src/database/migration-0035-provider-scope-history.test.ts

Source/schema change detector. Retained executable checks: `.github/workflows/migration-check.yml` runs `db:check`, `db:migrate`, real PostgreSQL migration suites, and rollback queries. `postgres-billing-ledger.repository.test.ts` exercises idempotent writes, catalog reads, webhook replay, and tenant isolation; `postgres-telephony-incremental.repository.postgres.test.ts` exercises durable telephony. These are not a claim that all historic constraint edge cases have E2E coverage.

- allows one tenant to keep scope history and blocks another tenant

### apps/api/src/database/migration-0036-billing-cycles-utc-days.test.ts

Source/schema change detector. Retained executable checks: `.github/workflows/migration-check.yml` runs `db:check`, `db:migrate`, real PostgreSQL migration suites, and rollback queries. `postgres-billing-ledger.repository.test.ts` exercises idempotent writes, catalog reads, webhook replay, and tenant isolation; `postgres-telephony-incremental.repository.postgres.test.ts` exercises durable telephony. These are not a claim that all historic constraint edge cases have E2E coverage.

- blocks existing partial days before it adds the UTC-midnight constraint
- has a rollback that removes only the UTC-day constraint

### apps/api/src/database/schema.test.ts

Source/schema change detector. Retained executable checks: `.github/workflows/migration-check.yml` runs `db:check`, `db:migrate`, real PostgreSQL migration suites, and rollback queries. `postgres-billing-ledger.repository.test.ts` exercises idempotent writes, catalog reads, webhook replay, and tenant isolation; `postgres-telephony-incremental.repository.postgres.test.ts` exercises durable telephony. These are not a claim that all historic constraint edge cases have E2E coverage.

- defines tenant and audit tables in the initial schema
- defines Better Auth core and organization tables for durable tenant signup
- defines Better Auth’s database-backed rate limit table for production auth hardening
- defines normalized telephony tables for provider state and execution history
- ships a durable premium worker ownership lease deadline
- ships durable premium dispatch snapshots and fenced worker ownership forward
- ships the execution-session policy state as an executable migration
- ships additive incremental telephony persistence with an ordered rollback
- rolls lifecycle migration 0010 back before 0009 and verifies legacy inserts in CI
- scopes execution command and call-control event identities by tenant with rollback
- defines pgvector-backed memory embedding storage and index migration
- configures drizzle-kit for postgres migrations
- runs migration checks in CI

### apps/api/src/database/telephony-migration-rollback-chain.test.ts

Source/schema change detector. Retained executable checks: `.github/workflows/migration-check.yml` runs `db:check`, `db:migrate`, real PostgreSQL migration suites, and rollback queries. `postgres-billing-ledger.repository.test.ts` exercises idempotent writes, catalog reads, webhook replay, and tenant isolation; `postgres-telephony-incremental.repository.postgres.test.ts` exercises durable telephony. These are not a claim that all historic constraint edge cases have E2E coverage.

- reverses premium ownership before contracting incremental identities

### apps/api/src/integrations/integrations-runtime.module.test.ts

Metadata-only change detector. Retained `app.module.test.ts` boots the Nest app and serves health/admin HTTP; `pstn-realtime-worker.module.test.ts` compiles the worker dependency graph. Runtime/controller and websocket suites still exercise behavior. Exact internal import/export lists are not a public contract.

- exports runtime integration providers without mounting controllers

### apps/api/src/platform-admin/platform-admin.module-postgres.test.ts

Metadata-only change detector. Retained `app.module.test.ts` boots the Nest app and serves health/admin HTTP; `pstn-realtime-worker.module.test.ts` compiles the worker dependency graph. Runtime/controller and websocket suites still exercise behavior. Exact internal import/export lists are not a public contract.

- imports the shared database provider instead of declaring an independent pool

### apps/api/src/runtime-sessions/premium-realtime-runtime.module.test.ts

Metadata-only change detector. Retained `app.module.test.ts` boots the Nest app and serves health/admin HTTP; `pstn-realtime-worker.module.test.ts` compiles the worker dependency graph. Runtime/controller and websocket suites still exercise behavior. Exact internal import/export lists are not a public contract.

- provides the database dependency for live transport usage recording
- exports premium runtime providers without HTTP or WebSocket controllers

### apps/api/src/sandbox-live-sessions/runtime-agent-tool-execution.module.test.ts

Metadata-only change detector. Retained `app.module.test.ts` boots the Nest app and serves health/admin HTTP; `pstn-realtime-worker.module.test.ts` compiles the worker dependency graph. Runtime/controller and websocket suites still exercise behavior. Exact internal import/export lists are not a public contract.

- exports realtime tool execution without sandbox controllers or bridges
- re-exports tool execution through its owning module
- imports runtime integrations for sandbox-owned grant checks

### apps/api/src/telephony/telephony-live-call-persistence-boundary.test.ts

Duplicate static architecture guard. `scripts/validate-repository-contracts.mjs` still performs the AST boundary check and rejects the same legacy persistence tokens. `telephony-inbound-incremental.test.ts` and PostgreSQL repository tests retain runtime persistence checks.

- keeps whole-tenant snapshot persistence out of every live-call entry point
- does not retain legacy in-memory token or webhook-dedupe snapshot fallbacks

### apps/api/src/workflows/published-workflow-manifest-read.module.test.ts

Metadata-only change detector. Retained `app.module.test.ts` boots the Nest app and serves health/admin HTTP; `pstn-realtime-worker.module.test.ts` compiles the worker dependency graph. Runtime/controller and websocket suites still exercise behavior. Exact internal import/export lists are not a public contract.

- exports durable manifest reads without workflow controllers

### Partial deletions

- `database/migration-0025-subscription-payg-pins.postgres.test.ts`: removed “ships an append-only migration and guarded rollback”. This only proved two files read as strings. The retained same-file PostgreSQL case executes both migration and guarded rollback.
- `database/migration-0026-terminal-billing-recovery.postgres.test.ts`: removed “ships a guarded rollback”. This only checked BEGIN and COMMIT text. Retained same-file SQL execution and PostgreSQL rollback cases test the behavior.
- `realtime-worker/pstn-realtime-worker.module.test.ts`: removed “imports only the controller-free runtime dependencies”, “exposes only the worker health controller”, and “declares worker config and registry providers without control-plane controllers”. These only mirror decorator metadata. Kept real production graph compilation, absent control-plane scheduler checks, worker identity checks, and missing-Redis rejection.
- `database/migration-0027-billing-charge-release.test.ts`: removed “ships a transaction-wrapped rollback that refuses to delete release evidence”. It only searched BEGIN, COMMIT, and an error string. Kept the pg-mem migration execution and production-only environment rejection. The CI rollback job executes SQL.
- `runtime-evals/runtime-evals.test.ts`: removed “keeps runtime evals on a separate Vitest config and npm script” and “keeps PSTN evals on a separate command and config from ordinary tests”. These copied package script strings and searched config text. The separate `eval:runtime` and `eval:pstn` commands remain; fixture execution/scoring tests remain.

## Retained inventory

Each row identifies the file and a retained behavior. Counts are initial direct declarations, not expanded parameterized runtime case counts. Files were retained where no safe deletion or equivalent E2E proof was established. All 13 simulator files remain: protocol validation, identity separation, load approval, redacted artifacts, telemetry, and lifecycle failures are not replaced by a successful smoke call.

| File | Direct cases before edit | Retained behavior / reason |
| --- | ---: | --- |
| `apps/api/src/agents/agents.controller.test.ts` | 9 | guards the instruction review endpoint and uses the authenticated actor |
| `apps/api/src/agents/instruction-improvement.service.test.ts` | 9 | returns a review draft with the original intact and sends only bounded safe context |
| `apps/api/src/ai-judgements/typesafe-client.test.ts` | 8 | sends bounded questions to TypeSafe and returns typed answers and actual usage |
| `apps/api/src/app.module.test.ts` | 2 | boots in test mode and serves the health endpoint |
| `apps/api/src/auth/auth-account-security.controller.test.ts` | 3 | normalizes password reset requests so account existence is not exposed |
| `apps/api/src/auth/auth-context-membership-reader.test.ts` | 1 | loads memberships and active organization from Better Auth tables with one query |
| `apps/api/src/auth/auth-context.controller.test.ts` | 8 | returns a safe signed-out auth context |
| `apps/api/src/auth/auth-invitations.controller.test.ts` | 4 | creates and accepts an existing-user invitation with workspace access and audit context |
| `apps/api/src/auth/auth-mfa.postgres.test.ts` | 3 | allows one verification per TOTP step across instances and preserves proof after restart |
| `apps/api/src/auth/auth-mfa.test.ts` | 1 | grants production authority only after a valid authenticator code |
| `apps/api/src/auth/auth-onboarding.controller.test.ts` | 6 | creates a complete tenant owner onboarding state in one product action |
| `apps/api/src/auth/better-auth.controller.test.ts` | 3 | mounts the Better Auth health endpoint under /api/auth |
| `apps/api/src/auth/better-auth.instance.test.ts` | 6 | uses durable Postgres for local development when DATABASE_URL is configured |
| `apps/api/src/auth/organization-access/organization-access.service.test.ts` | 4 | tracks the organizations a signed-in user belongs to |
| `apps/api/src/auth/organization-model.test.ts` | 1 | mirrors created Better Auth organizations into product tenants |
| `apps/api/src/auth/postgres-auth-rate-limit-storage.test.ts` | 4 | atomically creates one row for concurrent first requests |
| `apps/api/src/auth/tenant-mirror.test.ts` | 1 | upserts Better Auth organizations into the product tenants table |
| `apps/api/src/billing/assemblyai-billing-evidence.source.test.ts` | 1 | fails closed until duration coverage and supplier costs are qualified |
| `apps/api/src/billing/billing-charge-promotion.service.test.ts` | 5 | promotes one selected-tenant event and writes audit evidence |
| `apps/api/src/billing/billing-charge-release-gate.test.ts` | 12 | rejects enabled delivery when no persisted approval and evidence record exists |
| `apps/api/src/billing/billing-charge-reservation.repository.test.ts` | 8 | prevents concurrent PAYG calls from reserving more than paid credit |
| `apps/api/src/billing/billing-customer-state-reconciliation.scheduler.test.ts` | 1 | runs at startup, schedules reconciliation, and stops cleanly |
| `apps/api/src/billing/billing-customer-state-reconciliation.service.test.ts` | 1 | repairs a missed Polar subscription update and later cancellation |
| `apps/api/src/billing/billing-cycle-reconciliation.service.test.ts` | 4 | records an incomplete session audit as a release-blocking mismatch |
| `apps/api/src/billing/billing-daily-reconciliation.scheduler.test.ts` | 4 | runs each configured-catalog tenant cycle with release-bound daily evidence |
| `apps/api/src/billing/billing-mixed-settlement.postgres.test.ts` | 1 | recovers one dollar of usage as 40 prepaid cents and 60 invoice cents without a second debit |
| `apps/api/src/billing/billing-new-usage-delivery.postgres.test.ts` | 1 | preserves the exact database cutoff and never revives earlier decisions |
| `apps/api/src/billing/billing-outbox-observability.test.ts` | 1 | reports low-cardinality delivery and reconciliation metrics with alerts |
| `apps/api/src/billing/billing-payg-call-charge-policy.test.ts` | 2 | calculates a platform call from trusted runtime and connected durations |
| `apps/api/src/billing/billing-payg-eligibility.service.test.ts` | 1 | allows only the tenant with current paid available credit |
| `apps/api/src/billing/billing-payg-reservation-quote.service.test.ts` | 1 | calculates the maximum PAYG call charge from the active catalog |
| `apps/api/src/billing/billing-payment-state-policy.test.ts` | 3 | fails closed for an unknown Polar subscription state |
| `apps/api/src/billing/billing-polar-outbox-control.test.ts` | 1 | does not claim when the owner has not enabled delivery |
| `apps/api/src/billing/billing-polar-outbox.config.test.ts` | 7 | rejects enabled delivery without a Polar access token |
| `apps/api/src/billing/billing-polar-outbox.scheduler.test.ts` | 1 | runs at startup, schedules recurring delivery, and stops cleanly |
| `apps/api/src/billing/billing-polar-outbox.worker.integration.test.ts` | 10 | delivers one due event with its stable external ID and marks it delivered |
| `apps/api/src/billing/billing-production-reconciliation-evidence.test.ts` | 17 | cannot use a shared report as matched tenant-native evidence |
| `apps/api/src/billing/billing-read-model.repository.test.ts` | 4 | returns tenant-qualified subscription, usage, invoice, and PAYG facts |
| `apps/api/src/billing/billing-reconciliation-delivery-scope.postgres.test.ts` | 1 | reads eligibility from the latest stored decision and keeps all usage facts |
| `apps/api/src/billing/billing-reconciliation-evidence.adapters.test.ts` | 1 | loads each server-owned evidence source through its production reader port |
| `apps/api/src/billing/billing-reconciliation-report.repository.test.ts` | 4 | loads the settlement meter and gross carrier amount without changing raw duration |
| `apps/api/src/billing/billing-reconciliation-review-fixes.test.ts` | 12 | keeps gross carrier cents separate from a prepaid carrier remainder |
| `apps/api/src/billing/billing-release-drill-operation-evidence.repository.test.ts` | 5 | reads operation evidence only for the exact tenant, run, release, and catalog |
| `apps/api/src/billing/billing-release-drill-qualification.service.test.ts` | 7 | qualifies every required PAYG and billing drill with machine-readable evidence |
| `apps/api/src/billing/billing-release-drill-report.repository.test.ts` | 4 | stores complete failed evidence and returns it only for the tenant release scope |
| `apps/api/src/billing/billing-runtime-access.service.test.ts` | 2 | blocks platform-managed PSTN as soon as durable payment state is past due |
| `apps/api/src/billing/billing-state.postgres.repository.test.ts` | 1 | round-trips an honest empty tenant state through Postgres |
| `apps/api/src/billing/billing-usage-reconciliation.service.test.ts` | 9 | accepts provider-native facts without comparing provider credits to Zara seconds |
| `apps/api/src/billing/billing.controller.test.ts` | 23 | accepts Polar |
| `apps/api/src/billing/billing.module.test.ts` | 4 | keeps the owner control available when delivery configuration is invalid |
| `apps/api/src/billing/cartesia-billing-evidence.source.test.ts` | 6 | collects provider credits for the API key durably mapped to the tenant |
| `apps/api/src/billing/gemini-cloud-billing-evidence.source.test.ts` | 4 | collects direct Google Cloud Billing facts for the exact tenant project and cycle |
| `apps/api/src/billing/google-bigquery-billing.client.test.ts` | 6 | runs the query with authenticated BigQuery application credentials |
| `apps/api/src/billing/openai-billing-evidence.source.test.ts` | 4 | collects a shared project without a tenant mapping or a customer quantity |
| `apps/api/src/billing/openai-organization-billing.client.test.ts` | 6 | rejects repeated transcription page cursors instead of reading a page twice |
| `apps/api/src/billing/openai-realtime-usage-recorder.test.ts` | 18 | stops after one failed retry and permits later pending work to settle |
| `apps/api/src/billing/openai-transcription-usage-comparison.test.ts` | 8 | retains very small decimal seconds expressed with an exponent |
| `apps/api/src/billing/postgres-billing-charge-promotion.repository.test.ts` | 5 | atomically promotes one pending shadow event and appends evidence |
| `apps/api/src/billing/postgres-billing-charge-release.repository.test.ts` | 2 | reads the persisted production approval and evidence without a default |
| `apps/api/src/billing/postgres-billing-ledger.repository.test.ts` | 22 | returns no billing account for a tenant with no paid billing record |
| `apps/api/src/billing/provider-billing-scope.repository.test.ts` | 2 | returns one tenant-qualified active provider scope and isolates another tenant |
| `apps/api/src/billing/provider-usage-recording.repository.test.ts` | 14 | saves final observed usage with a canonical first receipt time |
| `apps/api/src/billing/shared-provider-billing-evidence.test.ts` | 6 | collects independent transcription HTTP evidence and durable observations without merging completion totals |
| `apps/api/src/billing/shared-provider-usage-comparison.test.ts` | 6 | rejects repeated provider facts instead of doubling a shared total |
| `apps/api/src/billing/tenant-session-billing-audit.test.ts` | 7 | checks a failed call that never connected as zero runtime |
| `apps/api/src/billing/terminal-billing-recovery.module.test.ts` | 1 | registers recovery only in the control-plane BillingModule |
| `apps/api/src/billing/terminal-billing-recovery.scheduler.test.ts` | 1 | retries durable terminal billing jobs at startup and on a bounded interval |
| `apps/api/src/billing/trusted-billing-release-drill-executor.test.ts` | 7 | writes an actor-bound immutable execution record only after a trusted operation succeeds |
| `apps/api/src/billing/trusted-billing-usage-producer.integration.test.ts` | 15 | invoices only 60 cents after included runtime and 40 prepaid cents, once |
| `apps/api/src/billing/trusted-call-commercial-mode-resolver.test.ts` | 1 | resolves durable commercial mode with current available allowance |
| `apps/api/src/billing/trusted-payg-active-call-funding.service.test.ts` | 6 | funds only a next safe segment covered by the active pinned reservation |
| `apps/api/src/billing/trusted-payg-call-lifecycle.service.test.ts` | 1 | reserves before provider start and releases the claim when start fails |
| `apps/api/src/billing/trusted-payg-terminal-finalization.service.test.ts` | 5 | finalizes one catalog-backed actual PAYG charge and releases unused credit |
| `apps/api/src/billing/trusted-subscription-call-lifecycle.service.test.ts` | 22 | atomically reserves included runtime before the lower approved overage allowance |
| `apps/api/src/billing/trusted-terminal-billing-recovery.service.test.ts` | 6 | persists pinned terminal facts before effects and completes a partial job after restart |
| `apps/api/src/billing/twilio-billing-evidence.source.test.ts` | 7 | collects tenant-cycle Twilio call duration and cost through linked CallSid records |
| `apps/api/src/billing/twilio-call-billing.client.test.ts` | 3 | reads provider-owned duration, cost, time, and identity from the authenticated Call resource |
| `apps/api/src/compliance/compliance.controller.test.ts` | 4 | exposes general SaaS compliance readiness without regulated-data claims |
| `apps/api/src/config/auth-cookie-origin.test.ts` | 3 | rejects a production API URL on a different site from the tenant app origin |
| `apps/api/src/config/trusted-origins.test.ts` | 3 | adds deployment-specific browser origins for API CORS and Better Auth |
| `apps/api/src/database/migration-0012-rolling.postgres.test.ts` | 4 | keeps the legacy dedupe table writable through migration and rollback |
| `apps/api/src/database/migration-0022-billing-reservation-catalog-pin.postgres.test.ts` | 1 | keeps legacy rows explicit and requires immutable pins on new rows |
| `apps/api/src/database/migration-0023-subscription-reservations.postgres.test.ts` | 1 | enforces the production reservation keys and non-negative claims |
| `apps/api/src/database/migration-0024-billing-reservation-charge-context.postgres.test.ts` | 1 | requires immutable context pins and runs the guarded rollback when unused |
| `apps/api/src/database/migration-0025-subscription-payg-pins.postgres.test.ts` | 2 | ships an append-only migration and guarded rollback |
| `apps/api/src/database/migration-0026-terminal-billing-recovery.postgres.test.ts` | 3 | ships a guarded rollback |
| `apps/api/src/database/migration-0027-billing-charge-release.test.ts` | 2 | creates an empty fail-closed production release control table |
| `apps/api/src/database/migration-0030-billing-release-evidence-integrity.postgres.test.ts` | 2 | aborts clearly before ALTER when pre-0030 drill evidence exists |
| `apps/api/src/database/migration-0037-provider-usage-recording.postgres.test.ts` | 2 | deduplicates concurrent observed responses and rejects a changed tenant |
| `apps/api/src/database/migration-0038-provider-usage-connections.postgres.test.ts` | 2 | permits empty rollback but refuses to remove an unresolved connection |
| `apps/api/src/database/migration-0039-provider-usage-attribution.postgres.test.ts` | 4 | saves concurrent final usage once and rejects changed results and scope |
| `apps/api/src/database/migration-0040-runtime-prompt-policy-revisions.postgres.test.ts` | 2 | allows one concurrent expected-version write and keeps revisions immutable |
| `apps/api/src/entrypoint.test.ts` | 3 | treats a Windows argv path as the current module entry |
| `apps/api/src/health/health.controller.test.ts` | 3 | keeps liveness independent from Redis readiness |
| `apps/api/src/integrations/connector-tools.collaboration.contract.test.ts` | 3 | executes Notion search and page creation through server-owned Notion API contracts |
| `apps/api/src/integrations/connector-tools.commerce.contract.test.ts` | 2 | executes Shopify read-only commerce lookups through curated Admin GraphQL contracts |
| `apps/api/src/integrations/connector-tools.confluence.contract.test.ts` | 1 | executes Confluence knowledge imports through documented Cloud REST API paths |
| `apps/api/src/integrations/connector-tools.crm-calendar.contract.test.ts` | 7 | executes HubSpot contact lookup through the server-owned CRM search contract |
| `apps/api/src/integrations/connector-tools.failure-health.test.ts` | 2 | preserves the connector failure when health persistence is read-only |
| `apps/api/src/integrations/connector-tools.knowledge.contract.test.ts` | 3 | executes SharePoint knowledge imports through documented Microsoft Graph drive item paths |
| `apps/api/src/integrations/connector-tools.salesforce.contract.test.ts` | 1 | executes Salesforce support and sales tools through curated server-owned REST contracts |
| `apps/api/src/integrations/connector-tools.schemas.contract.test.ts` | 4 | exposes endpoint-aligned agent-facing connector schemas |
| `apps/api/src/integrations/connector-tools.zendesk.contract.test.ts` | 4 | executes Zendesk ticket create through the server-owned Tickets API contract |
| `apps/api/src/integrations/integrations.catalog.controller.test.ts` | 15 | requires tenant membership for tenant integration routes |
| `apps/api/src/integrations/integrations.execution.controller.test.ts` | 4 | executes typed Zendesk ticket tools and returns retryable rate-limit errors |
| `apps/api/src/integrations/integrations.lifecycle.controller.test.ts` | 11 | creates Zendesk tickets through the documented Tickets API endpoint and payload |
| `apps/api/src/integrations/integrations.persistence.test.ts` | 2 | persists OAuth connections across service instances and encrypts provider tokens at rest |
| `apps/api/src/integrations/integrations.tenant-isolation.controller.test.ts` | 1 | does not expose integration connections webhook tools or tool grants across tenants |
| `apps/api/src/integrations/tool-permission-grants.service.test.ts` | 20 | stores connector tool grants with concrete agentId scopes |
| `apps/api/src/memory/knowledge-sync-safety.test.ts` | 3 | labels sensitive extracted knowledge and blocks obvious runtime secrets |
| `apps/api/src/memory/memory.ingestion-privacy.controller.test.ts` | 1 | enforces memory privacy retention export and tenant delete controls |
| `apps/api/src/memory/memory.knowledge.controller.test.ts` | 4 | stores tenant policies and FAQs with traceable sources filtered by published workflow |
| `apps/api/src/memory/memory.persistence.test.ts` | 3 | persists opt-in caller and account memories across service instances |
| `apps/api/src/memory/memory.provider-import-safety.controller.test.ts` | 7 | degrades provider recurring sync on auth failure without deleting active knowledge |
| `apps/api/src/memory/memory.provider-imports.controller.test.ts` | 3 | imports Intercom Articles through review-gated knowledge-source grants and daily refreshes |
| `apps/api/src/memory/memory.provider-refresh.controller.test.ts` | 3 | degrades Salesforce Knowledge refresh failures and review-gates Freshdesk source deletions |
| `apps/api/src/memory/memory.records.controller.test.ts` | 8 | requires tenant membership for tenant memory routes |
| `apps/api/src/memory/memory.typesafe.test.ts` | 17 | copies a supported caller fact with its source ID and assessment |
| `apps/api/src/memory/memory.website-sources.controller.test.ts` | 6 | crawls website sources inside the allowed root while surfacing skipped and failed page statuses |
| `apps/api/src/persistence/tenant-json-state.repository.test.ts` | 3 | loads, normalizes, saves, and lists tenant JSON snapshots through one adapter |
| `apps/api/src/persistence/tenant-status.repository.test.ts` | 5 | returns missing only for the requested tenant |
| `apps/api/src/platform-admin/platform-admin-billing-delivery.postgres.test.ts` | 1 | saves an owner decision, retries it without moving the cutoff, and stops despite invalid configuration |
| `apps/api/src/platform-admin/platform-admin.controller-durable-status.test.ts` | 1 | awaits durable organization list and detail reads before it builds the response |
| `apps/api/src/platform-admin/platform-admin.controller.test.ts` | 10 | rejects tenant admins and allows platform staff to load the dashboard |
| `apps/api/src/platform-admin/platform-admin.service.test.ts` | 5 | projects the live recorder snapshot into staff runtime observability |
| `apps/api/src/platform-admin/platform-billing-read.repository.test.ts` | 6 | returns tenant-qualified billing facts and an explicit no-data state |
| `apps/api/src/platform-admin/platform-billing-read.service.test.ts` | 5 | disables platform billing-control mutation without a durable atomic writer |
| `apps/api/src/premium-realtime-policy/premium-realtime-conversation-policy.resolver.test.ts` | 2 | uses the versioned channel default when no platform agent override exists |
| `apps/api/src/premium-realtime-policy/premium-realtime-conversation-policy.service.test.ts` | 4 | defaults premium realtime to OpenAI gpt-realtime-2.1 with channel-specific provider turn policy |
| `apps/api/src/production-esm-imports.test.ts` | 1 | emits Node-resolvable relative JavaScript specifiers |
| `apps/api/src/provider-benchmarks/provider-benchmarks.test.ts` | 13 | skips unconfigured providers, normalizes results, writes redacted artifacts, and summarizes latency |
| `apps/api/src/realtime-worker/pstn-premium-finalization-reconciler.test.ts` | 5 | reconciles one bounded batch on startup and emits the durable outcome |
| `apps/api/src/realtime-worker/pstn-premium-worker-availability.test.ts` | 9 | returns unavailable when no compatible ready worker has capacity |
| `apps/api/src/realtime-worker/pstn-realtime-worker-config.test.ts` | 4 | resolves the explicit bounded worker environment |
| `apps/api/src/realtime-worker/pstn-realtime-worker-health.controller.test.ts` | 3 | exposes the expected liveness and readiness routes |
| `apps/api/src/realtime-worker/pstn-realtime-worker-host.test.ts` | 5 | projects active, starting, and bounded available slots from one snapshot |
| `apps/api/src/realtime-worker/pstn-realtime-worker-lifecycle.test.ts` | 9 | projects a fixed low-cardinality posture and clamps unbounded probes |
| `apps/api/src/realtime-worker/pstn-realtime-worker-registry.test.ts` | 3 | publishes a strict heartbeat and its TTL atomically |
| `apps/api/src/realtime-worker/pstn-realtime-worker.module.test.ts` | 6 | imports only the controller-free runtime dependencies |
| `apps/api/src/realtime-worker/realtime-worker.main.test.ts` | 2 | initializes observability, enables SIGTERM shutdown, and listens on the worker port |
| `apps/api/src/runtime-evals/runtime-eval-executor.test.ts` | 3 | executes fixture inputs without reading expected answers |
| `apps/api/src/runtime-evals/runtime-evals.test.ts` | 12 | loads versioned packet fixture suites without raw sensitive data |
| `apps/api/src/runtime-observability/pstn-capacity-observability.test.ts` | 13 | emits bounded admission outcome, latency, allowance, and lease metrics |
| `apps/api/src/runtime-observability/runtime-observability.test.ts` | 12 | records agent action origin without inventing a confidence score |
| `apps/api/src/runtime-prompt-policy/runtime-prompt-policy.model-defaults.test.ts` | 3 | fills missing runtime provider fields from platform agent class defaults |
| `apps/api/src/runtime-prompt-policy/runtime-prompt-policy.repository.test.ts` | 3 | keeps immutable revisions and rejects a stale expected version |
| `apps/api/src/runtime-prompt-policy/runtime-prompt-policy.service.test.ts` | 7 | selects an immutable revision with a stable hash |
| `apps/api/src/runtime-route-policy/runtime-route-policy.repository.test.ts` | 1 | persists runtime route policy across repository instances |
| `apps/api/src/runtime-sessions/premium-realtime-agent-prompt.test.ts` | 3 | keeps platform, specialist, tenant, and language instructions in separate sections |
| `apps/api/src/runtime-sessions/premium-realtime-provider-endpoint.test.ts` | 3 | rejects simulator transport in production |
| `apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts` | 28 | stops provider work while retrying one retained usage event after a database failure |
| `apps/api/src/runtime-sessions/premium-realtime-tool-loop.service.test.ts` | 3 | executes docs-style OpenAI response.done tool calls and returns identified continuation messages |
| `apps/api/src/runtime-sessions/runtime-sessions.controller.test.ts` | 3 | creates a premium realtime session server-side |
| `apps/api/src/runtime-sessions/runtime-sessions.module.test.ts` | 1 | runs the premium simulator production guard during provider startup |
| `apps/api/src/runtime-sessions/runtime-sessions.service-handoff-safety.test.ts` | 8 | hydrates provider connector schemas after an OpenAI handoff |
| `apps/api/src/runtime-sessions/runtime-sessions.service-handoff.test.ts` | 13 | does not wait for a pending shadow assessment before accepting a handoff |
| `apps/api/src/runtime-sessions/runtime-sessions.service-policy.test.ts` | 8 | creates handoff-capable premium sessions with normal tools plus an internal handoff tool |
| `apps/api/src/runtime-sessions/runtime-sessions.websocket-access-tools.test.ts` | 5 | requires a single-use transport token before premium provider attachment |
| `apps/api/src/runtime-sessions/runtime-sessions.websocket-handoff-routing.test.ts` | 3 | handles OpenAI handoff-capable turns before sending an explicit provider response |
| `apps/api/src/runtime-sessions/runtime-sessions.websocket-media-projection.test.ts` | 9 | resamples premium OpenAI browser microphone audio to provider PCM before forwarding |
| `apps/api/src/runtime-sessions/runtime-sessions.websocket-provider-lifecycle.test.ts` | 3 | waits for provider setup acknowledgement before reporting the premium session ready |
| `apps/api/src/sandbox-live-sessions/agent-action-response-schema.test.ts` | 4 | uses an object root and keeps optional inputs nullable |
| `apps/api/src/sandbox-live-sessions/assemblyai-streaming.adapter.test.ts` | 5 | builds a server-owned streaming session contract for AssemblyAI |
| `apps/api/src/sandbox-live-sessions/assemblyai-stt.provider.test.ts` | 16 | reports readiness only after the provider confirms its session |
| `apps/api/src/sandbox-live-sessions/cartesia-streaming.adapter.test.ts` | 6 | builds a server-owned Cartesia websocket session contract |
| `apps/api/src/sandbox-live-sessions/cartesia-stt.adapter.test.ts` | 3 | builds the Ink 2 turn-detection websocket contract |
| `apps/api/src/sandbox-live-sessions/cartesia-stt.provider.test.ts` | 5 | maps Ink 2 turn events into live STT callbacks |
| `apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts` | 10 | sends a Sonic 3.5 generation request and returns the streamed audio chunks |
| `apps/api/src/sandbox-live-sessions/gemini-chat-text.provider.test.ts` | 4 | posts a Gemini generateContent request and yields the returned text |
| `apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts` | 11 | creates a server-owned websocket session and setup message for native audio |
| `apps/api/src/sandbox-live-sessions/openai-chat-text.provider.test.ts` | 9 | keeps a failed provider request unresolved |
| `apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts` | 17 | declares Zara tools in the OpenAI Realtime session update |
| `apps/api/src/sandbox-live-sessions/pstn-premium-realtime-provider-loop.test.ts` | 3 | executes OpenAI native function calls through the PSTN executeToolCall callback |
| `apps/api/src/sandbox-live-sessions/runtime-agent-tool-executor.service.test.ts` | 8 | skips execution when required provider input is missing |
| `apps/api/src/sandbox-live-sessions/sandbox-intent-classifier.provider.test.ts` | 2 | calls the configured Gemini intent model and parses structured JSON |
| `apps/api/src/sandbox-live-sessions/sandbox-live-env.test.ts` | 2 | reads sandbox provider credentials and model overrides from env |
| `apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts` | 16 | walks condition routes before selecting the responding agent |
| `apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts` | 34 | records streaming usage with the server-owned sandbox tenant and session |
| `apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts` | 6 | resolves webhook HTTP secret references inside the runtime before executing a tool |
| `apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket-access-security.test.ts` | 5 | streams session events to a valid transport token |
| `apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket-agent-actions.test.ts` | 6 | does not execute assigned live tools unless the agent requests them |
| `apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket-tool-policy.test.ts` | 12 | returns a structured skipped result when an agent-requested tool is missing required input |
| `apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket-voice-runtime.test.ts` | 13 | runs a voice turn through routing, model, and audio events |
| `apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts` | 3 | marks post-send write timeouts as unknown outcomes |
| `apps/api/src/sandbox-live-sessions/sandbox-text-model-prompts.test.ts` | 7 | uses configured agent identity and never hardcodes Zara as the agent name |
| `apps/api/src/sandbox-live-sessions/sandbox-text-model-provider-factory.test.ts` | 3 | records OpenAI usage through the configured router |
| `apps/api/src/sandbox-live-sessions/sandbox-text-model-router.provider.test.ts` | 7 | resolves the actual model using the same defaults and tier as the request |
| `apps/api/src/sandbox-live-sessions/typesafe-intent-classifier.provider.test.ts` | 5 | returns only configured branch facts and keeps graph targets out of the request |
| `apps/api/src/sandbox-live-sessions/typesafe-runtime-evaluator.test.ts` | 3 | judges handoff fit, refusal, and summary support from redacted permitted evidence |
| `apps/api/src/security/one-time-stream-token.test.ts` | 3 | verifies scoped signed tokens and rejects expired or mismatched tokens |
| `apps/api/src/telephony/in-memory-pstn-call-admission.test.ts` | 14 | closes new admission when an effective concurrency limit is zero |
| `apps/api/src/telephony/postgres-telephony-incremental.repository.postgres.test.ts` | 22 | serializes a same-key call setup retry without duplicate rows |
| `apps/api/src/telephony/postgres-telephony-incremental.repository.test.ts` | 30 | deduplicates provider events with explicit retry and conflict outcomes |
| `apps/api/src/telephony/postgres-telephony-state.repository.test.ts` | 9 | round-trips tenant telephony state through normalized Postgres tables |
| `apps/api/src/telephony/premium-provider-message-pressure.test.ts` | 2 | rejects one oversized message without reserving control-queue capacity |
| `apps/api/src/telephony/premium-pstn-dispatch-snapshot-resolver.test.ts` | 2 | freezes the exact manifest defaults and conversation policy used by a premium dispatch |
| `apps/api/src/telephony/premium-pstn-worker-requirements.test.ts` | 3 | includes provider overrides for every route-reachable agent |
| `apps/api/src/telephony/pstn-admission-config.test.ts` | 4 | requires Redis in production and keeps the provisional global cap at 20 |
| `apps/api/src/telephony/pstn-admission-coordinator.test.ts` | 30 | builds one bounded admission input and reuses its deterministic identity |
| `apps/api/src/telephony/pstn-admission-redis-client.test.ts` | 5 | registers an error listener and delegates one atomic evaluation |
| `apps/api/src/telephony/pstn-admission.module.test.ts` | 4 | provides the deterministic in-memory coordinator outside production |
| `apps/api/src/telephony/pstn-call-admission.test.ts` | 3 | exports the standard dependency-injection token |
| `apps/api/src/telephony/pstn-media-process-role.test.ts` | 6 | defaults the API artifact to sandwich-only media ownership |
| `apps/api/src/telephony/pstn-premium-call-actor.test.ts` | 16 | returns from start before readiness and flushes bounded startup media in order after readiness |
| `apps/api/src/telephony/pstn-premium-call-execution-durability-shutdown.test.ts` | 15 | carries the immutable worker ownership fence through every lifecycle mutation |
| `apps/api/src/telephony/pstn-premium-call-execution-handoff.test.ts` | 6 | waits for acknowledged source playback before replacing an immutable OpenAI voice session |
| `apps/api/src/telephony/pstn-premium-call-execution-interruptions-terminal.test.ts` | 9 | processes caller interruption without waiting for connector work |
| `apps/api/src/telephony/pstn-premium-call-execution-media-provider.test.ts` | 17 | streams Twilio mu-law media through the OpenAI premium session and returns PSTN-ready audio |
| `apps/api/src/telephony/pstn-premium-call-execution-startup-failures.test.ts` | 8 | does not end capacity when installed startup terminal persistence fails |
| `apps/api/src/telephony/pstn-premium-call-execution.wiring.test.ts` | 1 | resolves service dependencies through their module provider tokens |
| `apps/api/src/telephony/pstn-premium-ingress-admission.test.ts` | 1 | admits aggregate resident payload bytes and releases them exactly once |
| `apps/api/src/telephony/pstn-premium-playback-admission.test.ts` | 1 | bounds aggregate queued playback bytes and releases each reservation exactly once |
| `apps/api/src/telephony/pstn-premium-playback-controller.test.ts` | 15 | reports whether an interruption actually cleared owned playback |
| `apps/api/src/telephony/pstn-provider-usage-attribution.test.ts` | 3 | keeps the verified call identity on initial and replacement provider connections |
| `apps/api/src/telephony/pstn-sandwich-call-execution.test.ts` | 90 | finishes call stop while an opening speech socket is still closing |
| `apps/api/src/telephony/redis-pstn-call-admission.redis.test.ts` | 11 | does not oversubscribe the global limit across clients |
| `apps/api/src/telephony/redis-pstn-call-admission.test.ts` | 12 | reserves atomically with one hash tag and no raw opaque identifiers |
| `apps/api/src/telephony/telephony-env.test.ts` | 2 | parses the active key version and legacy telephony credential keys from env |
| `apps/api/src/telephony/telephony-inbound-incremental.test.ts` | 70 | durably records and atomically establishes an incoming call without a snapshot save |
| `apps/api/src/telephony/telephony-payg-live-start.integration.test.ts` | 9 | blocks premium PAYG when active reservations exhaust the paid credit |
| `apps/api/src/telephony/telephony-shutdown.lifecycle.test.ts` | 2 | finishes admission cleanup after API media shutdown fails |
| `apps/api/src/telephony/telephony.controller-connection-webhooks.test.ts` | 11 | requires tenant membership for telephony control routes and derives the actor from tenant auth |
| `apps/api/src/telephony/telephony.controller-operations-isolation.test.ts` | 2 | supports provider heartbeats, loopback test calls, and credential rotation for telephony operations |
| `apps/api/src/telephony/telephony.controller-outbound-policy.test.ts` | 5 | rejects invalid Twilio signatures and allows tenant web origins to preflight telephony routes |
| `apps/api/src/telephony/telephony.controller-premium-phone-test.test.ts` | 6 | creates premium realtime PSTN test routes and carries the premium runtime path into Twilio media |
| `apps/api/src/telephony/telephony.controller-runtime-policy.test.ts` | 1 | does not expose tenant-authoritative runtime policy |
| `apps/api/src/telephony/telephony.controller-tenant-status.test.ts` | 0 | Executable boundary coverage; no equivalent E2E proved |
| `apps/api/src/telephony/telephony.persistence.test.ts` | 9 | persists tenant telephony state across service instances and keeps webhook dedupe after restart |
| `apps/api/src/telephony/trusted-payg-telephony-call-start.service.test.ts` | 2 | blocks platform-managed inbound PAYG before provider admission |
| `apps/api/src/telephony/twilio-media-streams.bridge.test.ts` | 5 | renders Twilio Stream TwiML with custom parameters instead of query parameters |
| `apps/api/src/telephony/twilio-media-streams.websocket.test.ts` | 33 | records a runtime-completed standard call as completed after acknowledged goodbye audio |
| `apps/api/src/telephony/twilio-number-inventory.provider.test.ts` | 2 | lists incoming phone numbers from Twilio and normalizes voice capabilities |
| `apps/api/src/telephony/twilio-number-routing.provider.test.ts` | 8 | configures an imported Twilio number to call the Zara webhook |
| `apps/api/src/voice-library/voice-library.service.test.ts` | 6 | lists safe selectable Cartesia voice metadata without exposing provider voice ids |
| `apps/api/src/workflows/postgres-published-workflow-manifest.repository.test.ts` | 1 | round-trips an immutable manifest with tenant-scoped lookup |
| `apps/api/src/workflows/workflows.controller.test.ts` | 6 | requires tenant membership and records the signed-in actor when publishing workflows |
| `apps/api/src/workflows/workflows.service.test.ts` | 1 | stores and resolves the exact compiled manifest produced by publish |
| `apps/api/src/workspaces/workspaces.controller.test.ts` | 5 | requires tenant membership and records the signed-in actor for workspace mutations |
| `apps/pstn-protocol-simulator/src/capacity-telemetry-client.test.ts` | 2 | reads the staff posture with secret headers kept outside the result |
| `apps/pstn-protocol-simulator/src/load-config.test.ts` | 4 | loads tenant secrets from an external file and keeps release execution approval explicit |
| `apps/pstn-protocol-simulator/src/load-driver.test.ts` | 6 | maps load scenarios to simulator behavior and scenario-specific routes |
| `apps/pstn-protocol-simulator/src/load-profiles.test.ts` | 3 | pins the release step curve and complete scenario catalog |
| `apps/pstn-protocol-simulator/src/load-report-writer.test.ts` | 1 | atomically retains a machine-readable report under a bounded safe filename |
| `apps/pstn-protocol-simulator/src/load-report.test.ts` | 2 | serializes the typed report without credential, caller, token, transcript, or media fields |
| `apps/pstn-protocol-simulator/src/load-runner.test.ts` | 14 | emits report metadata, percentiles, resource shape, traffic, and passing SLOs |
| `apps/pstn-protocol-simulator/src/openai-realtime-server.test.ts` | 10 | requires authentication when binding outside loopback |
| `apps/pstn-protocol-simulator/src/openai-realtime-simulator.test.ts` | 2 | models readiness, caller turns, audio, transcript, and completion deterministically |
| `apps/pstn-protocol-simulator/src/smoke-identities.test.ts` | 1 | creates unique Twilio call and stream SIDs across scenarios and runs |
| `apps/pstn-protocol-simulator/src/smoke-output.test.ts` | 1 | does not print provider-controlled error text |
| `apps/pstn-protocol-simulator/src/twilio-protocol.test.ts` | 4 | signs the exact form webhook and extracts a queryless stream token |
| `apps/pstn-protocol-simulator/src/twilio-virtual-caller.test.ts` | 17 | posts a signed webhook and runs the bidirectional media protocol |

## Validation

- Final changed-file check: `npm exec -- vitest run --config vitest.api.config.ts --maxWorkers=1 apps/api/src/database/migration-0025-subscription-payg-pins.postgres.test.ts apps/api/src/database/migration-0026-terminal-billing-recovery.postgres.test.ts apps/api/src/database/migration-0027-billing-charge-release.test.ts apps/api/src/realtime-worker/pstn-realtime-worker.module.test.ts apps/api/src/runtime-evals/runtime-evals.test.ts` passed: 4 files passed, 1 skipped; 15 tests passed, 2 PostgreSQL tests skipped. Duration 98.05 seconds.
- `git diff --check -- apps/api docs/testing-audit/api.md` passed.
- First unbounded API run was cancelled because parallel test work caused resource contention; it has no complete result.
- `npm run test:api -- --maxWorkers=1 --reporter=dot` passed: 234 files passed, 17 skipped (251 total); 1836 tests passed, 69 skipped (1905 total). Exit 0; duration 1237.83 seconds. PostgreSQL/Redis integration cases without configured test URLs remain skipped, not passed. The final changed-file run above also passed after all deletions were applied.
- Full API tests appended synthetic telephony audit entries to the tracked local fixture `.zara/audit/tenant-west-africa.json`. Removed only the verified test append after the run; retained the original audit history.
- No new tests were added. Real PostgreSQL/Redis cases require explicit test-service URLs. Skipped cases are not passes.

## Remaining risk

Source checks were not proof that real migrations enforce all financial and tenant constraints. Existing executable checks stay in place. Additional behavior coverage requires a documented failure gap, not a replacement snapshot for each removed test.
