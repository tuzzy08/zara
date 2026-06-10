# ISSUE-052: Memory edit delete UI API

External: [GitHub #52](https://github.com/tuzzy08/zara/issues/52)

Issue link: https://github.com/tuzzy08/zara/issues/52

## Goal

Deliver Memory edit delete UI API for the Memory area in the Monitoring milestone.

## Acceptance Criteria

- Users can view, edit, delete, and disable memory
- Deletion removes embeddings and facts
- Audit records the action

## Work Completed

- Added the UI-facing memory item API:
  - `PATCH /organizations/:orgId/memory/:memoryId` edits text/confidence and can disable a memory record.
  - `DELETE /organizations/:orgId/memory/:memoryId` soft-deletes the memory record.
- Added memory record audit trail entries for create, edit, disable, and delete actions with actor and timestamp.
- Delete now removes associated memory embeddings so deleted facts disappear from semantic retrieval.
- Tenant isolation is enforced by looking up mutable memory only inside the requested organization state; cross-tenant edits return not found.
- Updated memory/API docs with edit, disable, delete, audit, and embedding-removal behavior.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts -t "lets tenant users edit"` failed because PATCH returned 404 before the route existed.
- GREEN: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts -t "lets tenant users edit"` passed after adding the API/service behavior.
- `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts apps/api/src/memory/memory.persistence.test.ts`
- `npm.cmd run typecheck`
- GREEN: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts apps/api/src/memory/memory.persistence.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/app.module.test.ts`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/api`

## Pending Work

- None for ISSUE-052 acceptance.

## Risks And Edge Cases

- Delete during active call is represented as a soft delete plus embedding removal. Active runtime consumers should treat only `status: "active"` records as usable, and retrieval already does that.
- Permission denied is represented at this slice by tenant-scoped lookup and not-found responses for cross-tenant memory IDs. Full authenticated membership/RBAC enforcement remains a platform-wide guard concern.

## Decisions

- Priority: P1
- Labels: memory, frontend, security, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Soft delete is used instead of physical removal so audit history remains inspectable while the fact and embeddings stop participating in list/retrieval flows.
- Disable uses the PATCH route with `status: "disabled"` rather than introducing a separate action endpoint.

## Next Recommended Step

ISSUE-052 acceptance is closed. Move to `ISSUE-053: Knowledge ingestion pipeline` when starting the next implementation pass.
