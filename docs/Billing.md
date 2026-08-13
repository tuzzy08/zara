# Billing

## Production Billing Standard

[Production-Billing-Standard.md](Production-Billing-Standard.md) defines the approved V1 subscription and prepaid individual PAYG catalogs, ownership boundaries, customer meters, provider-charge separation, and hardcoded-value disposition. Customer charges stay disabled until ISSUE-248 records a go decision.

## Durable Billing Foundation

Migration `0016_panoramic_hobgoblin.sql` adds the production billing tables. Immutable catalog, ledger, adjustment, and PAYG credit rows have database triggers that reject updates and deletes. Tenant-owned records use tenant-qualified keys and idempotency constraints. Customer charges and supplier costs use separate integer minor-unit fields.

`billing_tenant_states` is a public read-model cache. It is not the financial ledger. New tenant state starts with no plan, subscription, usage, balance, invoice, entitlement, or checkout. Test fixtures must create the billing state that each test needs.

## Usage Metering

Only trusted server lifecycle events can create billing ledger facts. Tenant request bodies cannot submit a price, charge amount, usage fact, or PAYG debit. The legacy tenant mutation routes for generic usage, telephony minutes, and runtime costs return `404` in the production module graph.

The trusted producer resolves the price catalog that was effective at the event time. It writes stable tenant-qualified idempotency keys, raw runtime seconds, customer charge data, and supplier cost data to the Postgres ledger. Standard and premium runtime are separate meter classes. Subscription and PAYG settlement use the same trusted facts. All charge delivery remains `shadow` until ISSUE-248 records a release decision.

Complete subscription shadow facts use one transaction for the ledger insert and its durable Polar outbox row. Stable external event IDs make retries idempotent. The bounded worker preserves failed delivery for retry and does not delete the authoritative ledger fact. PAYG does not send standard or premium usage meters directly; it requires one later `payg_charge_minor` session debit.

The worker uses processing leases, exponential retry, dead-letter state, and tenant-scoped audited replay. A crashed processing lease can return to pending state. A lifecycle scheduler checks due rows every 30 seconds, prevents overlapping passes, and waits for the active pass during shutdown. Delivery is disabled by default. If it is enabled, startup rejects missing production credentials, sandbox mode, a missing webhook secret, or incomplete catalog mappings.

One PAYG session debit and its credits-only outbox event commit in one database transaction. The event uses the `payg_charge_minor` meter, a stable external ID, and the related Zara session ID. It does not send standard runtime, premium runtime, or telephony meters as a second customer charge.

Tenant-cycle reconciliation reports missing, duplicate, late, and quantity-mismatched Polar usage. PAYG reconciliation compares the durable $5 grant and session debits with the Polar meter balance. Dead-letter delivery and late usage emit fixed low-cardinality metric counters and alert signals. Metric labels do not include tenant or event IDs. These reports and alerts do not enable charge delivery.

Polar payment-state webhooks use tenant-owned receipt rows with payload hashes. Exact replay is idempotent, a changed payload under the same event ID is rejected, and older subscription projections cannot replace newer state. `customer.state_changed` validates the Polar customer, product, and benefit identifiers against the configured catalog, then applies the same atomic customer, subscription, and entitlement projection used by reconciliation before it marks the receipt processed. If Polar returns more than one safe subscription, Zara selects the highest safe state and then the newest provider `modified_at` value.

Polar `order.paid` validates the provider `paid` flag, `paid` status, USD currency, integer `total_amount`, invoice number, and provider creation time before storage. It writes one tenant-owned `billing_invoices` row with a stable provider-order key in one transaction. An exact order replay changes nothing. A replay with changed invoice data is rejected. This invoice projection does not enable charge delivery.

Polar `subscription.past_due` is the recoverable payment-failure event. Zara validates the customer, mapped product, `past_due` status, USD amount, and provider times before it writes the monotonic subscription projection. The public billing state changes to `past_due` at once. The durable projection keeps the provider `modified_at` failure time so the approved 72-hour BYO grace rule can be evaluated by the authoritative runtime access posture. Platform-managed PSTN must not use that grace because it creates direct supplier liability.

Checkout registers the tenant for Polar customer-state reconciliation. Reconciliation runs at startup and every 15 minutes, fetches state by the Zara tenant external ID, and atomically applies newer subscription and entitlement projections. A local active subscription or entitlement that is absent from the full provider state becomes revoked. An unchanged pass writes no new repair audit. A repaired state creates a tenant audit entry. Reconciliation does not enable charge delivery.

The only PAYG order projection is the configured `payg-5-usd` credit pack. A paid USD 500-cent order and its 500-cent service-credit grant commit together. Polar `order.refunded` can reverse the pack only when the event reports a full 500-cent USD refund and the full order grant remains unused. Partial refunds are rejected. Repeated paid-order and refund events do not change credit twice.

