# Production Billing Standard

Status: Approved for implementation. Subscription checkout and the $5 PAYG checkout can collect their stated upfront payments. Automatic delivery of usage-based charges stays disabled until ISSUE-248 records a go decision.

Proposal version: `2026-08-09-proposal-3`

## Purpose

This standard defines the first production charge model. It separates customer price, supplier cost, payment state, and access control. It also defines how Zara will replace each production-looking hardcoded billing value.

## System Ownership

Zara owns these records:

- trusted usage facts;
- immutable price-catalog versions;
- customer charge calculations;
- supplier cost calculations;
- credits, budget reservations, and access decisions;
- the append-only billing ledger and reconciliation evidence.

Polar owns checkout, payment methods, payment attempts, customer invoices and receipts, refunds, subscription orders, and sales-tax collection as the merchant of record.

Runtime and telephony providers own raw supplier usage and supplier invoices. Provider data is reconciliation evidence. It is not the direct source for a customer charge.

Postgres is the source of truth for Zara access decisions. A Polar outage must not cause free usage, duplicate charges, or the loss of a trusted usage fact.

## V1 Commercial Catalog

All values in this section are proposals. Amounts are in USD and exclude tax. One billing period is one calendar month from the subscription start date. Each charged day is one full UTC calendar day. A billing period starts at 00:00 UTC on its first charged day. It ends at 00:00 UTC on the day after its last charged day. V1 does not create a partial-day subscription period and does not prorate a subscription by hour. V1 has no annual plan.

| Plan | Base fee | Included standard runtime | Included premium runtime | Standard overage | Premium overage |
| --- | ---: | ---: | ---: | ---: | ---: |
| Starter | $49.00 | 200 minutes | 0 minutes | $0.15/minute | $0.40/minute |
| Growth | $149.00 | 1,000 minutes | 50 minutes | $0.12/minute | $0.35/minute |
| Scale | $499.00 | 3,000 minutes | 200 minutes | $0.10/minute | $0.30/minute |

The old 1,500, 8,000, and 25,000 included-minute values are not valid production values. At current supplier rates, these quantities can cost more than the related plan fee.

Overage is disabled by default. A billing administrator must set a monthly overage limit before Zara can start usage above the included credits. Included credits expire at the end of the billing period. Credits have no cash value and do not roll over.

## Individual PAYG Offer

PAYG is a prepaid offer for an individual who does not want a subscription. It is a billing offer, not a separate tenant type. The individual still uses a tenant-scoped Zara organization.

| Item | Proposed value |
| --- | ---: |
| Monthly fee | $0.00 |
| Credit pack | $5.00 |
| Standard runtime | $0.18/minute |
| Premium runtime | $0.45/minute |
| Platform-managed Nigeria outbound telephony | $0.35/minute, plus the selected runtime price |

The $5 pack is a one-time Polar product. A paid order grants $5 of non-cash Zara service credit. V1 has no other pack size, automatic recharge, or charge after the credit balance reaches zero. Repeated $5 purchases can stack and do not expire while the account stays open. Credits are not transferable and cannot be withdrawn as cash.

PAYG uses a credits-only `payg_charge_minor` meter. It has no metered overage price. Zara converts each finalized session charge to USD cents, rounds the session total up to the next cent, and consumes that quantity from the prepaid meter. The standard-runtime, premium-runtime, and telephony usage facts remain separate for statements and reconciliation.

Zara must reserve enough PAYG credit before a paid session starts. If the available credit cannot cover the reservation, Zara blocks the session and offers a top-up. When the remaining credit cannot cover the next safe call segment, Zara finishes the current turn and closes the session. Polar does not enforce this stop; Zara does.

The 14-day trial can lead to PAYG without starting a subscription. Live platform-managed telephony also requires a paid credit pack, verified billing identity, and the normal abuse and route checks. PAYG with BYO telephony consumes only runtime credit.

When a PAYG customer starts a subscription, unused PAYG credit stays available. Zara applies subscription included credits first, then PAYG credit, and then approved subscription overage. This order prevents the upgrade from deleting prepaid value.

## Customer Meters

The V1 customer statement uses three charge classes and one PAYG settlement meter:

1. `standard_runtime_seconds` records Zara sandwich-runtime use. It includes the Zara-managed STT, text model, and TTS path. It does not include carrier service.
2. `premium_runtime_seconds` records an approved premium realtime path. It does not include carrier service.
3. `platform_telephony_charge_minor` records the final platform-managed carrier charge in USD cents. The tenant statement must also show route, direction, provider, provider SKU, duration, and the applied rate-catalog version.
4. `payg_charge_minor` consumes prepaid service credit after Zara calculates a PAYG session from the three charge classes. It must not create an unpaid overage.

Runtime usage is recorded in seconds. The invoice quantity is the sum of seconds divided by 60. Zara does not round each runtime event to a full minute.

