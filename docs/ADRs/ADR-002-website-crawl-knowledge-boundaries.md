# ADR-002: Website Crawl Knowledge Boundaries

Status: Accepted
Date: 2026-06-08

## Context

ISSUE-168 adds full website crawling as a knowledge source after the registry-backed source and review model became stable. The prior product decision said tenants can configure an allowed website root, crawl limits, exclude paths, workspace/workflow scope, manual refresh, and daily sync. It also said runtime retrieval must use approved indexed records only and never live website search.

The open design choices were how strict root confinement should be, what default limits should apply, how to handle robots/auth/binary/large pages, and what metadata should be exposed to operators.

## Decision

Website crawling is a review-gated knowledge source with conservative boundaries:

- The tenant configures only the allowed website root URL, crawl limit, exclude paths, workspace, workflow scope, and manual/daily sync.
- Zara owns fetch behavior, normalization, canonical handling, redirects, binary detection, large-page limits, and status classification.
- Crawl defaults to 25 successful pages and clamps tenant-supplied limits to 1-100 pages.
- Crawling is same-origin and same-root-path confined. External links, paths outside the configured root, excluded paths, and robots-disallowed paths are skipped with visible page status.
- HTML pages above 250 KB, auth-required pages, binary/non-HTML responses, fetch failures, empty pages, canonical duplicates, and content duplicates are recorded as per-page skipped/failed statuses.
- Successful pages are normalized into readable title-plus-body text and become record-level review drafts with source URLs. They do not become runtime knowledge until approved.
- Recurring manual/daily refresh compares crawled page URLs and content hashes, then creates review-gated new, update, and deletion drafts. Active approved knowledge remains unchanged until approval.
- Runtime retrieval never fetches the website and only reads approved indexed records.

## Consequences

This keeps crawl setup understandable for operators and limits accidental ingestion. It may omit useful pages outside the configured root or behind authentication in v1, but those failures are visible and can be handled by narrowing/adjusting the source or using a provider-backed knowledge connector later.
