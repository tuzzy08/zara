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

### Local sandbox preparation — 2026-09-03

- Created a Git-ignored `.env.billing-sandbox` and local support files under `.zara-data/billing-sandbox/`. The original `.env` points to a remote database and was not changed or used.
- Started separate Docker Postgres/pgvector and Redis containers under the `zara-billing-sandbox` project. Host bindings are loopback only, on ports 55432 and 56379. Other projects' containers were not changed.
- Applied all 37 repository migrations to `zara_billing_sandbox`. The database has no Polar mappings yet.
- Built core, auth-client, UI, and API successfully. The local API and web app have not been started for this test.
- Ran the charge-release gate and outbox configuration suites: 2 files, 22 tests passed. These are local tests, not Polar payment qualification evidence.
- Confirmed the user-supplied token can list products through the Polar sandbox API. The sandbox returned no products. No checkout, payment, refund, canary, or live charge was created.
- Prepared an ngrok policy that permits only POST `/billing/polar/webhooks`; no public tunnel was started.
- Windows Defender blocked the standalone ngrok executable downloaded from the official Windows download page. The agent did not execute it or bypass Defender. Defender reports `Trojan:Win32/Kepavll!rfn`, `DidThreatExecute=false`, `IsActive=false`, and `ActionSuccess=true`.
- The ZIP SHA-256 is `699bbf1932ec43a573b764bd03e6568efa2c4e45955eb3cc2089c19bb4be4464`. It matches the publisher archive for ngrok 3.39.11 Windows amd64. Signature inspection was blocked. This confirms archive consistency, not that the release is harmless.
- The user approved Cloudflare Quick Tunnel as the replacement. Do not restore ngrok or add a Defender exclusion.
- Downloaded Cloudflare's official `2026.8.3` Windows amd64 executable from its GitHub release. SHA-256 `83e726ed18ea78c5ad5213c4c3a3a27051393950d2bc8ed4de69bec12d14eaae` matches both GitHub asset metadata and the published release checksum. Authenticode status is Valid with signer Cloudflare, Inc. The explicit Defender scan command failed with `0x80508023`; no scan-pass claim is made. Defender remains enabled in Normal mode with real-time protection, and there is no matching Cloudflare detection. The verified executable reports version 2026.8.3.
- Added a local-only webhook filter in the ignored support directory. Four tests failed first and then passed: exact POST route only; signed-body/header preservation without cookies or authorization; no forwarding before a webhook secret exists; and a 256 KiB request limit. The filter runs on loopback port 4012 with forwarding disabled while the webhook secret is blank.
- The tool policy rejected the public Cloudflare tunnel launch. No alternate launch method was attempted and no public tunnel has started. The user must start the verified tunnel in their terminal and supply its public URL before the sandbox webhook can be configured.

### User-started tunnel and webhook diagnosis — 2026-09-03

- The user supplied `https://liquid-irrigation-solely-ron.trycloudflare.com`. Public GET `/health/ready` returned 404. Public POST `/billing/polar/webhooks` returned 503 with forwarding disabled. The four local webhook-filter tests passed again.
- Listed sandbox webhook endpoints and found none. Created endpoint `dff4ffff-dda2-4327-b0c8-9a34973a460c` for the exact webhook path, then disabled it pending handler validation. Saved its secret in the ignored `.env.billing-sandbox`; no secret was added to tracked files. Selected events are `customer.state_changed`, `order.paid`, `order.refunded`, and `subscription.past_due`.
- Started the API with an isolated local wrapper that checks the sandbox database, Polar sandbox mode, disabled charge delivery, and nonempty webhook secret before loading the app. Local `/health/ready` returned 200 with healthy Redis. The web app is not started. The running webhook filter still has forwarding disabled.
- Confirmed a header-contract defect over local HTTP: a synthetic request whose signature passes Standard Webhooks verification returned 400, `Polar webhook id is required.` Zara's controller reads `polar-webhook-id` and `polar-webhook-signature`, but Polar uses the Standard Webhooks headers. The request did not reach billing projection. This is diagnostic evidence, not a real Polar event or payment qualification.
- Code review also found signature verification uses `JSON.stringify(payload)` instead of the original request body. Polar's current delivery documentation requires the original body. A regression test is still required for this separate risk.
- Asked the user for approval to fix the handler and add regression tests. No production code, live billing, Coolify settings, checkout, payment, or refund was changed in this pass.

