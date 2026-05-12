# ISSUE-011: Tool nodes

Issue link: https://github.com/tuzzy08/zara/issues/11

## Goal

Deliver Tool nodes for the Frontend area in the MVP Builder milestone.

## Acceptance Criteria

- Tool node binds to a permitted integration tool
- Risk and approval state are visible
- Missing credentials block publish

## Work Completed

- Added RED/GREEN coverage in `packages/core/src/workflow.test.ts` for tool-node creation, connector/risk/approval capture, and publish blocking when credentials are missing.
- Implemented first-class tool-node contracts in `packages/core/src/workflow.ts` with `createToolNode`, draft manifest tool bindings, and validation for missing binding, missing authorization, and revoked connections.
- Updated `apps/web/src/WorkflowBuilder.tsx` so the builder can add tool nodes, inspect connector state, choose a permitted action, switch connection state, and surface the tool in manifest preview.
- Updated builder styling in `apps/web/src/styles.css` and smoke coverage in `apps/web/src/app.test.tsx`.
- Updated companion docs in `docs/Feature-Flows.md`, `docs/Runtime-Manifests.md`, and `docs/Frontend-Architecture.md`.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/workflow.test.ts apps/web/src/app.test.tsx`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run test:run -- --pool=threads`
- `npm.cmd run build --workspace @zara/web`
- Browser verification at `http://127.0.0.1:4173/workflows?verify=1` covering add-tool interaction, publish blocking on missing auth, and draft-manifest updates.

## Pending Work

- Issue scope is complete.
- Follow-on work lives in ISSUE-013, ISSUE-016, and ISSUE-017 for condition routing, publishing, and runtime manifest preview.

## Risks And Edge Cases

- Revoked integration
- High-risk tool without approval
- Connector-specific permission scopes still need backend enforcement once integration APIs arrive.

## Decisions

- Priority: P1
- Labels: frontend, integrations, tdd-required
- Handover docs are mandatory for every pass on this issue.
- Builder uses the shared `@zara/core` tool-node contract instead of a separate UI-only shape.
- Missing and revoked connection states are explicit builder/runtime states, not ad hoc text flags.

## Next Recommended Step

Read AGENTS.md, docs/PRD.md, docs/Architecture.md, docs/Roadmap.md, and this handover. Then continue with ISSUE-013 so route conditions can compose with the new tool-node manifest shape.
