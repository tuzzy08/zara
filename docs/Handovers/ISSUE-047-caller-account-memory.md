# ISSUE-047: Caller account memory

External: [GitHub #47](https://github.com/tuzzy08/zara/issues/47)

Issue link: https://github.com/tuzzy08/zara/issues/47

## Goal

Deliver Caller account memory for the Memory area in the Monitoring milestone.

## Acceptance Criteria

- Durable caller/account memory is opt-in
- Memory is tenant scoped
- Retrieval respects caller identity

## Work Completed

- Added `MemoryModule` with `MemoryController`, `MemoryService`, and a repository abstraction.
- Added `POST /organizations/:orgId/memory` for opt-in durable caller/account memory writes.
- Added `GET /organizations/:orgId/memory?callerKind=:kind&callerValue=:value&accountId=:accountId` for tenant/caller/account-scoped retrieval.
- Added in-memory and file-backed memory state repositories; the module defaults to file-backed local persistence via `ZARA_MEMORY_STATE_DIR` or `.zara/memory`.
- Enforced `optIn: true` before durable memory writes.
- Retrieval scopes records by organization and caller identity; account memories also require matching `accountId`.
- Updated `docs/API.md` and `docs/Memory.md`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts` failed because `MemoryModule` did not exist.
- GREEN: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts`
- RED: `npm.cmd run test:run -- apps/api/src/memory/memory.persistence.test.ts` failed because `memory-state.repository` did not exist.
- GREEN: `npm.cmd run test:run -- apps/api/src/memory/memory.persistence.test.ts`
- GREEN: `npm.cmd run test:run -- apps/api/src/app.module.test.ts`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/api`

## Pending Work

- None for ISSUE-047 acceptance.

## Risks And Edge Cases

- Shared phone number: account-scoped memories require both caller identity and account ID.
- Wrong account match: account memories are excluded unless the request includes the same account ID used at write time.

## Decisions

- Priority: P1
- Labels: memory, security, tdd-required
- Handover docs are mandatory for every pass on this issue.
- This slice implements durable caller/account memory through a repository abstraction and file-backed local persistence; Postgres/pgvector migration remains in later memory storage/retrieval issues.
- Durable writes require explicit `optIn: true`.
- Approval workflow is not introduced here; opt-in records are marked approved, while ISSUE-051 covers tenant approval policy.

## Next Recommended Step

Run final verification, then move to ISSUE-048 tenant knowledge memory if all checks pass.
