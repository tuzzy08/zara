# ISSUE-017: Runtime manifest preview

Issue link: https://github.com/tuzzy08/zara/issues/17

## Goal

Deliver Runtime manifest preview for the Backend area in the MVP Builder milestone.

## Acceptance Criteria

- Users can preview compiled manifest before publish
- Preview includes runtime, telephony, memory, tools, and budget
- Schema tests cover preview output

## Work Completed

- Added RED coverage in `packages/core/src/workflow.test.ts` for runtime manifest preview output across runtime, telephony, memory, budget, tool bindings, condition routes, exit nodes, and escalation policy.
- Implemented `buildRuntimeManifestPreview` in `packages/core/src/workflow.ts` so preview generation shares the same graph contract as validation and publishing.
- Updated `apps/web/src/WorkflowBuilder.tsx` to render manifest preview cards and rows for runtime, telephony, memory scopes, budget, tool request posture, condition routes, exit nodes, escalation policy, and serialized preview size.
- Verified tool inspectors now capture API request metadata for webhook-style actions, including method, request URL, auth token reference, headers, and body template.
- Updated companion docs in `docs/Runtime-Manifests.md`, `docs/Feature-Flows.md`, `docs/API.md`, and `docs/Frontend-Architecture.md`.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/workflow.test.ts` failed before runtime preview helpers existed.
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/workflowBuilderIds.test.ts`
- GREEN: `npm.cmd run typecheck`
- Browser verification at `http://127.0.0.1:4173/workflows` confirmed the draft manifest preview updates as selected nodes change and remains visible after publish.

## Pending Work

- Issue scope is complete.
- Follow-on work in ISSUE-018 should keep the later runtime compiler structurally aligned with this preview contract.

## Risks And Edge Cases

- Missing telephony route
- Budget over limit
- Preview parity with the eventual backend compiler must stay under test so UI preview and runtime execution do not drift.

## Decisions

- Priority: P1
- Labels: backend, runtime, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Draft manifest preview is derived from the same shared workflow graph used by validation and publishing.
- Preview surfaces request-aware tool configuration and route termination details early so tenants can catch runtime blockers before publish.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then continue with ISSUE-018 so the backend runtime compiler stays structurally compatible with the preview tenants already see in the builder.
