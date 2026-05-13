# ISSUE-101: Workspace scoped workflows and sandbox runs

Issue link: https://github.com/tuzzy08/zara/issues/101

## Goal

Scope workflow drafts, published workflow versions, and sandbox sessions to workspaces.

## Work Completed

- Seeded the issue in `docs/Issue-Backlog.md` and `docs/issues.json`.
- Added a temporary workspace selector to the publish dialog as product direction.

## Tests Run

- Not started.

## Pending Work

- Persist workspace IDs on drafts, published versions, runtime manifests, and sandbox sessions.
- Enforce workspace access when loading sandbox workflows.

## Risks And Edge Cases

- Published workflow is moved or archived before sandbox starts.
- Workspace access is revoked after the sandbox route is opened.

## Decisions

- The current publish dialog workspace selector is temporary until API-backed workspace scope exists.

## Next Recommended Step

Write failing tests proving sandbox cannot load a workflow outside the active workspace.