Telephony duration uses provider-connected seconds. Each completed call is rounded up to the next 60-second unit for a route that has per-minute carrier billing. A failed call with no provider connection has zero customer telephony charge. A provider charge that applies to a failed call stays a supplier cost until an approved customer-rate rule says otherwise.

Browser sandbox usage is not billable in V1. Phone-test usage follows the same rule as the selected live route and must show a charge estimate before the call starts.

## BYO And Platform-Managed Providers

For a BYO telephony connection, the tenant pays the carrier. Zara charges only the standard or premium runtime meter. Zara must not create a platform telephony charge.

For a platform-managed telephony connection, Zara charges runtime plus the approved route rate. Each route rate is an immutable catalog entry with source country, destination zone, direction, provider, provider SKU, currency, rounding rule, and effective time.

The first proposed platform route is:

| Route | Supplier evidence | Proposed customer price |
| --- | ---: | ---: |
| Twilio outbound to Nigeria local or mobile, with Media Streams | $0.2303-$0.2349 carrier plus $0.0044 Media Streams per minute | $0.35/minute |

Inbound Nigeria and all other platform-managed routes stay disabled until they have an approved route entry. This rule prevents an unknown supplier price from becoming a zero charge. Number rental, recording, storage, and regulatory fees also need separate catalog entries before Zara can charge them. V1 does not add a separate customer recording fee.

## Trial, Payment, And Access Rules

- A trial lasts 14 days and includes 30 non-rollover standard sandbox minutes.
- A trial includes no premium runtime and no live platform-managed telephony.
- A new tenant without a subscription has no plan, balance, invoice, or included credits.
- A PAYG tenant becomes active only after Polar reports a paid credit-pack order and Zara records the matching credit grant.
- A paid subscription starts access only after Polar reports a paid order or an approved trial state.
- A payment failure starts a 72-hour grace period for BYO live runtime. New platform-managed PSTN calls stop at once because they create a direct supplier liability.
- After the grace period, Zara blocks new live sessions. A session that is already active can finish its current turn and then closes.
- Cancellation keeps access until the paid period ends, unless a refund or security action revokes access sooner.
- An unknown, missing, or conflicting provider state is inactive. It never defaults to active.

## Budget Rules

For a subscription, the customer budget is an overage limit. It is not a fake account balance. For PAYG, the displayed credit is a real prepaid service-credit balance backed by paid and reconciled credit-pack orders.

Zara consumes included credits first. It then reserves the maximum expected customer charge before a live call or premium session starts. Concurrent reservations are atomic. Finalization applies actual usage and releases unused value. An expired reservation returns its unused value.

The effective allowance is the lowest valid limit from subscription state, included credits, tenant overage limit, platform risk limit, and route availability. A display must label an estimate as an estimate. It must not display it as a posted charge.

## Refunds And Adjustments

- Zara can refund the first base subscription payment within seven days when the tenant used fewer than 10 billable runtime minutes.
- Zara can refund an unused PAYG credit pack within seven days. If any credit from that order was consumed, the pack is not refundable except for a verified billing error or a legal requirement.
- Renewal base fees and delivered metered usage are not refundable, except for a verified Zara or provider billing error or a legal requirement.
- Polar can still issue a refund under its merchant-of-record and chargeback rules.
- A refund does not silently delete usage or end a subscription. Zara records the refund and access change as separate facts.
- Corrections use append-only credit or debit adjustments that refer to the original ledger entry. Zara never edits a posted charge.
- Polar calculates the related tax refund. Payment processing fees remain a Zara cost when Polar does not return them.

## Currency And Tax

V1 checkout, ledger, catalog, budgets, and charges use USD. Storage and APIs still include the ISO 4217 currency code so a later catalog can add a currency without changing old entries. Zara must reject mixed-currency arithmetic.

Polar is the merchant of record for Polar orders. Polar calculates, collects, and remits applicable sales tax and supplies tax-correct invoices and receipts. Zara remains responsible for its own income and revenue tax.

## Price-Catalog Contract

Each catalog version has these fields:

- stable catalog ID, semantic version, status, currency, effective start, and optional end;
- plan base price and billing period;
- included quantity and customer rate for each meter;
- trial, credit, rounding, grace, refund, and adjustment policies;
- PAYG pack products, granted credit amounts, debit rates, consumption order, and no-overage rule;
- platform telephony route rates and supplier SKU references;
- Polar product, price, meter, and benefit IDs;
- approval identity, approval time, evidence links, and checksum.

Each supplier-rate entry has provider, SKU, unit, currency, supplier rate, source URL, verified time, and effective time. Each customer-rate entry has a separate customer price and margin rule. Code must not derive one field by reading the other at charge time.

A catalog version becomes immutable after the first subscription, usage fact, reservation, or ledger entry refers to it. A price change creates a new version and an explicit migration policy. Existing subscribers keep their assigned version until an approved migration changes it.

