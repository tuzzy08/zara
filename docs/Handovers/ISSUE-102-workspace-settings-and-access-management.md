# ISSUE-102: Workspace settings and access management

Issue link: https://github.com/tuzzy08/zara/issues/102

## Goal

Give workspace admins safe controls for workspace settings and member access.

## Work Completed

- Seeded the issue in `docs/Issue-Backlog.md` and `docs/issues.json`.

## Tests Run

- Not started.

## Pending Work

- Build workspace settings, role grants/revocations, archive/restore, and audit logging.

## Risks And Edge Cases

- Removing the final workspace owner.
- Archived workspace still has active calls or sandbox sessions.

## Decisions

- Workspace admin actions must be auditable and permission-checked server-side.

## Next Recommended Step

Write failing service tests for role changes and final-owner protection.
