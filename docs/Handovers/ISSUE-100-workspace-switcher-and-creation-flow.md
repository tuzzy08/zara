# ISSUE-100: Workspace switcher and creation flow

Issue link: https://github.com/tuzzy08/zara/issues/100

## Goal

Let tenant users switch and create workspaces from the product UI.

## Work Completed

- Seeded the issue in `docs/Issue-Backlog.md` and `docs/issues.json`.

## Tests Run

- Not started.

## Pending Work

- Build workspace switcher, creation form, route/API context, and persistence.

## Risks And Edge Cases

- Last accessible workspace is deleted.
- User switches workspace while editing a draft workflow.

## Decisions

- Workspace selection should be reflected in API context, not treated as cosmetic UI state.

## Next Recommended Step

Write a failing UI/API-context smoke test for switching workspaces.
