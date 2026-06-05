# ISSUE-165: Intercom connector v1 with Articles knowledge ingestion

Status: Pending
External: [Linear ZAR-119](https://linear.app/zara-voice/issue/ZAR-119/issue-165-intercom-connector-v1-with-articles-knowledge-ingestion)

## Goal

Add Intercom user/company/conversation lookup, internal notes, and Articles ingestion through the review-gated knowledge pipeline.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependencies on ISSUE-159 and ISSUE-161.

## Tests Run

- Not run; issue creation and planning only.

## Pending Work

- Add Intercom registry metadata, OAuth setup, scoped grants, and Articles source selection.
- Implement lookup, internal note/call-summary creation, and Articles ingestion.
- Add provider contract and knowledge ingestion tests.

## Risks And Edge Cases

- Intercom permissions may allow lookup but not Articles or notes.
- Deleted/unpublished Articles must create review drafts.
- External customer replies must remain unavailable.

## Decisions

- V1 supports internal notes and Articles ingestion, not external replies, conversation closing, assignment changes, or user/company mutation.

## Next Recommended Step

Start with Intercom lookup and Articles ingestion mocked contract tests.

