# ISSUE-154: Account security flows and session controls

Status: Pending
Date: 2026-05-31
External: [Linear ZAR-100](https://linear.app/zara-voice/issue/ZAR-100/issue-154-account-security-flows-and-session-controls)

## Work Completed

- Created the external Linear issue and reconciled it with the local backlog.
- Captured email verification, password reset, rate limiting, and session controls as a separate account-security slice.

## Tests Run

- Not started.

## Pending Work

- Implement after ISSUE-150.

## Risks

- Password reset and verification flows can leak account existence if responses are not normalized.

## Decisions

- Use Better Auth supported flows and configure server-owned email delivery instead of custom auth mechanics.

## Next Recommended Step

- Start after the server-owned auth context baseline is implemented.
