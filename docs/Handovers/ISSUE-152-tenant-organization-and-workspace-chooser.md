# ISSUE-152: Tenant organization and workspace chooser

Status: Pending
Date: 2026-05-31
External: [Linear ZAR-98](https://linear.app/zara-voice/issue/ZAR-98/issue-152-tenant-organization-and-workspace-chooser)

## Work Completed

- Created the external Linear issue and reconciled it with the local backlog.
- Captured explicit tenant/workspace choice as the replacement for silent first-organization restoration.

## Tests Run

- Not started.

## Pending Work

- Implement after ISSUE-150.

## Risks

- Multi-tenant users can be routed into the wrong tenant if first-organization restoration remains the only behavior.

## Decisions

- Keep single-tenant sign-in frictionless while adding explicit choice for multi-tenant accounts.

## Next Recommended Step

- Start after ISSUE-150 provides a stable server-owned context.
