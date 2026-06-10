# ISSUE-073: Usage metering

External: [GitHub #73](https://github.com/tuzzy08/zara/issues/73)

Issue link: https://github.com/tuzzy08/zara/issues/73

## Goal

Deliver Usage metering for the Billing area in the Production milestone.

## Acceptance Criteria

- Usage events are recorded idempotently
- Usage aggregates by tenant and feature
- Tests cover duplicate events

## Work Completed

- RED: extended billing API coverage so duplicate usage submissions must not double-count feature aggregates.
- GREEN: added `feature` and `occurredAt` to persisted usage billing events and derived `usageAggregates` from unique persisted events in tenant billing state.
- Usage events still forward to Polar with the organization ID as `externalCustomerId`, and the feature key is included in Polar metadata.
- Documented usage metering in `docs/API.md` and `docs/Billing.md`.
- Marked ISSUE-073 implemented in `docs/Issue-Backlog.md` and updated roadmap sequencing.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/billing/billing.controller.test.ts` failed because `usageAggregates` was missing from billing state.
- GREEN: `npm.cmd run test:run -- apps/api/src/billing/billing.controller.test.ts`

## Pending Work

- None for this issue.

## Risks And Edge Cases

- Delayed provider usage
- Clock skew

## Decisions

- Aggregates are derived from stored unique events instead of maintaining a separate mutable counter, so replayed idempotency keys cannot inflate totals.
- `feature` is optional for backwards compatibility; when absent, the service falls back to metadata feature or the Polar usage event name.

## Next Recommended Step

Continue with model/STT/TTS cost accounting in ISSUE-075 when ready.
