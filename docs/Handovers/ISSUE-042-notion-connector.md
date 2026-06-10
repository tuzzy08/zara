# ISSUE-042: Notion connector

External: [GitHub #42](https://github.com/tuzzy08/zara/issues/42)

Issue link: https://github.com/tuzzy08/zara/issues/42

## Goal

Deliver Notion connector for the Integrations area in the Integrations milestone.

## Acceptance Criteria

- Connector can search knowledge and create pages/tasks
- Workspace selection is stored
- Permission failures are clear

## Work Completed

- Added typed Notion connector tool schemas for:
  - `notion.knowledge.search`
  - `notion.pages.create`
  - `notion.tasks.create`
- Added deterministic local Notion execution for workspace knowledge search, page creation, and task creation behind tenant-scoped OAuth connections.
- Used the OAuth credential's external account ID as the stored Notion workspace selection in execution responses.
- Enforced required scopes per Notion tool and returns clear forbidden responses when permissions are missing.
- Updated `docs/API.md` and `docs/Integrations.md`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "Notion knowledge"` failed because Notion connector tool schemas were empty.
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "Notion knowledge"`
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts apps/api/src/integrations/integrations.persistence.test.ts apps/api/src/integrations/tool-permission-grants.service.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/api`

## Pending Work

- None for ISSUE-042 acceptance.

## Risks And Edge Cases

- Page moved
- Shared workspace revoked
- Real Notion API page/database mapping and token refresh remain provider-client expansion work.

## Decisions

- Priority: P2
- Labels: integrations, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Workspace selection is represented by the encrypted OAuth credential's external account ID and surfaced only as safe execution metadata.
- Permission failures use required-scope checks before execution.

## Next Recommended Step

Move to final verification for ISSUE-052, then proceed to the next unfinished backlog item.
