# ISSUE-119: Tenant memory page

Issue link: https://github.com/tuzzy08/zara/issues/119

## Goal

Deliver a real tenant-facing memory page for `/memory` so operators can inspect and control memory, drafts, knowledge, ingestion, and privacy state from the dashboard sidebar.

## Acceptance Criteria

- `/memory` renders a tenant-facing memory page instead of the dashboard placeholder
- Users can inspect approved memory, pending drafts, knowledge records, ingestion status, and audit posture
- Edit, disable, delete, approve, reject, export, and retention actions use the tenant-scoped memory APIs safely

## Work Completed

- RED: added tenant app route smoke coverage proving `/memory` must render memory controls, pending drafts, knowledge, ingestion status, and approval actions.
- GREEN: added `TenantMemoryScreen` and `tenantMemoryApi.ts`, then wired `/memory` in `App.tsx`.
- Implemented memory export loading, approved memory list, draft approve/reject actions, disable/delete actions, knowledge and ingestion status, export affordance, and retention purge.
- Kept embedding details safe by showing export/audit metadata without rendering raw vectors.
- Created an imagegen mockup for the tenant pages at `C:\Users\Lenovo\.codex\generated_images\019e4708-d206-7400-bf03-6bdafa252492\ig_0abcab3dfada4980016a103d50f0688191adbcb6bdb9c0607d.png`.
- Updated `docs/Frontend-Architecture.md`, `docs/Roadmap.md`, and `docs/Issue-Backlog.md`.

## Tests Run

- `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=forks`
- `npm.cmd run typecheck`
- `npm.cmd run lint`

## Pending Work

- None.

## Risks And Edge Cases

- Deleting or disabling a record reloads tenant memory export state after the mutation.
- Legal hold behavior remains enforced by the backend retention/delete APIs.
- Export is represented as a tenant-safe export package action and does not expose raw embeddings.

## Decisions

- Priority: P1
- Labels: frontend, memory, security, tdd-required
- Handover docs are mandatory for every pass on this issue.
- The page uses `GET /memory/export` as the operator overview source because it already includes records, drafts, knowledge, ingestions, and embedding metadata.

## Next Recommended Step

Issue complete. Future polish can add record-specific inspectors without changing the tenant-scoped API boundary.
