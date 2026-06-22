# ISSUE-168: Full website crawling knowledge source after registry stabilization

Status: Implemented
External: [Linear ZAR-122](https://linear.app/zara-voice/issue/ZAR-122/issue-168-full-website-crawling-knowledge-source-after-registry)

## Goal

Add full website crawling as a registry-backed knowledge source after the snapshot and recurring review model are stable.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependency on ISSUE-161.
- Started implementation pass on 2026-06-08.
- Moved Linear ZAR-122, local backlog, and this handover to In Progress.
- Delegated tenant memory UI/API typing support for `website_crawl` to a worker agent while backend crawler behavior is implemented locally.
- Added tenant memory UI/API typing support for `website_crawl`: the memory page now exposes allowed website root URL, crawl limit, exclude paths, workspace/workflow scope, and manual/daily sync without exposing provider API/base URL configuration.
- Added backend `website_crawl` source creation with same-origin/root confinement, exclude paths, crawl limits, robots disallow handling, canonical/deduplication handling, auth/binary/large/fetch/empty page statuses, readable title/body extraction, source snapshots with per-page status, and review-gated page-level drafts.
- Added recurring website crawl refresh that produces review-gated new, update, and deletion drafts while leaving active approved knowledge unchanged until approval.
- Preserved per-page source URLs through draft approval into active knowledge records.
- Added crawler status typing and file-backed memory repository clone support for `source.crawl`.
- Added ADR-002 for website crawl boundaries and updated API/Memory docs.
- Follow-up on 2026-06-22: added shared outbound egress validation before website crawl fetches so internal network and cloud metadata destinations are blocked before crawler HTTP requests.

## Tests Run

- `node node_modules/vitest/vitest.mjs run apps/web/src/app.test.tsx -t "renders tenant memory controls instead of the dashboard placeholder"`
- `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json`
- `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts -t "website crawls|crawler drafts|website sources"` (passed)
- `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts` (passed, 26 tests)
- `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts apps/api/src/memory/memory.persistence.test.ts` (passed, 29 tests)
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "renders tenant memory controls instead of the dashboard placeholder" --pool=threads` (passed)
- `npm.cmd run typecheck --workspace @zara/api` (passed)
- `npm.cmd run typecheck --workspace @zara/web` (passed)
- RED security follow-up: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts -t "internal network destinations" --pool=forks`
  - Failed as expected because `http://127.0.0.1/admin` was accepted and crawled.
- GREEN security follow-up: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts -t "internal network destinations" --pool=forks`
  - Passed: 1 file, focused test passed.
- Public crawl regression follow-up: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts -t "crawls website sources inside the allowed root" --pool=forks`
  - Passed.

## Pending Work

- None for ISSUE-168 acceptance criteria.

## Risks And Edge Cases

- Crawling can escape intended boundaries or ingest irrelevant/binary content.
- Crawling can target internal network or metadata services unless outbound destinations are validated before fetch; the shared egress policy now covers this path.
- Robots, auth, redirects, and page failures need visible statuses.
- Full crawl must not appear in pickers before end-to-end ingestion works.

## Decisions

- V1 single URL import remains separate from full crawling.
- Runtime retrieval uses approved indexed records only, never live website search.
- Website crawl exposes tenant-configurable allowed root, excludes, and limits only; fetch, normalization, auth, redirect, binary, large-page, and status handling remain Zara-owned backend behavior.
- Website crawl HTTP requests use the shared outbound egress policy before fetch; public HTTP/HTTPS roots remain allowed.
- ADR-002 records the default 25-page crawl limit, 1-100 clamp, same-origin/root-path confinement, 250 KB HTML page limit, and review-gated diff behavior.

## Next Recommended Step

Proceed to ISSUE-169 for Confluence and SharePoint knowledge-source connectors.
