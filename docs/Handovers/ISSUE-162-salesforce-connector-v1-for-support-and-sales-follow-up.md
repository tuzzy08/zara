# ISSUE-162: Salesforce connector v1 for support and sales follow-up

Status: Pending
External: [Linear ZAR-116](https://linear.app/zara-voice/issue/ZAR-116/issue-162-salesforce-connector-v1-for-support-and-sales-follow-up)

## Goal

Add Salesforce support/sales context tools with safe lookups and approval-required additive writes.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependencies on ISSUE-158 and ISSUE-159.

## Tests Run

- Not run; issue creation and planning only.

## Pending Work

- Add Salesforce registry metadata, OAuth setup, and scoped grants.
- Add curated account/contact/case lookup plus create task, create case, and add call note tools.
- Add mocked provider contract and side-effect tests.

## Risks And Edge Cases

- Salesforce permissions can allow lookup while denying task/case writes.
- Additive writes may time out after provider receipt.
- Pipeline mutation and destructive operations must remain absent.

## Decisions

- V1 allows additive writes only and defaults them to approval-required.
- Pipeline stage mutation, owner changes, destructive updates, and deletes are out of v1.

## Next Recommended Step

Start with mocked Salesforce lookup and additive-write contract tests.

