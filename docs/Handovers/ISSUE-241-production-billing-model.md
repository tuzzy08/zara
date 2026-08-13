# ISSUE-241: Production billing model and versioned price catalog

External: [Linear ZAR-262](https://linear.app/zara-voice/issue/ZAR-262/specify-the-production-billing-model-and-versioned-price-catalog)

## Status

Implemented.

## Work Completed

- Audited production source files for hardcoded plans, costs, balances, budgets, invoices, product IDs, rate tables, and currency assumptions.
- Confirmed that seeded billing state supplies false production-looking values to tenant pages and live-call policy gates.
- Confirmed that platform-admin UI and API billing values are seeded or static.
- Confirmed that runtime and telephony usage do not yet write authoritative billing ledger entries.
- Created the parent Linear specification and seven ordered child issues.
- Started the commercial model and price-catalog specification pass on 2026-08-09.
- Added `docs/Production-Billing-Standard.md` with a proposed V1 plan catalog, customer meters, supplier-cost separation, provider ownership, trial, grace, budget, refund, tax, currency, and immutable catalog rules.
- Added a disposition for every hardcoded billing source found in the audit.
- Checked current official Polar, Twilio, AssemblyAI, Cartesia, OpenAI, and Gemini pricing or billing documentation.
- Added a proposed prepaid individual PAYG offer with no monthly fee, one $5 credit-pack option, $0.18 standard runtime, $0.45 premium runtime, hard zero-balance stops, refund rules, and subscription-upgrade credit order.
- Recorded user approval of proposal version 3 on 2026-08-09.

## Tests Run

- `git diff --check` passed. Git reported only pre-existing line-ending notices.
- A plan-fee check at the proposed $0.05 standard-runtime supplier assumption produced base gross margins before premium and fixed costs of 79.6% for Starter, 66.4% for Growth, and 69.9% for Scale.
- A PAYG specification check confirmed the pack values, runtime rates, credits-only meter, zero-balance rule, non-cash terms, and legal-review gate.
- Linear ZAR-262 through ZAR-269 were checked after the PAYG scope update. The parent remains In Progress and all seven implementation children remain Todo.
- A single-pack check confirmed that local billing records and the Linear PAYG decision contain only the $5 pack option.
- No production test suite was run because this pass changed specifications and issue records only.

## Pending Work

- Get legal review of the PAYG non-cash service-credit terms before charge release.
- Measure premium realtime and standard runtime P50, P95, and worst-case supplier cost before charge release.

## Risks

- Supplier costs can change without notice.
- Customer prices must not be inferred from supplier rates.
- Late commercial decisions can block all child issues.
- OpenAI and Gemini realtime supplier cost depends on measured token use. The premium price is still a commercial proposal.
- The current AssemblyAI pages show a small keyterms add-on rate difference. A live supplier entry must use one verified SKU and effective rate.
- PAYG service credits can create consumer-law or stored-value risk if the terms, expiry, transfer, or refund behavior are not clear.

## Decisions

- This issue is the parent specification for ISSUE-242 through ISSUE-248.
- No real customer charge can start in this issue.
- Postgres will own Zara access and charge state. Polar will own checkout, payment, tax invoices, and receipts.
- BYO telephony will create no Zara carrier charge. Platform-managed telephony needs an approved route entry.
- New overage will be disabled until a tenant billing administrator sets a limit.
- PAYG is prepaid and has no automatic recharge or unpaid overage. Zara must stop use because Polar does not enforce the zero balance.
- V1 offers only one $5 PAYG credit pack. A customer can buy the same pack again when more credit is needed.

## Next Recommended Step

Continue ISSUE-242 with RED tests for the Postgres billing ledger and immutable catalog.
