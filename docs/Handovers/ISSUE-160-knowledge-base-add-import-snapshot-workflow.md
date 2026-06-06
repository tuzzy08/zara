# ISSUE-160: Knowledge base add/import snapshot workflow

Status: Implemented
External: [Linear ZAR-114](https://linear.app/zara-voice/issue/ZAR-114/issue-160-knowledge-base-addimport-snapshot-workflow)

## Goal

Make knowledge-base creation a first-class tenant flow with snapshot imports, extracted record review, and scoped activation.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependency on ISSUE-158.
- Started implementation pass on 2026-06-06.
- Added memory API support for knowledge source snapshots via `POST /memory/knowledge/sources`.
- Added record-level knowledge review drafts and approval via `POST /memory/knowledge/review-drafts/:draftId/approve`.
- Expanded knowledge taxonomy to FAQ, policy, procedure, troubleshooting, pricing, escalation, legal/compliance, and general reference.
- Added workspace/workflow scope metadata to knowledge records and retrieval.
- Added provider-import authorization against connected provider availability plus active `knowledge-source` grants.
- Added runtime manifest `workflowId` so published manifests carry the frozen workflow/workspace retrieval scope.
- Added tenant `/memory` Add source UI for manual text, URL, PDF, and provider import entries, plus source snapshot and review draft surfaces.
- Updated Memory, API, Roadmap, and Design docs for the source snapshot/review contract.

## Tests Run

- `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts apps/api/src/memory/memory.persistence.test.ts apps/api/src/workflows/workflows.controller.test.ts`
- `npm.cmd run test:run -- packages/core/src/runtime.test.ts packages/core/src/workflow.test.ts`
- `npm.cmd run typecheck --workspace @zara/web`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "renders tenant memory controls"`
- `node_modules\.bin\eslint.cmd apps\web\src\tenantMemoryApi.ts apps\web\src\TenantMemoryScreen.tsx apps\web\src\app.test.tsx`
- `npm.cmd run typecheck`
- `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts apps/api/src/memory/memory.persistence.test.ts apps/api/src/workflows/workflows.controller.test.ts packages/core/src/runtime.test.ts packages/core/src/workflow.test.ts`

## Pending Work

- ISSUE-161 owns recurring/manual refresh, daily sync, update/delete drafts, conflict safety gates, sensitivity scanning, and approval authority hardening.

## Risks And Edge Cases

- Imported sources can produce no usable records.
- Provider import currently accepts already-resolved source text and metadata; recurring provider fetch/sync belongs to ISSUE-161 and later provider-specific source connector issues.
- High-risk type suggestions require explicit operator confirmation before approval.
- Runtime retrieval excludes unapproved drafts and filters by published version or frozen workspace/workflow scope.
- Active-call snapshot stability for recurring changes remains in ISSUE-161.

## Decisions

- Review happens at extracted-record level, not embedding chunk level.
- Default scope is active workspace with optional workflow selection.
- Published manifests freeze allowed knowledge scope, while new approved records inside scope can serve new calls.
- Provider imports must use server-known provider capabilities plus active `knowledge-source` grants rather than trusting user-supplied provider metadata alone.
- Manual entries activate immediately only when the user chooses a record type; URL/PDF/provider imports always create review drafts first.

## Next Recommended Step

Begin ISSUE-161 with failing tests for manual refresh/daily sync creating review-gated update drafts without mutating active runtime knowledge.
