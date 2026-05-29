# ISSUE-054: Memory privacy and retention enforcement

Issue link: https://github.com/tuzzy08/zara/issues/54

## Goal

Deliver Memory privacy and retention enforcement for the Compliance area in the Monitoring milestone.

## Acceptance Criteria

- Retention policies purge memory and sources
- Sensitive memory classes are blocked
- Tenant export/delete is supported

## Work Completed

- Added sensitive direct-write blocking for durable caller/account memory before storage.
- Added tenant-scoped compliance routes:
  - `POST /organizations/:orgId/memory/retention/purge`
  - `GET /organizations/:orgId/memory/export`
  - `DELETE /organizations/:orgId/memory/tenant-data`
- Retention purge removes expired memory records, tenant knowledge records, embeddings, and linked ingestion source rows older than the supplied cutoff.
- Tenant export returns memory, knowledge, drafts, ingestion job status, and embedding metadata without raw embedding vectors.
- Tenant memory delete clears all memory-module state for one organization without touching other tenants.
- Legal hold blocks destructive retention/delete actions with a conflict response.
- Updated Memory and API docs.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts -t "enforces memory privacy"` failed because sensitive direct memory write returned 201 instead of being blocked.
- GREEN: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts -t "enforces memory privacy"` passed after adding sensitive blocking and compliance routes.
- `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts apps/api/src/memory/memory.persistence.test.ts`
- `npm.cmd run typecheck`

## Pending Work

- Run final app-module, lint, and API build verification before closeout.

## Risks And Edge Cases

- Legal hold now blocks destructive retention and tenant delete requests.
- Partial purge failure is low-risk in the current in-memory/file-state abstraction because purge mutates one tenant state snapshot and persists atomically through the repository save path. A database-backed implementation should wrap these deletes in one transaction.
- Tenant export intentionally omits raw embedding vectors to preserve the existing public API rule that embeddings are not exposed.

## Decisions

- Priority: P0
- Labels: memory, compliance, security, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Retention cutoff is supplied as `retainAfter` ISO timestamp for deterministic tests and future policy scheduling.
- Tenant memory delete is hard delete for memory-module state because it represents tenant data deletion/export compliance rather than operator-level memory item delete.
- Existing per-record memory delete remains soft-delete for auditability, while retention and tenant delete remove data from active state.

## Next Recommended Step

Run final verification. If green, the Memory and knowledge feature slice is complete and the next backlog slice starts at `ISSUE-055: Live call monitor`.
