# ISSUE-164: Microsoft 365 Outlook Calendar connector v1

Status: Pending
External: [Linear ZAR-118](https://linear.app/zara-voice/issue/ZAR-118/issue-164-microsoft-365-outlook-calendar-connector-v1)

## Goal

Add Microsoft 365 Outlook Calendar availability and event creation without broad Graph or mailbox access.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependencies on ISSUE-158 and ISSUE-159.

## Tests Run

- Not run; issue creation and planning only.

## Pending Work

- Add Microsoft 365 calendar registry metadata, OAuth setup, and scoped grants.
- Implement curated availability read and event creation tools.
- Add Microsoft Graph contract tests, timezone tests, and side-effect coverage.

## Risks And Edge Cases

- Event creation is a write side effect and can duplicate.
- Calendar timezone handling can drift from tenant or caller timezone.
- Email/mailbox scopes must not leak into v1 setup.

## Decisions

- Microsoft 365 v1 is Outlook Calendar only.
- Email send/read, mailbox search, Teams notification, and broad Graph scopes are out of v1.

## Next Recommended Step

Start with mocked Graph availability and event-create contract tests.

