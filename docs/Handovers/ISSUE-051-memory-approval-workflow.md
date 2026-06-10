# ISSUE-051: Memory approval workflow

External: [GitHub #51](https://github.com/tuzzy08/zara/issues/51)

Issue link: https://github.com/tuzzy08/zara/issues/51

## Goal

Deliver Memory approval workflow for the Memory area in the Monitoring milestone.

## Acceptance Criteria

- Tenant can require approval before durable memory write
- Approvers can accept, edit, reject
- Audit trail is kept

## Work Completed

- Added approval-required caller/account memory writes through `approvalRequired: true`.
- Approval-required writes now create pending memory drafts instead of active durable memory.
- Added `POST /organizations/:orgId/memory/drafts/:draftId/approve`.
- Added `POST /organizations/:orgId/memory/drafts/:draftId/reject`.
- Approvers can edit draft text and confidence during approval.
- Approved drafts create active durable memory records and link back through `approvedMemoryId`.
- Rejected drafts keep optional rejection reason and do not create memory records.
- Drafts keep audit trail entries for creation, approval, and rejection.
- Drafts and audit trails persist through the existing memory repository abstraction.
- Updated `docs/API.md` and `docs/Memory.md`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts` failed because `approvalRequired` writes returned no draft.
- GREEN: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts` passed after adding draft creation, approve, and reject behavior.
- `npm.cmd run test:run -- apps/api/src/memory/memory.persistence.test.ts`
- `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts apps/api/src/memory/memory.persistence.test.ts`
- `npm.cmd run test:run -- apps/api/src/app.module.test.ts`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build --workspace @zara/api`

## Pending Work

- Future UI work can expose the draft queue; this slice implements the API behavior and persistence contract.

## Risks And Edge Cases

- Approver unavailable leaves drafts pending and prevents active memory from being written until approval.
- Duplicate suggestions are not deduped in this slice; future queue/UI work should group or suppress duplicates.
- Non-pending drafts cannot be approved or rejected again.

## Decisions

- Priority: P1
- Labels: memory, frontend, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Approval-required writes use the existing `POST /memory` route with `approvalRequired: true` rather than a separate draft-create route.
- Rejection does not delete draft history; it marks the draft rejected for auditability.
- Approval creates a new durable memory ID so the draft and approved memory have separate lifecycles.

## Next Recommended Step

Run final verification. If green, move to ISSUE-052: Memory edit delete UI API.
