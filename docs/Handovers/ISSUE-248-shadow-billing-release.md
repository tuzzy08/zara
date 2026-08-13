# ISSUE-248: Shadow billing qualification and controlled charge release

External: [Linear ZAR-269](https://linear.app/zara-voice/issue/ZAR-269/run-shadow-billing-reconcile-draft-invoices-and-release-real-charges)

## Status

Blocked. Direct provider evidence is implemented for Twilio, Cartesia, OpenAI, and Gemini. AssemblyAI duration evidence and real deployment evidence are still required before charge delivery can start.

Linear ZAR-269 remains In Progress because the Zara team has no Blocked workflow state. It has the `ready-for-human` label and a comment that records the external blockers.

## Work Completed

- Created the Linear issue and local backlog record.
- Defined shadow billing, daily reconciliation, canary, rollback, correction, refund, alert, and go/no-go scope.
- Implemented a fail-closed charge-release gate with separate billing, security, and release approvals, evidence freshness and scope checks, tenant consent, and internal and selected-tenant canary requirements.
- Implemented release-scoped shadow-event promotion. Promotion and its audit record use one transaction and exact replay checks.
- Implemented daily tenant-cycle reconciliation with append-only matched and mismatched reports, signed adjustments, refund/reversal checks, provider, Polar, invoice, PAYG, ledger, and outbox evidence, and mismatch ownership.
- Implemented authenticated Polar meter, order, and PAYG customer-state evidence. The PAYG balance uses the catalog-mapped `payg_charge_minor` active meter and has no Zara-derived fallback.
- Connected Twilio to the independent evidence collector with existing encrypted tenant credentials. It lists provider Calls by tenant-owned number and cycle, reconciles provider and local CallSid sets in both directions, and stores provider duration, price, and immutable source IDs.
- Removed the unverified Zara billing-report URL, token, and public-key contract.
- Added direct Cartesia usage access with an official admin API key and a durable tenant-to-API-key mapping.
- Added direct OpenAI organization usage and cost access with an OpenAI Admin API key and a durable tenant-to-project mapping.
- Added direct Gemini cost evidence from Google Cloud Billing BigQuery export with Application Default Credentials and a durable tenant-to-project, billing-account, view, service, and SKU mapping.
- Added migrations 0033 through 0035 for tenant-to-provider billing scopes, exclusive provider-scope ownership, normalized identities, and safe scope history.
- Kept AssemblyAI evidence closed. Zara does not yet persist the provider Termination event field `session_duration_seconds`.
- Added provider-native reconciliation for Cartesia credits, OpenAI tokens, requests and costs, and Gemini billing-export costs. Zara does not convert these units to runtime seconds. Missing or invalid native facts create a critical mismatch.
- Enforced full-day subscription cycles. Both cycle boundaries and the subscription period end must be 00:00 UTC. The subscription period end must equal the active cycle end. A partial-day stored cycle is not eligible for billing.
- Added catalog-scoped, tenant/cycle provider-report identity. Migration 0032 guards old unscoped evidence and replaces the global provider/report key.
- Implemented trusted typed drill handlers for zero-balance stop, invoice dispute, rollback, charge stop, and release-signal observation. The handlers use tenant/source-constrained mutations and independent durable readback.
- Bound adjustment drill evidence to the original ledger entry, adjustment ledger entry, and canonical audit record. Adjustment and audit writes are atomic and replay-verified.
- Added migrations 0027 through 0036, snapshots, guarded rollbacks, CI order, immutable evidence controls, upgrade guards, and release runbooks. Migration 0036 rejects existing partial-day billing cycles and does not round them.
- Kept automatic usage-charge delivery off with `BILLING_CHARGE_DELIVERY_ENABLED=false`. This flag does not disable subscription checkout or the $5 PAYG checkout. No approval, canary, or release evidence was fabricated.
- Completed an independent final review with no actionable local findings.

## Tests Run

- Release, reconciliation, drill, module, worker, and migration focused suites passed throughout the TDD slices.
- Final drill regression: 7 files, 49 tests passed.
- Final Polar PAYG writer/reader/qualification set: 4 files, 27 tests passed.
- Final independent review verification: 3 files, 31 tests passed.
- Release migration and module group: 54 tests passed; 2 real-PostgreSQL tests skipped locally and registered in CI.
- Final provider-evidence merged suite: 7 files, 47 tests passed.
- Final Twilio provider-population and cycle-boundary suite: 3 files, 25 tests passed.
- Final runtime evidence suite: 24 tests passed.
- Provider evidence migration 0032: 2 tests passed.
- API type-check passed.
- Direct-provider and scope tests: 40 tests passed.
- Migration 0033 test passed.
- Final direct-provider, reconciliation, module, and migration group: 13 files and 61 tests passed.
- Final provider-native reconciliation group: 4 files and 28 tests passed.
- Final full-day lifecycle, commercial-mode, and migration group: 3 files and 26 tests passed; 3 PostgreSQL-only tests skipped locally.
- Final independent safety review: 8 files and 73 tests passed; 3 PostgreSQL-only tests skipped locally. No actionable finding remained.
- API type-check passed after the final review fixes.
- Database generation reported no schema drift after migration 0036.
- `db:generate` generated migration 0033 from the current schema.
- `git diff --check` passed with workspace line-ending warnings only.

## Pending Work

- Set `CARTESIA_ADMIN_API_KEY` and `OPENAI_ADMIN_KEY` in the control-plane secret store when these providers are used.
- Configure Google Application Default Credentials and Cloud Billing BigQuery export for Gemini evidence.
- Insert tenant-qualified provider scope rows in `billing_provider_tenant_scopes`.
- Persist AssemblyAI Termination `session_duration_seconds` with tenant and session identity before AssemblyAI can qualify standard runtime.
- Run one completed-cycle reconciliation and fix every release-blocking mismatch.
- Run the controlled Polar sandbox qualification.
- Run the internal tenant canary and the selected, consented tenant canary.
- Record separate billing, security, and release approvals with their evidence IDs.
- Keep charge delivery disabled until every gate above passes.

## Risks

- A correct event count can still produce a wrong invoice when meter or price configuration is wrong.
- Charge delivery must stop safely without losing usage facts.
- Direct provider evidence remains incomplete until deployment credentials, tenant mappings, Google billing export, and AssemblyAI duration capture exist. This blocks release by design.
- Real-PostgreSQL upgrade tests require the configured CI PostgreSQL URL and were skipped in the local environment.

## Decisions

- Real charges require recorded go/no-go approval.
- Shadow billing must complete before any customer charge is enabled.
- PAYG release evidence must include top-up, grant, reservation, debit, refund, reversal, and zero-balance stop checks.
- No local state, caller-provided JSON, or Zara ledger value can substitute for required external provider or Polar evidence.
- Missing evidence, stale evidence, cross-tenant evidence, changed replay data, and incomplete drill state fail closed.

## Next Recommended Step

Configure the direct provider credentials and tenant mappings. Add AssemblyAI duration capture. Then run a completed-cycle reconciliation, the Polar sandbox, the internal tenant canary, and the selected-tenant canary. Record all three approvals only after all checks pass. Keep automatic usage-charge delivery disabled until then.
