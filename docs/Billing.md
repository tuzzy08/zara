# Billing

## Usage Metering

Tenant billing state is the public-safe read model for usage. `POST /organizations/:orgId/billing/usage-events` records usage events with caller-supplied idempotency keys and forwards unique events to Polar using the Zara organization ID as the external customer ID.

Each usage event carries a feature key. `GET /organizations/:orgId/billing/state` derives `usageAggregates` by tenant and feature from unique persisted events, so duplicate usage submissions do not increase totals.

## Telephony Minute Accounting

`POST /organizations/:orgId/billing/telephony-minute-events` records call accounting by tenant, provider, and provider connection.

Rounding policy: completed and transferred calls compute duration from `startedAt` to `endedAt` and round up to the next full minute. Failed calls are classified and stored with `billableMinutes: 0`.

Billable completed/transferred telephony minutes are forwarded to Polar as `zara_telephony_minutes`. Failed calls remain visible in `telephonyMinuteAggregates` for operational and provider-dispute review.

## Runtime Cost Accounting

`POST /organizations/:orgId/billing/runtime-cost-events` maps runtime `turn.cost.delta` usage into tenant billing. Runtime events carry STT minutes, model input tokens, model output tokens, and TTS characters plus a `rateVersion`.

Rates are versioned with the event so pricing changes do not rewrite old cost history. Unknown rates are stored as incomplete cost components with `missingRates`; only known-rate components create Polar usage events.

## Plan Limits And Budgets

`PATCH /organizations/:orgId/billing/budget-policy` lets tenant billing admins configure monthly budget, call-minute, and premium-runtime-minute limits. `POST /organizations/:orgId/billing/budget-checks` evaluates a proposed call or premium runtime reservation against the policy.

Over-budget behavior is configurable:

- `block`: over-limit checks return `allowed: false` and `action: "block"`.
- `warn`: over-limit checks return `allowed: true` and `action: "warn"`.

Billing state includes `budgetWarnings` when spend, call minutes, or premium runtime minutes cross the configured warning threshold.

## Safety

Billing APIs require tenant billing admin access for mutations. Public billing responses never return Polar access tokens, webhook secrets, provider bearer tokens, raw provider payload secrets, or decrypted telephony credentials.
