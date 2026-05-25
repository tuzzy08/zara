# ISSUE-075: Model STT TTS cost accounting

Issue link: https://github.com/tuzzy08/zara/issues/75

## Goal

Deliver Model STT TTS cost accounting for the Billing area in the Production milestone.

## Acceptance Criteria

- Model/STT/TTS usage maps to runtime events
- Cost rates are versioned
- Unknown rates are flagged

## Work Completed

- RED: added billing controller coverage proving a runtime `turn.cost.delta`-style event must create versioned runtime cost accounting, map STT/model/TTS usage into billing usage features, and flag unknown model rates.
- GREEN: implemented `POST /organizations/:organizationId/billing/runtime-cost-events`.
- Runtime cost events now persist source runtime event ID, session/workspace, model tier, rate version, complete/incomplete state, missing rates, components, and total USD.
- Known-rate components create Polar usage events for `stt_minutes`, `model_input_tokens`, `model_output_tokens`, and `tts_characters`.
- Unknown-rate components are stored with `missingRate: true` and do not create Polar usage events.
- Documented runtime cost accounting in `docs/API.md`, `docs/Billing.md`, and `docs/Runtime-Manifests.md`.
- Marked ISSUE-075 implemented in `docs/Issue-Backlog.md` and updated roadmap sequencing.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/billing/billing.controller.test.ts` failed with `404` for the missing runtime cost event route.
- GREEN: `npm.cmd run test:run -- apps/api/src/billing/billing.controller.test.ts`

## Pending Work

- None for this issue.

## Risks And Edge Cases

- Provider pricing change
- Missing usage tokens

## Decisions

- Runtime cost events carry `rateVersion` so provider pricing changes remain auditable.
- Unknown rates are flagged and kept out of Polar usage ingestion until a rate exists.
- Runtime usage event IDs are idempotency keys for billing cost events.

## Next Recommended Step

Proceed to ISSUE-076 budget controls or later production hardening.
