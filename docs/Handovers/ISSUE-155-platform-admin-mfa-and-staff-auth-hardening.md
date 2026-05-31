# ISSUE-155: Platform admin MFA and staff auth hardening

Status: Pending
Date: 2026-05-31
External: [Linear ZAR-101](https://linear.app/zara-voice/issue/ZAR-101/issue-155-platform-admin-mfa-and-staff-auth-hardening)

## Work Completed

- Created the external Linear issue and reconciled it with the local backlog.
- Captured staff auth hardening as a separate platform-admin slice after auth context and account-security controls.

## Tests Run

- Not started.

## Pending Work

- Implement after ISSUE-150 and ISSUE-154.

## Risks

- Staff-origin UX must not imply tenant organization roles grant platform access.
- Impersonation and mutating staff operations need stronger auth assurance than basic email/password.

## Decisions

- Platform-admin auth remains separate from tenant auth and must carry platform role plus MFA/passkey posture for risky operations.

## Next Recommended Step

- Start after account-security controls are in place.