### Webhook contract repair — 2026-09-04

- User approved the handler repair. Changed the HTTP boundary from legacy `polar-webhook-*` identity/signature headers to Polar's Standard Webhooks headers. Updated existing HTTP fixtures to use that contract.
- Added the provider-native customer-state identity fields. `data.external_id` resolves the Zara tenant, and `data.id` resolves the Polar customer. The older nested customer shape remains supported for existing internal fixtures.
- Enabled Nest raw-body capture in API bootstrap and passed the captured buffer to the Polar SDK. Signed requests cannot fall back to re-serialized JSON when raw bytes are missing.
- Converted SDK schema errors to a fixed 400 response so Nest does not log the SDK error with its raw payload. Signature failures remain 403. The existing local/unit-test unset-secret bypass was not expanded; sandbox startup still requires a nonempty secret.
- RED evidence: standard headers returned 400 instead of 201; signed provider-native customer state returned 400 instead of 201; formatted signed JSON returned 403 instead of 201; a signed invalid schema returned 500 instead of a safe 400. Each corresponding change was made after its failing test.
- GREEN evidence: controller coverage includes valid signed UTF-8 JSON, exact replay, body/whitespace changes, invalid signatures, expired/missing timestamps, missing identity/signature headers, legacy-header rejection, safe schema errors, and missing raw-body rejection. Rejected signatures do not consume the event: a later valid request with that ID succeeds.
- Ran `node node_modules/vitest/vitest.mjs run --config vitest.api.config.ts apps/api/src/billing --maxWorkers 1`: 50 files passed, 309 tests passed, 3 PostgreSQL-only tests skipped. Existing scheduler fixtures emit expected background error/alert logs; these are not live sandbox errors.
- Ran `npm run build --workspace @zara/api`: passed, including TypeScript compilation and ESM extension patching. Initial type-check errors were corrected before the successful build. `git diff --check` passed with line-ending warnings only.
- On resumption, local API/proxy listeners were absent and Docker Desktop was stopped. Requested Docker Desktop startup. The old public URL failed with DNS `ENOTFOUND`; asked the user for a new manually started tunnel URL. No tunnel launch policy was bypassed.
- The sandbox endpoint remains disabled. No checkout, payment, refund, real Polar webhook delivery, production deploy, commit, or push was performed in this repair pass.
- The user supplied replacement URL `https://did-earthquake-santa-morgan.trycloudflare.com`. Updated sandbox endpoint `dff4ffff-dda2-4327-b0c8-9a34973a460c` to that webhook URL with `enabled=false`; the API confirmed both values. The public route returned 502 while no local proxy was listening.
- Docker Desktop startup failed independently of Zara. Its backend log at 08:34:46 UTC reports `initializing Inference manager` and inability to access/remove `AppData/Local/Docker/run/dockerInference`. The Linux engine pipe remains absent; Compose could not start the sandbox containers. Stopped the pending Compose command. No Docker reset, file removal, WSL shutdown, or security exclusion was attempted. Docker repair requires a separate user decision.

### Local services restored — 2026-09-04

- The user restored Docker Desktop. Started only the `zara-billing-sandbox` Compose services; Postgres and Redis are healthy. Other project containers were not changed.
- Started the corrected built API (PID 14596) with the guarded sandbox wrapper. `/health/ready` returned 200 with healthy Redis. Started the webhook-only proxy (PID 12908) after validating the API. Process IDs are session evidence and must be rechecked before future process operations.
- An ignored diagnostic script sent formatted UTF-8 JSON with a valid signature to both loopback and the user-started tunnel. The handler passed signature validation and rejected the deliberately missing tenant identity with the expected 400, before any billing write. Changing one whitespace byte returned 403. Public GET requests for health, auth-session, and webhook paths returned 404.
- Enabled sandbox endpoint `dff4ffff-dda2-4327-b0c8-9a34973a460c` only after those checks. Its configured URL is `https://did-earthquake-santa-morgan.trycloudflare.com/billing/polar/webhooks`. The local secret remains in the ignored sandbox environment file. Automatic usage-charge delivery remains false.
- Created only a local test tenant, `billing-sandbox-20260904`, in `zara_billing_sandbox` to support a provider-generated event. No real provider evidence was synthesized.
- Polar rejected creation of the sandbox customer with 422 because the `example.com` test address cannot receive email. No sandbox customer or payment was created by this attempt, and the endpoint delivery list is empty. Requested a valid sandbox customer email from the user. Prefer a sandbox organization member email if receipt delivery is required.
- Docker is no longer a blocker. The next input is the sandbox customer email. No production settings, source code, checkout, payment, refund, commit, or push changed in this recovery pass.

