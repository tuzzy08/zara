# Billing Charge Release Gate

## Purpose

This runbook controls the first production charge release and an emergency charge stop. Charge delivery must stay disabled until the release owner, billing owner, and security owner approve the same production candidate.

## Required Evidence

The `billing_charge_release_controls` table must contain one production record. Its foreign keys must bind immutable rows from `billing_charge_release_approvals`, `billing_release_canary_reports`, `billing_reconciliation_reports`, and `billing_release_drill_reports` to the exact `POLAR_BILLING_CATALOG_ID` and `ZARA_RELEASE_ID` values in the API deployment.

The record must contain:

- separate current billing, security, and release-owner approval records;
- a passed internal-tenant canary report with its tenant ID;
- a passed selected-tenant canary report with a separate tenant ID and consent evidence ID;
- a matched reconciliation report for the selected tenant;
- a passed drill report for the selected tenant, including rollback and charge-stop drills;
- `delivery_stopped = false` only after all named owners approve release.

Do not copy evidence from another catalog, release, tenant, or environment. Evidence and approval rows are append-only. Do not extend an expiry time. Create a new evidence run and approval instead.

All newly produced outbox rows remain `shadow`. Enabling the feature flag does not promote them. `BillingChargePromotionService` is the only approved promotion path. It requires the selected canary tenant and consent, an exact outbox and ledger ID pair from the immutable canary report, a billing-owner actor, and a nonempty reason. It atomically changes the selected pending row to `deliveryMode=charge`, records its exact `charge_release_id` and `charge_promoted_at`, and appends immutable promotion evidence. The worker only claims rows promoted for its current `ZARA_RELEASE_ID`. Never update outbox promotion columns directly or bulk-promote a historical shadow backlog.

## Preflight

1. Keep `BILLING_CHARGE_DELIVERY_ENABLED=false`.
2. Run migration and focused billing tests against the exact release candidate.
3. Run the Polar sandbox, internal-tenant, and selected-tenant canaries.
4. Run reconciliation and all PAYG, duplicate, late-event, correction, rollback, alert, and charge-stop drills.
5. Store the real evidence record through an approved audited production operation.
6. Confirm that the evidence catalog and release IDs equal the deployment values.
7. Review the exact tenant-qualified outbox IDs selected for charge promotion. Keep all other rows in shadow.
8. Start one API candidate with `BILLING_CHARGE_DELIVERY_ENABLED=true`. Startup must fail if evidence is missing, failed, expired, stopped, or mismatched.
9. Promote only the approved canary outbox rows for the exact release ID.
10. Confirm the charge delivery dashboard and alerts before traffic expands.

The startup check also requires Polar production mode, production credentials, webhook verification, and all approved production mappings.

## Emergency Charge Stop

Run this transaction with an incident-specific reason and actor audit procedure:

```sql
BEGIN;
UPDATE billing_charge_release_controls
SET delivery_stopped = true,
    stop_reason = 'replace with the incident-specific reason',
    stopped_at = now(),
    updated_at = now()
WHERE environment = 'production';
COMMIT;
```

Confirm that exactly one row changed. The next outbox pass stops before it claims a new event. Ledger and outbox facts stay unchanged. Then set `BILLING_CHARGE_DELIVERY_ENABLED=false` and redeploy. Do not delete or rewrite pending, processing, delivered, or dead-letter facts.

## Restart After A Stop

Do not clear a charge stop in place. Run a new reconciliation, canaries, and drills. Record a new approval that binds to the current catalog and release. Use the approved audited operation to replace the release record. Then repeat the full preflight.

## Rollback

Application rollback must set `BILLING_CHARGE_DELIVERY_ENABLED=false` first. Keep the ledger and outbox. If schema rollback is safe, apply `rollback-0035-provider-scope-history.sql`, then `rollback-0034-provider-scope-tenant-isolation.sql`, then `rollback-0033-provider-billing-scopes.sql`, then `rollback-0032-provider-evidence-scope.sql`, then `rollback-0031-billing-adjustment-evidence-integrity.sql`, then `rollback-0030-billing-release-evidence-integrity.sql`, then `rollback-0029-billing-charge-promotion.sql`, then `rollback-0028-billing-release-evidence.sql`, then `rollback-0027-billing-charge-release.sql`. Each rollback refuses to run while its approval, evidence, or promoted charge facts exist.

## Direct provider evidence setup

The deployment owner must put secrets in the control-plane secret store. Do not put secrets in Git.

- Cartesia: an organization administrator creates an admin API key. Set `CARTESIA_ADMIN_API_KEY`. Add one immutable `billing_provider_tenant_scopes` row for each tenant-owned Cartesia standard API key ID.
- OpenAI: an OpenAI organization owner creates an Admin API key. Set `OPENAI_ADMIN_KEY`. Add one immutable scope row for each tenant-owned OpenAI project ID.
- Gemini: a Google Cloud billing administrator enables Cloud Billing export to BigQuery. A Google Cloud IAM administrator gives the Zara workload service account BigQuery job and view-read access. Use Application Default Credentials. Add one immutable scope row with the tenant project ID and configuration for `billingAccountId`, `normalizedBillingView`, `serviceIds`, `skuIds`, and `exportEnabledAt`.
- Twilio: use the existing encrypted tenant Twilio credentials. No new billing-report secret is required.
- AssemblyAI: do not configure a report URL. Release remains blocked until Zara stores the provider Termination `session_duration_seconds` fact with tenant and session identity.

The scope table has no public writer. Apply scope rows through an approved database change with audit evidence. Never map one external provider key or project to two tenants. Migration 0034 enforces this rule. For key rotation, set `effective_until` once on the old open scope, then insert the replacement scope. All other fields remain immutable. A rotation during a billing cycle blocks that cycle because one scope must cover the complete cycle.

Cartesia evidence is exact only for UTC-day-aligned cycles. OpenAI and Gemini provide provider-native tokens, credits, and costs, not Zara runtime seconds. These facts cannot qualify charge release until the reconciliation policy compares the provider-native facts without an invented conversion.