Polar identifiers are deployment configuration validated at startup. They are not placeholder constants in source code. A missing or sandbox Polar setting must make production charge delivery fail closed.

## Supplier Evidence And Unit Economics

Supplier rates below were checked on 2026-08-09. They are evidence for the proposal, not customer prices.

- AssemblyAI Universal Streaming is $0.15/hour. Universal-3 Pro Streaming is $0.45/hour. Streaming charges use the full session duration.
- Cartesia Startup is $49 for about 1,667 TTS minutes and Scale is $299 for about 10,667 TTS minutes. The blended subscription cost is about $0.0294 per generated minute before unused capacity and contract terms.
- Twilio outbound calls to Nigeria cost $0.2303/minute for local destinations and $0.2349/minute for mobile destinations. Media Streams costs $0.0044/minute.
- OpenAI and Gemini realtime models use token prices. Zara needs measured token use per call before it approves a premium gross-margin target.
- Polar supports base and metered prices, but Zara must enforce credits and quotas in real time.
- Polar supports credits from one-time products and credits-only meters. Polar does not block use when a balance reaches zero, so Zara must reserve and stop PAYG use itself.

The proposed standard-runtime prices assume an approximate supplier cost of $0.05/minute before fixed platform and support cost. At that assumption, the standard included quantities alone use about 20.4% of the Starter fee, 33.6% of the Growth fee, and 30.1% of the Scale fee. These figures exclude premium runtime, fixed cost, support, failed sessions, unused supplier capacity, payment fees, and tax effects. They are not release evidence. ISSUE-248 must compare the proposal with measured P50, P95, and worst-case supplier cost before real charges start.

## Hardcoded-Value Disposition

| Current value or source | Production disposition |
| --- | --- |
| Billing service Polar product constants | Replace with validated deployment mappings tied to a catalog version. |
| Seeded tenant usage, costs, Growth plan, $742.18 balance, renewal, entitlement, and invoice | Delete from operational paths. New tenants use an empty durable state. Keep samples only in named test fixtures or Storybook data. |
| Starter $49/1,500, Growth $129/8,000, Scale $399/25,000 | Replace with the approved catalog. Do not migrate these quantities as production truth. |
| Billing service runtime rates | Replace with immutable supplier-rate entries and customer-rate entries. |
| Sandbox live-session pricing table | Use the same supplier catalog for estimates. Label sandbox estimates as non-billable. |
| Workflow $80 budget, $0 current cost, and $0.18/minute | Remove. Read a real budget policy and a catalog estimate. |
| Default sandbox $80 cap, $18 spent, and $0.22/minute | Move to an explicit demo fixture. Never return it from an operational API. |
| Platform-admin static spend, budget, minute, and balance values | Replace with guarded aggregate APIs from the ledger. Empty data stays empty. |
| Platform-admin API seeded spend, minutes, and budgets | Delete from the production service. Keep only explicit test fixtures. |
| USD-only formatting | Use the catalog currency. V1 is USD, but formatting must read the currency field. |
| File JSON billing repository | Replace with the tenant-safe Postgres ledger in ISSUE-242. |
| Empty Polar token and sandbox default | Reject these values when production billing or charge delivery is enabled. |
| Unknown Polar subscription state mapped to active | Map to inactive and require reconciliation. |
| Tenant-submitted usage mutations | Remove from public trust boundaries. Only trusted server producers can create billable facts. |

## Approval Gates

Commercial approval must confirm the plan fees, included quantities, overage prices, PAYG packs and rates, PAYG credit terms, Nigeria route price, trial, refund rule, 72-hour grace period, and USD-only V1 scope. Legal review must confirm that the proposed non-cash, non-transferable service-credit terms are suitable for launch markets.

Technical release also requires ISSUE-242 through ISSUE-248, measured unit economics, Polar sandbox invoice checks, reconciliation with supplier data, refund and adjustment drills, selected-tenant consent, and a recorded go decision. Until then, all calculated charges are shadow data only.

## References

- [Polar products and prices](https://polar.sh/docs/features/products)
- [Polar usage billing](https://polar.sh/docs/features/usage-based-billing/billing)
- [Polar credits](https://polar.sh/docs/features/usage-based-billing/credits)
- [Polar merchant of record](https://polar.sh/docs/merchant-of-record/introduction)
- [Polar refunds](https://polar.sh/docs/features/refunds)
- [Twilio Nigeria voice pricing](https://www.twilio.com/en-us/voice/pricing/ng)
- [AssemblyAI pricing](https://www.assemblyai.com/pricing/)
- [AssemblyAI streaming speech-to-text](https://www.assemblyai.com/products/streaming-speech-to-text)
- [Cartesia pricing](https://www.cartesia.ai/pricing)
- [OpenAI API pricing](https://openai.com/api/pricing/)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
