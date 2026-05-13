# ISSUE-099: Workspace domain model

Issue link: https://github.com/tuzzy08/zara/issues/99

## Goal

Create the backend workspace model that sits below tenant organizations and scopes product work.

## Work Completed

- Seeded the issue in `docs/Issue-Backlog.md` and `docs/issues.json`.
- Added shared `@zara/core` workspace contracts for workspaces, workspace memberships, slug normalization, create validation, and access validation.
- Added workspace exports from the shared core package.
- Updated architecture and data-model docs to define workspaces as a product-scoping layer below tenant organizations.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/workspace.test.ts --pool=threads`
- `npm.cmd run test:run -- packages/core/src/workspace.test.ts packages/core/src/workspace-workflow.test.ts --pool=threads`

## Pending Work

- Add NestJS workspace module, Postgres schema, migrations, and API-backed access guards in a future backend slice.

## Risks And Edge Cases

- Duplicate workspace slug inside one tenant.
- User belongs to organization but not the selected workspace.

## Decisions

- Workspaces are tenant-owned and should not replace Better Auth organizations.

## Next Recommended Step

Implement ISSUE-102 workspace settings and access management after the backend workspace API exists.
