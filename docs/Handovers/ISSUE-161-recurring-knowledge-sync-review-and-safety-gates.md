# ISSUE-161: Recurring knowledge sync review and safety gates

Status: Implemented
External: [Linear ZAR-115](https://linear.app/zara-voice/issue/ZAR-115/issue-161-recurring-knowledge-sync-review-and-safety-gates)

## Goal

Add manual and daily recurring knowledge sync with review-gated diffs, deletion drafts, conflict handling, and sensitivity gates.

## Work Completed

- Added snapshot/manual/daily knowledge source sync contracts, source sync metadata, and the recurring refresh route.
- Implemented review-gated recurring updates so changed source text creates update drafts and does not mutate active runtime knowledge until approval.
- Implemented confirmed source deletion drafts so approved knowledge remains active until deletion approval marks it stale.
- Implemented degraded provider sync for auth/permission failures that pauses refresh and preserves the last approved snapshot.
- Added sensitivity classification for PII, credentials/secrets, payment, health, legal, and internal-only signals, including activation blockers for obvious credentials/secrets.
- Added approval authority metadata for high-risk, sensitive, and deletion drafts using existing tenant/workspace roles, with audited actor, role, workspace, reason, before state, after state, and timestamp.
- Added active-call snapshot retrieval behavior when callers pass the call-start `now` timestamp.
- Added high-risk knowledge conflict validation to workflow publishing and blocked publish only for unresolved high-risk conflicts.
- Updated `/memory` to expose sync mode selection, source sync status metadata, sensitivity labels, activation blockers, and real shell actor/role metadata for approvals.
- Updated API, memory, design, roadmap, and backlog docs.

## Tests Run

- `npm run test:run -- apps/api/src/memory/knowledge-sync-safety.test.ts apps/api/src/memory/memory.controller.test.ts apps/api/src/workflows/workflows.controller.test.ts apps/api/src/memory/memory.persistence.test.ts` - passed, 31 tests.
- `npm run typecheck --workspace @zara/api` - passed.
- `npm run typecheck --workspace @zara/web` - passed.

## Pending Work

- None for ISSUE-161 acceptance criteria.

## Risks And Edge Cases

- Daily scheduling stores the next sync timestamp and accepts daily-triggered refreshes; an actual background scheduler remains a later orchestration concern.
- The memory approval route follows the current API pattern of receiving actor/role metadata in the request body; the tenant UI now sends shell-derived actor and role, and future auth-context hardening should move that authority resolution fully server-side.
- Provider refreshes in this slice operate on already-resolved text/failure/deletion inputs; provider-specific fetch/parsing jobs remain provider-connector work.

## Decisions

- V1 sync supports snapshot, manual recurring refresh, and daily recurring refresh only.
- Sync never directly changes active runtime knowledge.
- Source deletion creates a deletion draft instead of immediately removing approved records.
- Auth or permission failure degrades and pauses the source instead of deleting active knowledge.
- Credentials/secrets are activation blockers, not merely warning labels.
- High-risk conflict warnings block workflow publish only for unresolved high-risk knowledge kinds.

## Next Recommended Step

Proceed to ISSUE-162 and start the Salesforce connector v1 contract tests against the registry/tool-grant foundation.
