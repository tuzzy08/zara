# ISSUE-049: pgvector retrieval

External: [GitHub #49](https://github.com/tuzzy08/zara/issues/49)

Issue link: https://github.com/tuzzy08/zara/issues/49

## Goal

Deliver pgvector retrieval for the Memory area in the Monitoring milestone.

## Acceptance Criteria

- Embeddings are stored in Postgres pgvector
- Top-k retrieval has scope and confidence filters
- Index migration is documented

## Work Completed

- Added embedding-aware memory writes through optional `embedding` on caller/account memory create requests.
- Added `POST /organizations/:orgId/memory/retrieve` for top-k cosine retrieval.
- Added tenant, scope, caller identity, account, published workflow, and confidence filtering before ranking.
- Ensured public retrieval responses do not expose raw embedding vectors.
- Added durable local embedding persistence inside the existing memory state repository.
- Added Drizzle schema for `memory_embeddings` with a `vector(1536)` column.
- Added generated migration `0002_cool_tattoo.sql` and extended it with `CREATE EXTENSION IF NOT EXISTS vector` plus an ivfflat cosine index.
- Updated `docs/API.md` and `docs/Memory.md`.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts` failed with 404 for missing `POST /memory/retrieve`.
- GREEN: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts` passed after adding embedding storage and retrieval.
- RED: `npm.cmd run test:run -- apps/api/src/database/schema.test.ts` failed because `memoryEmbeddings` did not exist.
- GREEN: `npm.cmd run test:run -- apps/api/src/database/schema.test.ts` passed after adding the pgvector schema and migration.
- `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts apps/api/src/memory/memory.persistence.test.ts apps/api/src/database/schema.test.ts`
- `npm.cmd run test:run -- apps/api/src/app.module.test.ts`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build --workspace @zara/api`
- `npm.cmd run db:generate` reported no schema changes after migration reconciliation.
- `npm.cmd run db:check` currently exits non-zero because `git diff --exit-code -- apps/api/src/database/migrations` sees this issue's intentionally uncommitted migration changes.

## Pending Work

- Once the issue is committed, rerun `npm.cmd run db:check`; it should no longer fail on the migration diff.

## Risks And Edge Cases

- No-result retrieval returns an empty `matches` array.
- Low-confidence matches are filtered before ranking when `minConfidence` is supplied.
- Mismatched vector dimensions are skipped during scoring rather than returned.
- The current service uses the existing local memory state abstraction for runtime tests while the schema/migration establishes the Postgres pgvector storage path.

## Decisions

- Priority: P1
- Labels: memory, backend, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Retrieval uses cosine similarity and clamps `topK` to 1-20.
- Embeddings are write-only from the public API perspective and are intentionally omitted from retrieval responses.
- The Drizzle-generated `0002_cool_tattoo.sql` migration is the canonical migration file; manual pgvector SQL was folded into it to avoid duplicate `0002` migrations.

## Next Recommended Step

Run the final verification suite for ISSUE-049. If green, move to ISSUE-050: Memory extraction after calls.
