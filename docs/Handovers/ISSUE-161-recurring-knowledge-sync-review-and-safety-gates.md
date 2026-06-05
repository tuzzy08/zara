# ISSUE-161: Recurring knowledge sync review and safety gates

Status: Pending
External: [Linear ZAR-115](https://linear.app/zara-voice/issue/ZAR-115/issue-161-recurring-knowledge-sync-review-and-safety-gates)

## Goal

Add manual and daily recurring knowledge sync with review-gated diffs, deletion drafts, conflict handling, and sensitivity gates.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependency on ISSUE-160.

## Tests Run

- Not run; issue creation and planning only.

## Pending Work

- Add sync state machine and tests for manual refresh, daily sync, update drafts, deletion drafts, and degraded provider state.
- Add conflict and sensitivity scanning rules.
- Enforce approval authority with existing Settings roles.

## Risks And Edge Cases

- Provider deletion differs from auth or permission failure.
- Obvious secrets and credentials must never become runtime knowledge.
- Active calls must keep their starting retrieval snapshot.

## Decisions

- V1 sync supports manual refresh and daily cadence only.
- Sync never directly changes active runtime knowledge.
- Source deletion creates a review draft instead of immediately removing approved records.

## Next Recommended Step

Write failing tests for recurring sync transitions and deletion-draft behavior.

