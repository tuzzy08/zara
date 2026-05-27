# ISSUE-016: Version publishing

Issue link: https://github.com/tuzzy08/zara/issues/16

## Goal

Deliver Version publishing for the Backend area in the MVP Builder milestone.

## Acceptance Criteria

- Published versions are immutable
- Calls pin to a published version
- Draft changes do not affect active calls

## Work Completed

- Added RED coverage in `packages/core/src/workflow.test.ts` for immutable publish snapshots, version increments, and active-call pinning.
- Implemented `publishWorkflowVersion` and `pinPublishedWorkflowVersion` in `packages/core/src/workflow.ts` so validated drafts become immutable version payloads and live calls pin to the published snapshot they started with.
- Updated `apps/web/src/WorkflowBuilder.tsx` with publish actions, published-version history, active-call pin messaging, and version-aware button state.
- Updated builder regression coverage in `apps/web/src/workflowBuilderIds.test.ts` so deleted nodes cannot trigger duplicate IDs during later publishes.
- Updated roadmap and feature docs to reflect that the publishable draft slice is now implemented.
- Follow-up pass on 2026-05-25 removed the Published versions section from the workflow inspector while keeping immutable publish behavior in the domain layer.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/workflow.test.ts` failed before immutable publish helpers existed.
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/workflowBuilderIds.test.ts`
- GREEN: `npm.cmd run typecheck`
- Browser verification at `http://127.0.0.1:4173/workflows` confirmed publish increments from `v1` to `v2` and shows the active-call pin against the earlier snapshot.
- RED: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "published version history" --pool=threads` failed while the inspector still rendered the Published versions section.
- GREEN: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "published version history" --pool=threads`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/WorkflowBuilder.test.tsx apps/web/src/liveSandboxAudio.test.ts apps/web/src/liveSandboxEventFormatting.test.ts --pool=threads`
- GREEN: `npm.cmd run typecheck --workspace @zara/web`

## Pending Work

- Issue scope is complete.
- Follow-on backend persistence and optimistic concurrency handling move to ISSUE-018 and later workflow API slices.

## Risks And Edge Cases

- Concurrent publishes
- Rollback to prior version
- This slice currently proves immutable publish behavior in shared domain logic and UI. Database-level version locking still belongs to the future NestJS workflow routes.

## Decisions

- Priority: P0
- Labels: backend, runtime, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Published versions are treated as immutable snapshots of both graph and manifest preview state.
- Active calls pin to the published snapshot, not the mutable draft.
- Inspector chrome should prioritize the editable draft and validation state; version history can live outside the inspector when a release-management surface is introduced.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then continue with ISSUE-018 so publish snapshots flow into the runtime compiler and persisted workflow-version records.