Approved billing corrections are append-only. One tenant-owned credit or debit adjustment must refer to an existing ledger entry in the same tenant. The approval identity, reason, amount, kind, and time are stored with one correction ledger fact in the same transaction. Exact replay changes nothing. A changed replay or cross-tenant ledger reference fails. ISSUE-246 and ISSUE-247 consume these signed correction facts for budget enforcement and production read models. This operation does not send a provider charge.

Missing catalog, rate, route, or provider duration data creates an explicit incomplete ledger fact. It does not create an estimated or silent zero charge. Browser sandbox V1 usage is explicitly non-billable. Phone tests are separately classified and follow the selected live route rules.

## Telephony Minute Accounting

The telephony service sends a trusted usage fact after it persists a terminal call state. The fact includes the tenant, workspace, call session, provider connection, provider ownership, route, runtime path, commercial mode, outcome, and server-measured duration. Duplicate terminal callbacks use the same ledger idempotency keys.

Platform-managed carrier time rounds connected seconds up to a full minute for each route. BYO routes do not create a platform carrier charge. Standard and premium runtime remain in seconds. Failed calls that never connect create an explicit zero-charge, non-billable fact. Missing provider-connected duration creates an incomplete fact.

## Runtime Cost Accounting

Trusted runtime completion sends measured standard or premium runtime seconds to the same producer. The producer stores the immutable catalog version used for the calculation. It does not round each runtime event to a full minute. PAYG credit consumption and external delivery are later settlement steps.

## Plan Limits And Budgets

`PATCH /organizations/:orgId/billing/budget-policy` lets tenant billing admins configure monthly budget, call-minute, and premium-runtime-minute limits. `POST /organizations/:orgId/billing/budget-checks` evaluates a proposed call or premium runtime reservation against the policy.

Migration `0018_dear_pretty_boy.sql` adds tenant reservation accounts and charge reservations. Migration `0019_curly_ego.sql` adds the expired reservation state. Migration `0020_secret_dreadnoughts.sql` adds finalized usage, session, and time fields with database checks. Migration `0021_ambiguous_trauma.sql` adds the explicit released state and release time. The tenant account row is the database serialization point. A conditional row update can reserve PAYG value only when the new reserved total stays within the current durable credit balance. Concurrent calls cannot both claim the same credit. At the exact expiry time, an abandoned active reservation becomes expired and releases its reserved value once before the next reservation decision. Finalization creates one tenant-qualified PAYG debit, replaces the reserved amount with actual usage, and releases the unused value in one transaction. An exact finalization replay returns the original result without a second debit. A failed-start release returns the full reserved value without a PAYG debit. Its replay changes nothing. A denied reservation returns the remaining local value and does not contact Polar. The rollback is blocked while an active unexpired reservation exists.

The trusted PAYG call-lifecycle service accepts only a server-calculated maximum expected charge. It creates the reservation before it calls the provider-start boundary. If provider start fails, it releases the claim and rethrows the provider error. The catalog-backed reservation quote service calculates this maximum from the server-owned call-duration limit and the effective approved PAYG rates. Runtime charges are prorated by second and rounded up on the total. Platform-managed carrier charges use the route's approved per-minute rate and round the maximum duration up to the next full minute. BYO calls have no platform carrier component. Missing catalogs, rates, routes, route matches, or supported rounding rules stop the quote. Neither service accepts a tenant request price, and neither service has a hardcoded reservation price.

Over-budget behavior is configurable:

- `block`: over-limit checks return `allowed: false` and `action: "block"`.
- `warn`: over-limit checks return `allowed: true` and `action: "warn"`.

Billing state includes `budgetWarnings` when spend, call minutes, or premium runtime minutes cross the configured warning threshold.

Telephony live-route activation, live-call start, and active-call checks read the durable subscription projection and the current budget posture. A `past_due` platform-managed PSTN account cannot activate or start a new call. A `past_due` BYO account can use live runtime only before the exact 72-hour grace end that starts at the provider `modified_at` time. Missing or unknown ownership uses the platform-managed check and fails closed. Inactive subscriptions and hard budget blocks preserve the number setup, credentials, routes, and history, but new inbound calls receive the safe unavailable provider response and a blocked dispatch record. During an active PSTN call, subscription loss uses the existing short call wind-down policy, while a hard budget block closes out after the current turn unless a separate emergency or human policy overrides that behavior.

## Safety

Billing APIs require tenant billing admin access for mutations. Public billing responses never return Polar access tokens, webhook secrets, provider bearer tokens, raw provider payload secrets, or decrypted telephony credentials.
