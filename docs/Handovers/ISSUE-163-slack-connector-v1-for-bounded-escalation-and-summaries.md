# ISSUE-163: Slack connector v1 for bounded escalation and summaries

Status: Pending
External: [Linear ZAR-117](https://linear.app/zara-voice/issue/ZAR-117/issue-163-slack-connector-v1-for-bounded-escalation-and-summaries)

## Goal

Add Slack for bounded escalation, provider-health/failed-call alerts, and configurable post-call summaries.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependencies on ISSUE-158 and ISSUE-159.

## Tests Run

- Not run; issue creation and planning only.

## Pending Work

- Add Slack registry metadata, OAuth setup, destination configuration, and scoped grants.
- Implement template-bounded escalation/alert/summary posting.
- Add contract tests and side-effect ledger coverage.

## Risks And Edge Cases

- Slack connection without configured destinations is not usable.
- Summary posts can duplicate if retries are not ledger-backed.
- Rate limits must surface visibly.

## Decisions

- Arbitrary agent-generated Slack messages, arbitrary DMs, and channel-history reads are out of v1.
- Slack destinations must be configured and scope-bound.

## Next Recommended Step

Start with destination-scoped Slack post contract tests.

