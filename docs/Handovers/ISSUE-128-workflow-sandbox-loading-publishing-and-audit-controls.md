# ISSUE-128: Workflow sandbox loading, publishing, and audit controls

## Status

Implemented.

## Work completed

- Added workflow-page loading for existing workspace published workflows, including graph-to-builder-node conversion and a workflow selector that does not show version suffixes.
- Kept workflow naming available in the builder and publish dialog while removing automatic version suffixes from published workflow names.
- Added an overwrite confirmation when the publish name matches an existing workflow in the selected workspace; accepting it replaces the matching saved workflow entry.
- Changed agent model selection from a freeform text input to approved provider model dropdowns. Gemini presets now use `gemini-3.1-flash-lite`, `gemini-3.5-flash`, and `gemini-3.1-pro-preview`.
- Updated Gemini backend defaults and direct provider fallbacks to the same configured model IDs.
- Changed Better Auth database selection so non-test environments require configured Postgres storage instead of falling back to in-memory auth.
- Changed live sandbox ending so transcripts and event replay remain visible until the dedicated reset action is used.
- Added a Reset sandbox button to the workflow drawer and tightened its action layout.
- Added active-call workflow animation decoration for live traversal nodes and edges, respecting reduced-motion preferences.
- Removed visible version suffixes from the standalone sandbox workflow selector.
- Follow-up on 2026-06-04: added an explicit publish release mode so operators can choose between creating a new workflow and overwriting an existing workflow, including an overwrite-target dropdown that works even when the release name changes.
- Follow-up on 2026-06-04: reset the publish dialog's native `dialog` margin/border behavior and footer wrapping so the modal stays centered and aligned in the workflow page overlay.

## Tests run

- `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx`
- `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "asks before overwriting" --maxWorkers=1 --pool=threads --no-isolate`
- `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx --maxWorkers=1 --pool=threads --no-isolate`
- `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "lets users name the workflow"`
- `npm.cmd run test:run -- apps/api/src/auth/better-auth.instance.test.ts`
- `npm.cmd run test:run -- apps/api/src/auth/better-auth.instance.test.ts apps/api/src/auth/better-auth.controller.test.ts`
- `npm.cmd run test:run -- apps/web/src/useLiveSandboxSession.test.tsx apps/web/src/liveSandboxEventFormatting.test.ts`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-env.test.ts apps/api/src/sandbox-live-sessions/gemini-chat-text.provider.test.ts apps/api/src/sandbox-live-sessions/sandbox-text-model-provider-factory.test.ts`
- `npm.cmd run test:run -- packages/core/src/workflow.test.ts packages/core/src/runtime.test.ts`
- `npm.cmd run test:run -- apps/web/src/App.test.tsx -t "opens an inline sandbox drawer|publishes builder manifests|runs a routed telephony sandbox path|loads sandbox workflows only|surfaces premium runtime policy|connect a BYO Twilio|telephony heartbeats"`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build --workspace @zara/web`
- Browser smoke on `http://127.0.0.1:4173/workflows`: signed up a throwaway local tenant, opened the publish dialog, edited `Workflow name`, published, and confirmed local published workflow storage and toolbar label did not include a visible version suffix.
- Browser smoke on `http://127.0.0.1:4173/workflows`: loaded a same-name workflow, confirmed the overwrite prompt rendered with an `Overwrite workflow` action, accepted it, and confirmed only one saved workflow with that name remained in local published workflow storage with no console errors.
- Follow-up on 2026-06-04: `npm.cmd exec -- vitest run apps/web/src/workflowBuilderToolCatalog.test.ts apps/web/src/workflowBuilderPublish.test.ts --pool=forks --maxWorkers=1 --reporter=dot`
- Follow-up on 2026-06-04: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-04: `git diff --check`
- UI test and browser smoke were skipped during the 2026-06-04 follow-up at the user's request.

## Pending work

- None for the corrected publish-name, overwrite-target, and auth-persistence behavior.

## Risks

- Existing duplicate workflow names from prior local state can still appear in the picker; the overwrite flow now removes matching saved workflow entries when the user confirms replacement.
- Loading a published workflow with malformed node config falls back to generic node rendering; this preserves the canvas but may require manual repair before publishing.
- Active-call animation currently marks the latest event with a `nodeId` as current and animates all edges while active; richer path-only animation can be added once runtime emits more granular path state.
- Browser/UI smoke coverage was intentionally skipped on 2026-06-04, so the centered dialog fix has type and helper coverage but no visual smoke in this pass.

## Decisions

- Kept version metadata internal while removing user-facing `v1` suffixes from workflow names.
- Kept user workflow naming editable during publish; the removed behavior is only the automatic visible version suffix.
- Treated unchanged/existing workflow names as a publish-time overwrite choice instead of blocking draft sandbox runs.
- Required durable Postgres-backed Better Auth storage outside tests instead of permitting local in-memory auth.
- Preserved sandbox replay on end-call and close; reset is now the explicit destructive action for transcript/event clearing.
- Used select-only model controls to prevent invalid manual model IDs from entering new agent configurations.
- Kept create-new as the default release mode unless the workflow name already matches an existing workflow, while still exposing overwrite as an explicit operator choice.
- Overwrite now targets the selected existing workflow ID and replaces saved versions for that workflow instead of relying only on name-conflict detection.

## Next recommended step

Run the skipped authenticated UI smoke when UI testing is back in scope, or continue with the next requested workflow/sandbox polish item.
