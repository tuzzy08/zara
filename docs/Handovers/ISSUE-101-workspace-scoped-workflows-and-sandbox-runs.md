# ISSUE-101: Workspace scoped workflows and sandbox runs

Issue link: https://github.com/tuzzy08/zara/issues/101

## Goal

Scope workflow drafts, published workflow versions, and sandbox sessions to workspaces.

## Work Completed

- Seeded the issue in `docs/Issue-Backlog.md` and `docs/issues.json`.
- Added workspace ID support to draft manifest previews, published workflow versions, pinned published versions, and compiled runtime manifests.
- Added workspace-scoped published workflow filtering in the shared core and browser-local workflow registry.
- Updated the publish dialog to store the selected workspace on each immutable workflow version.
- Updated `Run in sandbox` to switch to the published workflow's workspace before opening the sandbox.
- Updated the sandbox to load and refresh only workflows from the active workspace.
- Updated runtime manifest documentation to call out workspace scope and hash behavior.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/workspace-workflow.test.ts --pool=threads`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=threads`

## Pending Work

- Persist workflow draft workspace IDs in the API-backed draft store when the backend workflow module is implemented.
- Enforce workspace access server-side before loading sandbox workflows once the NestJS runtime API replaces browser-local sandbox data.

## Risks And Edge Cases

- Published workflow is moved or archived before sandbox starts.
- Workspace access is revoked after the sandbox route is opened.

## Decisions

- Workspace scope is persisted on immutable published versions and compiled manifests, not inferred from UI route state.
- Browser-local filtering is acceptable for the current frontend slice but must be repeated in API guards.

## Next Recommended Step

Continue with ISSUE-102 for workspace settings/access management or the next sandbox feature slice once workspace API support is available.
