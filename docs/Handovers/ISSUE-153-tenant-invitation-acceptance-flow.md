# ISSUE-153: Tenant invitation acceptance flow

Status: Pending
Date: 2026-05-31
External: [Linear ZAR-99](https://linear.app/zara-voice/issue/ZAR-99/issue-153-tenant-invitation-acceptance-flow)

## Work Completed

- Created the external Linear issue and reconciled it with the local backlog.
- Captured invitation acceptance as dependent on auth context and tenant chooser behavior.

## Tests Run

- Not started.

## Pending Work

- Implement after ISSUE-150 and ISSUE-152.

## Risks

- Invitation acceptance can accidentally grant cross-tenant or wrong-email access if token authority is not checked server-side.

## Decisions

- Invitation lifecycle must be audited and tenant-isolated.

## Next Recommended Step

- Start after the context and chooser foundations are implemented.
