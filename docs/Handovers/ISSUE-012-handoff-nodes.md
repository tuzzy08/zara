# ISSUE-012: Handoff nodes

External: [GitHub #12](https://github.com/tuzzy08/zara/issues/12)

Issue link: https://github.com/tuzzy08/zara/issues/12

## Goal

Deliver Handoff nodes for the Runtime area in the MVP Builder milestone.

## Acceptance Criteria

- Handoff node targets a valid specialist
- Manifest distinguishes handoff from agent-as-tool
- Tests cover invalid targets

## Work Completed

- Added RED/GREEN coverage in `packages/core/src/workflow.test.ts` for handoff-node creation, invalid specialist targets, and manifest separation between handoffs and tool bindings.
- Implemented `createHandoffNode` and handoff validation in `packages/core/src/workflow.ts`.
- Updated `apps/web/src/WorkflowBuilder.tsx` so the builder can add handoff nodes, pick a specialist target from existing agents, edit the handoff reason, and preview the route in the draft manifest.
- Updated builder styling in `apps/web/src/styles.css` and smoke coverage in `apps/web/src/app.test.tsx`.
- Updated companion docs in `docs/Feature-Flows.md`, `docs/Runtime-Manifests.md`, and `docs/Frontend-Architecture.md`.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/workflow.test.ts apps/web/src/app.test.tsx`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run test:run -- --pool=threads`
- `npm.cmd run build --workspace @zara/web`
- Browser verification at `http://127.0.0.1:4173/workflows?verify=1` confirming handoff nodes render on canvas and appear separately from tool bindings in manifest preview.

## Pending Work

- Issue scope is complete.
- Follow-on work lives in ISSUE-013, ISSUE-016, and ISSUE-017 so branch semantics and publishing can reason about handoff routes.

## Risks And Edge Cases

- Handoff loop
- Specialist disabled
- Future runtime work should validate target specialist availability against published-role lifecycle, not only draft graph existence.

## Decisions

- Priority: P1
- Labels: runtime, frontend, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Handoff nodes remain separate from agent nodes so specialist routing is explicit in validation, manifest preview, and later runtime telemetry.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then continue with ISSUE-013 so branching rules can target the new handoff nodes cleanly.
