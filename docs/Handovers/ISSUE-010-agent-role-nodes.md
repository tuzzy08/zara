# ISSUE-010: Agent role nodes

Issue link: https://github.com/tuzzy08/zara/issues/10

## Goal

Deliver configurable agent role nodes for the tenant workflow builder.

## Work Completed

- Added `AgentRoleNodeConfig` and `createAgentRoleNode` in `packages/core/src/workflow.ts`.
- Agent role nodes now capture role type, role name, instructions, language policy, default model tier, and reusable-specialist intent.
- Added the selected-agent inspector in `apps/web/src/WorkflowBuilder.tsx` with role name, instructions, role type, model tier, default language, and reusable specialist controls.
- Builder node cards display role metadata such as model tier and language support.
- Validation blocks publish when required role fields are missing.
- Added unit coverage for role config capture and missing required role fields in `packages/core/src/workflow.test.ts`.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/workflow.test.ts` failed before role-node helpers existed.
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=threads`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/web`
- Browser validation: confirmed the inspector renders for `Front desk triage` and exposes role fields without horizontal clipping.

## Pending Work

- Add reusable specialist selection from a persisted role library when backend draft persistence exists.
- Expand language controls to manage multiple supported languages instead of only the default language select.

## Risks And Edge Cases

- Duplicate role names are validated in core, but the UI does not yet offer a dedicated duplicate-resolution flow.
- Unsupported language code validation exists in core; the current UI uses a constrained select for the default language.

## Decisions

- Kept role-node config in `@zara/core` so frontend, API, manifest compiler, and runtime can share the same shape.
- Kept specialist reuse as an explicit boolean in the role config until a persisted specialist library is implemented.

## Next Recommended Step

Implement tool and handoff node editors next so agent roles can call approved tools and hand off to real specialists.
