# ISSUE-147: Live route activation and subscription gates

Status: Todo
Date: 2026-05-28
External: [Linear ZAR-93](https://linear.app/zara-voice/issue/ZAR-93/issue-147-live-route-activation-and-subscription-gates)

## Work Completed

- Created the reconciled local backlog entry and matching Linear issue.
- Standardized manual live activation from exact successful PSTN test results.
- Captured subscription, budget, abuse, provider health, and mid-call policy behavior.

## Tests Run

- Not run. This pass created planning docs and issue records only.

## Pending Work

- Add failing activation guard tests for every hard block and authorized override path.
- Implement live route promotion, pause/resume behavior, and subscription/budget/abuse gate handling.
- Add audit and tenant-isolation coverage.
- Update billing, telephony, UI, and runbook docs after implementation.

## Risks

- Auto-activation would let untested versions answer live calls.
- Subscription and budget transitions during active calls need deterministic caller-facing behavior.

## Decisions

- Subscription loss preserves setup and history but blocks new answering.
- Active calls may finish within grace unless budget hard stop or abuse/security suspension applies.

## Next Recommended Step

- Start RED with activation hard-block tests.
