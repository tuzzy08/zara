# ISSUE-168: Full website crawling knowledge source after registry stabilization

Status: Pending
External: [Linear ZAR-122](https://linear.app/zara-voice/issue/ZAR-122/issue-168-full-website-crawling-knowledge-source-after-registry)

## Goal

Add full website crawling as a registry-backed knowledge source after the snapshot and recurring review model are stable.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependency on ISSUE-161.

## Tests Run

- Not run; issue creation and planning only.

## Pending Work

- Add crawler configuration for allowed roots, limits, and excluded paths.
- Add crawl snapshot/diff ingestion and review-gated extracted records.
- Add crawler status UI and tests for crawl boundaries.

## Risks And Edge Cases

- Crawling can escape intended boundaries or ingest irrelevant/binary content.
- Robots, auth, redirects, and page failures need visible statuses.
- Full crawl must not appear in pickers before end-to-end ingestion works.

## Decisions

- V1 single URL import remains separate from full crawling.
- Runtime retrieval uses approved indexed records only, never live website search.

## Next Recommended Step

Start with failing crawler boundary tests for allow/deny paths and crawl limits.

