# ISSUE-048: Tenant knowledge memory

Issue link: https://github.com/tuzzy08/zara/issues/48

## Goal

Deliver Tenant knowledge memory for the Memory area in the Monitoring milestone.

## Acceptance Criteria

- Tenant knowledge can store policies and FAQs
- Sources are traceable
- Retrieval filters by published workflow

## Work Completed

- Added tenant knowledge memory support to `apps/api/src/memory`.
- Added `POST /organizations/:orgId/memory/knowledge` for tenant-scoped policy and FAQ records.
- Added `GET /organizations/:orgId/memory/knowledge?publishedWorkflowVersionId=:id&now=:isoTimestamp` for published-workflow-filtered retrieval.
- Persisted knowledge records through the existing memory repository abstraction alongside caller/account memory.
- Added source traceability with source kind, title, optional URI, and optional external ID.
- Added stale knowledge filtering through optional `staleAt`.
- Added conflict surfacing for active records with the same kind/title but different text or source metadata.
- Updated `docs/API.md` and `docs/Memory.md`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts` failed with 404 for the missing knowledge route.
- GREEN: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts` passed after adding the knowledge routes and service behavior.
- RED: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts` failed because stale knowledge was still retrieved.
- GREEN: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts` passed after adding `staleAt` filtering.
- RED: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts` failed because conflicting records were not marked.
- GREEN: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts` passed after retrieval-time conflict detection.
- `npm.cmd run test:run -- apps/api/src/memory/memory.persistence.test.ts`
- `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts apps/api/src/memory/memory.persistence.test.ts`
- `npm.cmd run test:run -- apps/api/src/app.module.test.ts`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build --workspace @zara/api`

## Pending Work

- Future issues still need edit/delete/approval workflows and pgvector semantic retrieval.

## Risks And Edge Cases

- Stale knowledge is filtered from retrieval when `staleAt` is at or before the supplied/current retrieval time.
- Conflicting sources are surfaced, not resolved automatically. Operators still need the future memory management UI/workflow to approve, edit, disable, or delete records.
- Knowledge retrieval is exact published-version filtering for this slice; semantic retrieval remains a later memory issue.

## Decisions

- Priority: P1
- Labels: memory, integrations, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Tenant knowledge is stored inside the existing Memory module/repository instead of creating a separate module.
- Conflict detection is computed at retrieval time so records keep their original source provenance.
- `now` is accepted as an optional retrieval query parameter for deterministic stale-knowledge tests.

## Next Recommended Step

Run focused memory tests, app module test, typecheck, lint, and API build. If green, move to ISSUE-049 in the memory and knowledge slice.
