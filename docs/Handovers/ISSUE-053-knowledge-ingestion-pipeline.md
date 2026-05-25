# ISSUE-053: Knowledge ingestion pipeline

Issue link: https://github.com/tuzzy08/zara/issues/53

## Goal

Deliver Knowledge ingestion pipeline for the Memory area in the Integrations milestone.

## Acceptance Criteria

- Pipeline ingests docs, websites, PDFs, Notion, Google Drive, and CRM help centers
- Ingestion status is visible
- Failures are retryable

## Work Completed

- Added tenant-scoped knowledge ingestion API routes:
  - `POST /organizations/:orgId/memory/knowledge/ingestions`
  - `GET /organizations/:orgId/memory/knowledge/ingestions/:ingestionId`
  - `POST /organizations/:orgId/memory/knowledge/ingestions/:ingestionId/retry`
- Added ingestion models for document, website, PDF, Notion, Google Drive, and CRM help-center source content.
- Successful source ingestion creates tenant knowledge records for the requested published workflow version IDs with traceable document/integration source metadata.
- Ingestion responses expose aggregate job status plus per-source status, produced knowledge record IDs, retryable failure codes, and messages.
- Retry reprocesses only failed retryable source rows and avoids duplicating already-successful source records.
- Added file/in-memory state persistence support for ingestion jobs.
- Updated Memory, API, and Integrations docs.

## Tests Run

- RED: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts -t "ingests supported knowledge"` failed with 404 before ingestion routes existed.
- GREEN: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts -t "ingests supported knowledge"` passed after adding the ingestion API/service/state behavior.
- `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts apps/api/src/memory/memory.persistence.test.ts`
- `npm.cmd run typecheck`

## Pending Work

- Run final app-module, lint, and API build verification before closeout.

## Risks And Edge Cases

- Large source content currently fails the source row as `large_file` and marks it retryable rather than attempting chunking in this slice.
- Unsupported PDF content type fails as `unsupported_content_type` and is retryable with corrected source payload.
- This slice accepts already-resolved source text; provider-specific fetch/sync workers for Notion, Google Drive, CRM help centers, websites, and PDFs should be added behind connector services later.

## Decisions

- Priority: P1
- Labels: memory, integrations, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Ingestion jobs live inside the memory module/state for now so job status and produced tenant knowledge share the same tenant boundary.
- Successful ingestion creates `policy` tenant knowledge records by default; future enrichment can classify FAQ vs policy once content processing is deeper.
- Notion, Google Drive, and CRM help center sources are represented as integration-backed knowledge sources without exposing provider credentials.

## Next Recommended Step

Run final verification. If green, move to `ISSUE-054: Memory privacy and retention enforcement`.
