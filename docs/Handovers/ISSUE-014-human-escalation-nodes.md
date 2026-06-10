# ISSUE-014: Human escalation nodes

External: [GitHub #14](https://github.com/tuzzy08/zara/issues/14)

Issue link: https://github.com/tuzzy08/zara/issues/14

## Goal

Deliver Human escalation nodes for the Runtime area in the MVP Builder milestone.

## Acceptance Criteria

- Escalation node binds to a queue
- Fallback callback behavior is configurable
- Manifest includes escalation policy

## Work Completed

- Added RED/GREEN coverage in `packages/core/src/workflow.test.ts` for escalation-node creation, queue/fallback validation, and manifest escalation policy output.
- Implemented `createHumanEscalationNode`, escalation validation, and draft escalation policy output in `packages/core/src/workflow.ts`.
- Updated `apps/web/src/WorkflowBuilder.tsx` so the builder can add escalation nodes, bind them to a queue, choose fallback mode, edit the caller-facing fallback message, and preview escalation policy before publish.
- Updated builder styling in `apps/web/src/styles.css` and smoke coverage in `apps/web/src/app.test.tsx`.
- Updated companion docs in `docs/Feature-Flows.md`, `docs/Runtime-Manifests.md`, and `docs/Frontend-Architecture.md`.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/workflow.test.ts apps/web/src/app.test.tsx`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run test:run -- --pool=threads`
- `npm.cmd run build --workspace @zara/web`
- Browser verification at `http://127.0.0.1:4173/workflows?verify=1` confirming escalation queue state appears in the library, inspector, validation, and draft manifest preview.

## Pending Work

- Issue scope is complete.
- Follow-on work lives in ISSUE-016, ISSUE-017, and monitoring issues later in the roadmap.

## Risks And Edge Cases

- Queue offline
- No available human
- Runtime queue capacity, SLA timers, and operator acceptance are still future backend concerns.

## Decisions

- Priority: P1
- Labels: runtime, frontend, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Escalation configuration is compiled into the same draft manifest preview that later publishing will consume.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then continue with ISSUE-016 and ISSUE-017 so escalation policy flows from draft preview into immutable publish artifacts.
