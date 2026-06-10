# ISSUE-116: Reusable specialist role library

External: [Linear ZAR-125](https://linear.app/zara-voice/issue/ZAR-125/issue-116-reusable-specialist-role-library)

Issue link: https://github.com/tuzzy08/zara/issues/116

## Goal

Deliver a reusable specialist role library so tenant builders can save, select, and version specialist agent roles across workflow drafts.

## Acceptance Criteria

- Tenant builders can save an agent role as a reusable specialist template
- Reusable specialists can be selected when configuring agent and handoff nodes
- Updating a reusable specialist does not silently mutate already-published workflow versions

## Work Completed

- Added shared specialist template contracts in `packages/core/src/workflow.ts`.
- Added `createSpecialistRoleTemplate`, `updateSpecialistRoleTemplate`, and `applySpecialistRoleTemplate`.
- Agent role configs now preserve `specialistTemplateId` and `specialistTemplateVersion`.
- Published workflow versions keep cloned role snapshots in `roles` and `serializedGraph`, so later template updates do not mutate already-published versions.
- Added a workspace-scoped specialist template registry in the tenant workflow builder using `zara.web.specialist-templates.v1`.
- Agent inspectors can save the current role as a reusable specialist and apply saved specialist templates.
- Handoff inspectors can use a template shortcut to target an existing agent role created from the matching reusable specialist.
- Default reusable agent roles that ship on the initial canvas, such as Front desk triage and Billing specialist, are now seeded into the reusable specialist selector for each workspace.
- Updated `docs/Issue-Backlog.md`, `docs/Roadmap.md`, and `docs/Frontend-Architecture.md`.

## Tests Run

- RED: `npm.cmd run test:run -- packages/core/src/workflow.test.ts -t "saves reusable specialist templates"` failed because `createSpecialistRoleTemplate` did not exist.
- GREEN: `npm.cmd run test:run -- packages/core/src/workflow.test.ts -t "saves reusable specialist templates"` passed after adding the shared template contract.
- RED: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "reusable specialist templates|supported languages"` failed because the builder had no template controls.
- GREEN: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "reusable specialist templates|supported languages"` passed after adding inspector save/apply controls.
- RED: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "reloads reusable specialist"` failed because templates did not persist across remounts.
- GREEN: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "reloads reusable specialist"` passed after adding workspace-scoped local persistence.
- Focused verification: `npm.cmd run test:run -- packages/core/src/workflow.test.ts apps/web/src/WorkflowBuilder.test.tsx` passed with 2 test files and 20 tests.
- Type verification: `npm.cmd run typecheck` passed.
- Lint verification: `npm.cmd run lint` passed.
- Build verification: `npm.cmd run build` passed. Vite reported the existing tenant-app large chunk warning.
- Full suite: `npm.cmd run test:run -- --maxWorkers=1 --no-file-parallelism` passed with 48 test files and 239 tests. The suite emitted the existing logged AssemblyAI sandbox-provider failure fixture while still exiting successfully.
- RED/GREEN: `npm.cmd run test:run -- --pool=forks --fileParallelism=false apps/web/src/WorkflowBuilder.test.tsx -t "reusable specialist"` confirmed default canvas roles appear in the reusable specialist selector.

## Pending Work

- None for ISSUE-116 acceptance criteria.

## Risks And Edge Cases

- Duplicate specialist template names inside a workspace are rejected by the shared template creation helper.
- Template deletion is not exposed in this issue; existing draft nodes keep cloned role config and published versions keep serialized snapshots.
- Published workflow references an older specialist snapshot by carrying the template id/version plus cloned role fields.

## Decisions

- Templates are workspace-scoped and persisted client-side in the current builder storage layer until the future backend draft/template store owns workflow persistence end to end.
- Seeded default specialist templates are workspace-scoped defaults merged with saved templates; saved templates can still update/override the seeded version.
- Applying a template copies the role config into the agent node instead of creating a live reference, which protects published workflow immutability.
- Handoff template shortcuts target an existing agent node derived from that template; handoffs still validate against concrete agent nodes.

## Next Recommended Step

Use the specialist template controls in the workflow builder for reusable role setup; preserve the shared snapshot contract if template storage moves behind an API later.
