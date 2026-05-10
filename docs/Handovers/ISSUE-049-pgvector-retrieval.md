# ISSUE-049: pgvector retrieval

Issue link: https://github.com/tuzzy08/zara/issues/49

## Goal

Deliver pgvector retrieval for the Memory area in the Monitoring milestone.

## Acceptance Criteria

- Embeddings are stored in Postgres pgvector
- Top-k retrieval has scope and confidence filters
- Index migration is documented

## Work Completed

- Handover stub created during project documentation setup.

## Tests Run

- Not started. Future implementation must follow RED/GREEN/REFACTOR.

## Pending Work

- Implement the issue according to the linked GitHub issue and project docs.
- Add or update tests before production code.
- Update this handover with decisions, files changed, test evidence, and remaining risks.

## Risks And Edge Cases

- No results
- Low-confidence match

## Decisions

- Priority: P1
- Labels: memory, backend, tdd-required
- Handover docs are mandatory for every pass on this issue.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then start with the first failing test for the smallest behavior in scope.
