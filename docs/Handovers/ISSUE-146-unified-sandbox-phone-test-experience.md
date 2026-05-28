# ISSUE-146: Unified sandbox phone-test experience

Status: Todo
Date: 2026-05-28
External: [Linear ZAR-92](https://linear.app/zara-voice/issue/ZAR-92/issue-146-unified-sandbox-phone-test-experience)

## Work Completed

- Created the reconciled local backlog entry and matching Linear issue.
- Standardized one sandbox concept with explicit Draft test, Published test, and Phone test modes.
- Captured `/calls`, `/workflows`, and `/sandbox` ownership boundaries for phone testing.

## Tests Run

- Not run. This pass created planning docs and issue records only.

## Pending Work

- Read `DESIGN.md` before UI implementation.
- Add focused UI/API tests for mode selection, starting a waiting phone test, active controls, checklist rendering, and result persistence.
- Implement the Phone test experience without duplicating the full sandbox inside `/calls`.
- Update `DESIGN.md`, frontend architecture, feature flows, and telephony docs after implementation.

## Risks

- Multiple disconnected sandbox surfaces would confuse operators.
- UI state can become misleading while a phone test is waiting, connected, speaking, or ending.

## Decisions

- `/calls` owns setup and activation.
- `/workflows` and `/sandbox` can initiate or deep-link Phone test mode.

## Next Recommended Step

- Start RED with sandbox mode labeling and Phone test start-flow tests.
