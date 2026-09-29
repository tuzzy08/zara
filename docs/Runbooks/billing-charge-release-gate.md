# Billing Charge Release Gate

## Purpose

This runbook controls production usage delivery and emergency stop. The owner-approved policy of 2026-09-27 replaces the former three-owner and two-tenant canary gates. Use production for deployed verification. Supplier support answers and a separate staging instance are not prerequisites.

## Required Evidence

The latest `billing_delivery_decisions` row is the delivery authority. Enable requires a signed-in `platform_owner`, fresh server-verified MFA, valid production Polar settings and mappings, and a reason. The API stores the actor, server time, catalog, and release. Decision history is append-only. The old release, canary, and promotion records remain historical evidence; they cannot authorize the new worker.

Only complete new customer usage can receive the enabled decision ID. The trusted call start must be at or after the decision time. PAYG uses the earlier durable reservation time. Unknown start times and historical rows remain shadow. Supplier cost gaps do not replace customer facts or block complete customer charges. Never update decision or promotion columns directly.

## Preflight

1. Keep delivery off while applying and verifying the exact release and additive migrations. Preserve billing and auth records for rollback.
2. Verify customer calculation, tenant isolation, duplicate/retry handling, PAYG settlement, and stop with local tests. Local tests do not prove live provider delivery.
3. Configure `POLAR_SERVER=production`, production access token, webhook secret, approved catalog mappings, `POLAR_BILLING_CATALOG_ID`, and the exact `ZARA_RELEASE_ID`. Keep secrets in the deployment secret manager.
4. Set the infrastructure permission `BILLING_CHARGE_DELIVERY_ENABLED=true`. This alone does not enable delivery. The API remains available if payment settings are invalid so the stop control stays accessible.
5. Sign in as the configured platform owner and complete fresh MFA. Read `GET /platform-admin/billing/delivery`.
6. Send `PATCH /platform-admin/billing/delivery` with a new `requestId`, `enabled: true`, the current `expectedDecisionId` (or null), and an explicit reason. The server validates payment configuration. Save the returned ID and cutoff. Retry a failed response with the same request ID and body.
7. Verify new usage on the selected live production account: one trusted fact, correct customer amount, one provider event, and no duplicate after retry. Inspect customer reconciliation separately from supplier gaps. Do not claim success from an empty provider report.

Calls already started before enable are not swept into live delivery. A call with incomplete customer facts remains blocked. New subscription usage sends only the amount left after included allowance and prepaid credit. Do not also send full priced runtime or carrier events for that usage.

## Subscription remainder meter setup

The deployment owner performs these steps in production while delivery is stopped. Do not change historical events or meter rows.

1. Create a new Polar meter for event name `subscription_charge_minor`. Use the sum aggregation on metadata property `units`. One unit represents one USD cent.
2. Attach a usage price of USD 0.01 per unit to each applicable subscription product. Preserve its monthly base price. Do not attach a credit benefit or another included allowance to this meter: Zara has already subtracted both.
3. Retain `payg_charge_minor` as the credits-only meter. It must have no metered invoice price. This event records prepaid consumption; it must not create a second payment.
4. Add the production mapping `meter:subscription_charge_minor` for the approved catalog. Keep the existing required mappings. Enable validation rejects a missing new mapping.
5. Check that the live subscription uses the new usage price. A product edit alone is not evidence that an existing subscription has changed. Check its assigned prices in Polar before enable. Do not remove old invoice history or retroactively reprice old usage.
6. Deploy this code, then use the owner enable procedure above. Verify a live account: a 100-cent charge after included allowance with 40 prepaid cents must produce a 40-unit credits-only event and a 60-unit invoice event. A full prepaid payment must leave zero invoice units. Repeated delivery must not add a second event.

Polar supports a sum aggregation over an event metadata property. Existing used meter definitions cannot have their filter or aggregation changed; use a new meter. See [Polar meters](https://polar.sh/docs/features/usage-based-billing/meters), [usage prices](https://polar.sh/docs/features/usage-based-billing/billing), and [credits-only meters](https://polar.sh/docs/features/usage-based-billing/credits). These instructions do not change any live configuration.

## Emergency Charge Stop

Read the current decision, then send the same PATCH route with a new request ID, `enabled: false`, its ID as `expectedDecisionId`, and the incident reason. Owner authority and fresh MFA are still required. Stop does not require valid Polar settings. A concurrent decision returns conflict; read the current state and retry with a new request ID.

The worker checks the current decision before claim and before each provider send. A request already in flight cannot be recalled. Usage, pending rows, delivered rows, and failures remain stored. `BILLING_CHARGE_DELIVERY_ENABLED=false` with redeployment is the infrastructure stop if the API or auth is unavailable. Do not delete financial records.

## Restart After A Stop

Correct the incident, verify the customer path, and create a new enable decision. It has a new cutoff. Undelivered rows from an earlier decision stay stored but are not automatically sent. Deliberate billing corrections require a separate reviewed operation; do not manually relabel old rows.

## Rollback

Stop delivery and set the infrastructure flag false before rolling back the application. Keep the additive decision and MFA schema, financial rows, and audit history. Do not enable the old worker against new decision-stamped rows. Prefer a forward fix to a destructive schema rollback.

## Direct provider evidence setup

The deployment owner must put secrets in the control-plane secret store. Do not put secrets in Git.

- Cartesia: an organization administrator creates an admin API key. Set `CARTESIA_ADMIN_API_KEY`. Add one immutable `billing_provider_tenant_scopes` row for each tenant-owned Cartesia standard API key ID.
- OpenAI: an OpenAI organization owner creates an Admin API key. Set `OPENAI_ADMIN_KEY`. Add one immutable scope row for each tenant-owned OpenAI project ID.
- Gemini: a Google Cloud billing administrator enables Cloud Billing export to BigQuery. A Google Cloud IAM administrator gives the Zara workload service account BigQuery job and view-read access. Use Application Default Credentials. Add one immutable scope row with the tenant project ID and configuration for `billingAccountId`, `normalizedBillingView`, `serviceIds`, `skuIds`, and `exportEnabledAt`.
- Twilio: use the existing encrypted tenant Twilio credentials. No new billing-report secret is required.
- AssemblyAI: do not configure a report URL. Supplier comparison remains incomplete until native Termination `session_duration_seconds` facts and coverage are available. This is not a customer delivery gate.

The scope table has no public writer. Apply scope rows through an approved database change with audit evidence. Never map one external provider key or project to two tenants. Migration 0034 enforces this rule. For key rotation, set `effective_until` once on the old open scope, then insert the replacement scope. All other fields remain immutable. A rotation during a billing cycle blocks that cycle because one scope must cover the complete cycle.

Cartesia evidence is exact only for UTC-day-aligned cycles. OpenAI and Gemini provide provider-native tokens, credits, and costs, not Zara runtime seconds. Compare these in their native units. Missing or unqualified comparisons remain supplier gaps, not customer charge evidence.