### Real Polar webhook and redelivery — 2026-09-04

- The user supplied the sandbox customer email. Created Polar sandbox customer `70a7c0d2-3e39-473a-971a-e3d3ceab4cf7` with external ID `billing-sandbox-20260904`. No customer email or secret is recorded here.
- Polar generated `customer.state_changed` event `3ff79803-ca14-45e6-b335-bcc57d8743b8`. Delivery `2336ec3f-67c0-4a1f-b5e6-778f6fbb72e1` succeeded with HTTP 201 and `processed=true` at 08:44:53 UTC through the user-started tunnel.
- Requested redelivery through Polar's webhook API. Delivery `3212228e-e1be-4eb9-8f53-666cbda5473b` succeeded with HTTP 200, `processed=false`, and `replay=true` at 08:48:56 UTC.
- Read the isolated Postgres database after redelivery. Exactly one receipt exists for the tenant and event. Its status is `processed`, and its original processing time is unchanged.
- This verifies a real signed customer-state delivery and duplicate handling. It does not qualify paid orders, credit grants, refunds, subscriptions, usage delivery, or release approval. No checkout or payment was created. Production settings and automatic usage-charge delivery remain unchanged.

### PAYG sandbox checkout prepared — 2026-09-04

- Confirmed the isolated API is ready and the public webhook route still reaches Zara.
- Created private Polar sandbox product `48c44998-1377-415a-abc2-91e0772ab9a9`. It is a one-time USD 5.00 test product for the approved `payg-5-usd` internal key.
- Added the product mapping to the isolated local database under catalog `local-sandbox-payg-v1`. The catalog document is marked `testOnly`, and `approved_by` is `local-sandbox-test-fixture`. This is test setup, not a billing, security, or release approval.
- Created checkout `83d532a4-7531-4053-846a-5551296a9b83` through Zara's compiled Polar billing client. It is linked to local tenant `billing-sandbox-20260904`.
- After user confirmation, completed the checkout with Polar's public test card. Polar order `f1ea2afe-1b7d-4e6a-b0a3-14d798a52a7a` produced paid event `9bcbbbe8-ed53-4a8b-9f1b-fec1ad148c10`. Zara returned HTTP 201, saved one USD 500-cent order and invoice, and added one 500-cent credit grant. Provider redelivery returned HTTP 200 with `replay=true`; the database still had one order, one grant, and a 500-cent balance.
- The sandbox order contained a 465-cent net amount and 35-cent included tax. Polar rejects a refund request for 500 cents because its refund API accepts the net amount and adds the tax refund. A 465-cent refund succeeded and included 35 cents of refunded tax.
- The real `order.refunded` event first returned HTTP 400 because Zara required `refunded_amount` alone to equal 500. A Polar retry then exposed a second defect: an existing unprocessed receipt was treated as a completed replay.
- Added failing tests before the fix. Zara now accepts a full refund when `refunded_amount + refunded_tax_amount` equals `total_amount`. A processing error marks the receipt failed, and an exact later delivery can reopen it. Focused RED failures were the 465+35 refund returning 400 and the missing failed-receipt retry method.
- Built and restarted the isolated API. Marked only the known pre-fix unprocessed refund receipt as failed, then requested real provider redelivery. Zara returned HTTP 201 and applied one 500-cent reversal. A second provider redelivery returned HTTP 200 with `replay=true`. The final database has one grant, one reversal, and a zero-cent balance.
- Validation: both focused GREEN tests passed; the API build passed; the complete billing suite passed 50 files and 310 tests, with 3 PostgreSQL-only tests skipped. Existing scheduler fixtures emitted expected alert logs during the suite.
- No production setting changed. Automatic usage-charge delivery remains disabled.

### Subscription sandbox preparation — 2026-09-05

