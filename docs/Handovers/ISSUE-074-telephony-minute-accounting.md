# ISSUE-074: Telephony minute accounting

Issue link: https://github.com/tuzzy08/zara/issues/74

## Goal

Deliver Telephony minute accounting for the Billing area in the Production milestone.

## Acceptance Criteria

- Minutes are computed by provider connection and tenant
- Rounding policy is documented
- Failed calls are classified

## Work Completed

- RED: added billing API coverage proving telephony minute accounting must compute rounded completed-call minutes, classify failed calls, and expose provider-connection aggregates.
- GREEN: implemented `POST /organizations/:organizationId/billing/telephony-minute-events`.
- Stored telephony minute events by tenant, call session, provider, and provider connection; duplicate call/provider-connection submissions return the stored event.
- Completed and transferred calls round up to the next full minute and forward billable minutes to Polar as `zara_telephony_minutes`; failed calls are classified with zero billable minutes.
- Exposed `telephonyMinuteAggregates` from billing state.
- Documented the rounding policy in `docs/API.md`, `docs/Billing.md`, and `docs/Telephony.md`.
- Marked ISSUE-074 implemented in `docs/Issue-Backlog.md` and updated roadmap sequencing.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/billing/billing.controller.test.ts` failed with `404` for the missing telephony minute event route.
- GREEN: `npm.cmd run test:run -- apps/api/src/billing/billing.controller.test.ts`

## Pending Work

- None for this issue.

## Risks And Edge Cases

- Transferred call
- Provider mismatch

## Decisions

- Rounding policy is `round_up_to_next_full_minute`.
- Failed calls are retained in accounting aggregates for dispute/ops review but are billed as zero minutes.
- Provider mismatch is handled by aggregating against the provider and provider connection supplied by the authoritative accounting event.

## Next Recommended Step

Continue with ISSUE-075 for model/STT/TTS cost accounting.
