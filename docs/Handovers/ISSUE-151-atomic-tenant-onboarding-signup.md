# ISSUE-151: Atomic tenant onboarding signup

Status: Pending
Date: 2026-05-31
External: [Linear ZAR-97](https://linear.app/zara-voice/issue/ZAR-97/issue-151-atomic-tenant-onboarding-signup)

## Work Completed

- Created the external Linear issue and reconciled it with the local backlog.
- Captured atomic tenant onboarding as dependent on the server-owned auth context.

## Tests Run

- Not started.

## Pending Work

- Implement after ISSUE-150.

## Risks

- Better Auth user creation and product tenant/workspace creation can partially succeed if orchestration is not resumable.

## Decisions

- Treat this as a product onboarding action, not a raw client-side Better Auth sequence.

## Next Recommended Step

- Start after ISSUE-150 is implemented.
