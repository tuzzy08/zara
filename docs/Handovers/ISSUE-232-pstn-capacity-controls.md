# ISSUE-232: Platform and tenant PSTN capacity controls

- Status: Implemented
- External: [Linear ZAR-234](https://linear.app/zara-voice/issue/ZAR-234/pstn-capacity-1112-add-platform-and-tenant-capacity-control-surfaces)
- Parent: [Linear ZAR-223](https://linear.app/zara-voice/issue/ZAR-223/pstn-capacity-qualification-admission-control-and-horizontally)

## Decisions

- Environment admission values remain non-bypassable infrastructure ceilings. Durable policy and temporary reductions can only tighten them.
- Capacity policy is a durable, versioned aggregate. Mutations require a reason and expected version and store immutable before/after audit evidence.
- Active global reductions constrain every displayed effective limit. Matching scope reductions further constrain their global, provider, provider-account, tenant, runtime, or worker dimension.
- Staff scope discovery reads active tenants, configured telephony provider accounts, and ready realtime workers; it does not depend on a scope having a policy override.
- Tenant posture is a separate projection. It exposes only the tenant's effective upper allowance, current use, remaining capacity, and tenant-safe rejection history.
- Capacity reads have no stale cache. A successful live observation is `fresh`; a failed live observation is `unavailable`. The UI accepts `stale` for a future bounded cache without representing missing telemetry as zero.
- Qualification execution remains owned by ISSUE-229/ZAR-233. ZAR-234 accepts approved evidence through deployment configuration and otherwise displays provisional status.

## Work Completed

- Added Postgres-backed capacity policy, immutable audit, and durable rejection repositories with migrations and concurrency-safe version updates.
- Added global, provider, provider-account, tenant, runtime, worker, and CPS policy resolution to the existing admission path.
- Added provider-account concurrency accounting to in-memory and Redis admission, including reserve, activate, renew, release, recovery, and usage reads.
- Added expiring scope reductions, exact effective-limit projection, provider-health fail-closed behavior, bounded current-degradation windows, and tenant-safe rejection mapping.
- Added live staff scope discovery from tenants, telephony connections, and the realtime worker registry.
- Added bounded 512-item scope inventory pages with validated offsets and platform-admin previous/next controls, so larger installations remain inspectable without unbounded requests.
- Kept inactive policy-only scope keys out of operational inventory, bounded every scoped policy map to 512 entries, and made partial inventory pages report aggregate posture as unavailable without discarding row-level telemetry.
- Aggregated provider health across all configured accounts before paging so an unhealthy account cannot be hidden outside the current inventory page.
- Added bounded 128-dimension telemetry batches and an independent 1,000-member per-dimension inspection cap; larger or inconsistent Redis state is reported unavailable rather than multiplying reads per scope or scanning unbounded reservations.
- Added fail-closed policy resolution and non-blocking, bounded rejection evidence writes on the Twilio admission path.
- Added deployment-supplied qualification evidence with certified/provisional status and a warning when the deployed global policy exceeds the qualified limit.
- Re-clamped persisted operational policy against current deployment ceilings on every admission so a rollout that lowers infrastructure limits cannot be bypassed by older state.
- Required durable Postgres capacity state in production and added module-level wiring coverage for missing database configuration.
- Disabled the admin mutation surface until authoritative posture loads, bounded temporary reductions, validated exact evidence dates, and projected worker health.
- Made post-mutation posture refresh fail closed: stale dimensions and rejection evidence are cleared, aggregate posture becomes unavailable, and further mutations stay disabled until an authoritative reload succeeds.
- Limited production worker posture to ready workers discovered through the registry; the configured process worker is projected directly only by the deterministic in-memory development adapter.
- Preserved discovered provider-account health when the same account also has a policy override and rejected blank qualification evidence instead of coercing it to zero.
- Added staff read/mutation APIs and tenant-isolated capacity posture API with explicit authorization coverage.
- Added the platform-admin Capacity surface with operational state, saturation, qualification evidence, hard ceilings, rejection history, policy editing, temporary-reduction inspection/removal, and exact audit snapshots.
- Added the tenant Calls capacity strip with loading, fresh, stale, unavailable, saturated, and actionable rejection states.
- Documented policy precedence, emergency reduction, expiry, audit inspection, and rollback.

## Tests Run

- The final touched-file ZAR-234 regression pack passes 188 tests across schema, policy and rejection repositories, policy/read/rejection services, scope discovery, coordinator, memory/Redis admission, module wiring, staff/tenant controllers, and both UIs.
- The real Redis integration suite passed 18 tests earlier in the implementation pass, including provider-account concurrency, batched dimension telemetry, and bounded dimension-member overflow handling. It was correctly skipped by the final aggregate command because `ZARA_TEST_REDIS_URL` was not present in that shell.
- Full repository TypeScript, ESLint, and all workspace builds pass.
- `npm run db:check` passes for migration `0016_fancy_the_stranger.sql`.
- The final mandatory two-axis review reports no hard standards findings and no hard specification findings.

## Pending Work

- Push the reviewed branch, open the PR, and observe CI.
- Populate certified qualification evidence after ISSUE-229/ZAR-233 can run in a suitable environment.

## Risks

- Provider-account discovery uses each connection's external provider account reference, falling back to the connection ID where the provider has no external account identifier.
- A tenant's effective allowance is an upper bound, not a reservation; shared global/provider/runtime/worker pressure can still deny a new call first.
- Ready-worker discovery is live Redis evidence. Registry failure leaves worker discovery incomplete and makes admission telemetry unavailable rather than fabricating healthy capacity.
- No staging environment is currently available, so qualification remains visibly provisional.

## Next Recommended Step

Open the ZAR-234 PR and observe CI. Do not mark capacity as certified until ISSUE-229/ZAR-233 supplies dated staging evidence.