- Confirmed the isolated API is ready on loopback and the webhook-only proxy is running. The previous `trycloudflare.com` host no longer resolves, so Polar cannot deliver new sandbox events until the user starts a replacement Quick Tunnel.
- Created three private monthly Polar sandbox products: Starter at USD 49 (`52f11e0e-4456-4032-acd2-06a447bb387a`), Growth at USD 149 (`231e5c4d-d336-4812-aaaf-c5c271cb14d1`), and Scale at USD 499 (`3d386a57-f4d5-403d-84b1-61ad73d34bce`). These products exist only in Polar sandbox.
- Mapped all three products in the isolated local `local-sandbox-payg-v1` catalog. The catalog remains marked `testOnly`; this setup is not billing, security, or release approval.
- Did not create subscription customers, checkouts, or payments while the public webhook route was unavailable. This prevents loss of provider-generated qualification events.
- Next action: start a new verified Cloudflare Quick Tunnel to `http://127.0.0.1:4012`, update the existing disabled Polar webhook endpoint, verify signed delivery, and then prepare the three checkout forms. Ask for one explicit confirmation immediately before the three sandbox **Pay now** actions.

### Subscription sandbox qualification — 2026-09-05

- The user started a replacement Cloudflare Quick Tunnel. Updated and enabled sandbox webhook endpoint `dff4ffff-dda2-4327-b0c8-9a34973a460c` for the new route. Public signed-body checks passed. Public health and auth routes stayed unavailable through the webhook-only proxy.
- Created one isolated Polar sandbox customer and one checkout for each private monthly product. After the user's action-time confirmation, completed the Starter, Growth, and Scale checkout forms with Polar's public test card. Polar states that sandbox payments are not processed, so no real money moved.
- Polar and the isolated Zara database agree on three active monthly subscriptions: Starter at USD 49, Growth at USD 149, and Scale at USD 499. Their next period end is 2026-10-05. Each subscription has `cancel_at_period_end=false`.
- Zara stored exactly one customer, one active subscription, and one paid invoice for each test tenant. Invoice amounts are 4,900, 14,900, and 49,900 cents in USD. All 12 received subscription-path webhook receipts are processed and have no recorded error.
- Requested provider redelivery for the `order.paid` event and latest `customer.state_changed` event for each plan. After all six retries, each tenant still had one customer, one version-1 subscription, one invoice, and four receipts. The retries created no duplicate billing records.
- The Polar PAYG and subscription sandbox paths are qualified. Automatic usage-charge delivery remains disabled. No production setting, live charge, canary, or approval changed.

### Direct-provider secret update — 2026-09-05

- The user reports that `CARTESIA_ADMIN_API_KEY` and `OPENAI_ADMIN_KEY` are now in the deployed secret store. The values were not exposed in chat or added to Git.
- The credentials are not yet qualified. A successful provider read from the deployed API and tenant-qualified scope rows are still required.
- The user deferred Gemini billing evidence. No Gemini-backed tenant can qualify for charge release while Google Cloud Billing export and Application Default Credentials are absent. This does not block qualification work for tenants that do not use Gemini.
- Automatic usage-charge delivery remains disabled.

### Prior implementation results

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

- Verify the reported deployed `CARTESIA_ADMIN_API_KEY` and `OPENAI_ADMIN_KEY` values through successful provider evidence reads.
- Configure Google Application Default Credentials and Cloud Billing BigQuery export before any Gemini-backed tenant can qualify. The user deferred this work for now.
- Insert tenant-qualified provider scope rows in `billing_provider_tenant_scopes`.
- Persist AssemblyAI Termination `session_duration_seconds` with tenant and session identity before AssemblyAI can qualify standard runtime.
- Run one completed-cycle reconciliation and fix every release-blocking mismatch.
- The controlled Polar sandbox qualification is complete for PAYG and the three monthly subscription plans. Automatic usage delivery rejects sandbox mode, so this evidence does not prove the separate usage-delivery path.
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

Configure the direct provider credentials and tenant mappings. Add AssemblyAI duration capture. Then run a completed-cycle reconciliation, the internal tenant canary, and the selected-tenant canary. Record all three approvals only after all checks pass. Keep automatic usage-charge delivery disabled until then.

The local Polar sandbox qualification is complete. The PAYG checkout, credit, refund, and replay paths passed. The Starter, Growth, and Scale subscription checkout, payment-state, and replay paths also passed. Continue with deployed provider evidence, AssemblyAI duration capture, completed-cycle reconciliation, both canaries, and the three approvals. Keep the live deployment unchanged and do not treat local sandbox evidence as release approval.
