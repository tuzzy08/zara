# ISSUE-100: Workspace switcher and creation flow

External: [GitHub #100](https://github.com/tuzzy08/zara/issues/100)

Issue link: https://github.com/tuzzy08/zara/issues/100

## Goal

Let tenant users switch and create workspaces from the product UI.

## Work Completed

- Seeded the issue in `docs/Issue-Backlog.md` and `docs/issues.json`.
- Added browser-local workspace state for default tenant workspaces, persisted active workspace selection, and local workspace creation.
- Reworked the tenant summary card into a workspace switcher with a create-workspace flow.
- Passed active workspace context from the tenant shell into the workflow builder and sandbox routes.
- Updated feature-flow docs to describe the workspace switcher and browser-local persistence boundary.

## Tests Run

- `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=threads`

## Pending Work

- Replace browser-local workspace persistence with the NestJS workspace API when ISSUE-102/backend workspace settings work begins.
- Add production error handling for duplicate slugs and failed workspace creation once API-backed.

## Risks And Edge Cases

- Last accessible workspace is deleted.
- User switches workspace while editing a draft workflow.

## Decisions

- Workspace selection should be reflected in API context, not treated as cosmetic UI state.

## Next Recommended Step

Implement API-backed workspace settings, membership management, and deletion/archive flows in ISSUE-102.
