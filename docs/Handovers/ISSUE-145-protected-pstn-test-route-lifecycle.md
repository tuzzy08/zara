# ISSUE-145: Protected PSTN test route lifecycle

Status: Todo
Date: 2026-05-28
External: [Linear ZAR-91](https://linear.app/zara-voice/issue/ZAR-91/issue-145-protected-pstn-test-route-lifecycle)

## Work Completed

- Created the reconciled local backlog entry and matching Linear issue.
- Standardized separate `test_route` and `live_route` records for phone numbers.
- Captured allowed caller, waiting session expiry, successful phone-test checklist, and one-active-test-per-number v1 behavior.

## Tests Run

- Not run. This pass created planning docs and issue records only.

## Pending Work

- Add failing route-state, caller-gating, expiry, idempotency, and tenant/workspace isolation tests.
- Implement protected `test_route` creation and inbound dispatch precedence.
- Persist successful and failed PSTN test results against number ID, published version ID, and runtime profile.
- Update telephony docs and API contracts after implementation.

## Risks

- Always-on test routes would let real callers reach test workflows unexpectedly.
- Caller-number matching can fail for withheld or transformed caller IDs.

## Decisions

- PSTN tests require published versions, not draft graphs.
- `test_route` requires at least one allowed caller number in v1.

## Next Recommended Step

- Start RED with separate `test_route`/`live_route` model tests.
