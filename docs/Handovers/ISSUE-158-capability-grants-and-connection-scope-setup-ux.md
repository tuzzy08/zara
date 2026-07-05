# ISSUE-158: Capability grants and connection scope setup UX

Status: Implemented
External: [Linear ZAR-112](https://linear.app/zara-voice/issue/ZAR-112/issue-158-capability-grants-and-connection-scope-setup-ux)

## Goal

Add scoped capability grants and simple organization/workspace connection setup UX for integrations.

## Work Completed

- Created the Linear issue and local backlog entry.
- Recorded dependency on ISSUE-157.
- Started implementation pass after ZAR-111/ISSUE-157 was completed and Linear ZAR-112 was moved to In Progress.
- Added organization-wide and workspace-owned integration connection availability to OAuth, Zendesk API-token configuration, persisted state, connection listing, and tenant UI loading.
- Added audited workspace-to-organization promotion for workspace-owned connections. Promotion changes availability only and does not create capability grants.
- Added scoped tool grant validation against tenant role, provider match, connection availability, and provider-required OAuth scopes. Missing scopes return reconnect metadata.
- Added publish-time validation for connector tool bindings with missing grants, unavailable workspace-owned credentials, and insufficient scopes.
- Added a backend workflow publish endpoint that compiles the published runtime manifest and blocks publish when scoped integration tool grants are invalid.
- Wired the tenant workflow builder publish dialog to the backend workflow publish endpoint and saves only the server-returned published version after validation succeeds.
- Surfaced backend publish/grant validation failures in the publish dialog and toast without mutating the local published workflow registry.
- Added a published live-sandbox session guard so already-published manifests with incomplete integration grants cannot start a published sandbox run.
- Tightened publish grant validation to require active `agent-tool` grants for every assigned role; knowledge-source/post-call grants no longer satisfy agent tool bindings.
- Added delete dependency cleanup: delete removes the connection, encrypted credential material, and dependent integration grants through the single public removal path.
- Updated the tenant integrations page to select setup scope, show connection scope labels, promote workspace-owned connections, and show paused grants.
- Added HubSpot `post-call-sync` capability metadata to the tenant-safe provider catalog.
- Tightened grant creation/runtime behavior so separate capability grants can coexist, unsupported provider/capability combinations are rejected, and non-agent capability grants cannot authorize runtime agent-tool execution.
- Added a catalog-driven tenant integrations capability setup section that shows agent tools, knowledge source, and post-call sync lanes with active/paused/not-configured status by provider.
- Added support, sales, and ecommerce setup preset preview/template helpers with risky write tools defaulting approval-required and copyable templates that omit credentials, OAuth grants, connection IDs, grant IDs, source IDs, and workspace-owned source access.
- Adjusted dashboard active tool grant metrics to count active `agent-tool` grants only.
- Added inline capability grant configuration controls on the tenant integrations page so tenant admins can choose a published workflow, provider connection, provider tool, approval posture, and save scoped `agent-tool`, `knowledge-source`, or `post-call-sync` grants through the real integrations grant endpoint.
- Added a display-ready setup-copy preview helper that projects safe copyable templates into required selection labels, capability rows, connection-scope copy, and an explicit not-cloned safety list without cloning credentials, OAuth grants, connection IDs, grant IDs, source IDs, or workspace-owned source access.
- Wired support, sales, and ecommerce setup preset previews into the tenant integrations page with editable include toggles and approval posture before any grant save flow.
- Wired setup-copy previews into the tenant integrations page so copied workspace setup plans show required target selections, provider connection/grant review, source category/risky-write confirmations, capability rows, and the not-cloned safety list before any tenant action.
- Added catalog-backed required provider scopes and tenant reconnect prompts that disable scoped grant saves when the selected connection lacks a required provider scope, then request the missing scopes during reconnect.
- Follow-up on 2026-06-10: fixed tenant integrations responsive layout so connection actions and capability grant forms stay inside the card instead of clipping off the right edge. Capability setup forms now drop below their lane header and auto-fit to the available card width.
- Follow-up on 2026-06-10: fixed the scoped capability grant endpoint so incomplete legacy integration connections without scope metadata return a clear reconnect validation error instead of throwing a `TypeError` while saving Zendesk agent-tool access. Updated the tenant button copy from the internal "Save capability grant" language to action-specific labels such as "Enable selected tool".
- Follow-up on 2026-06-10: added Zendesk API-token reconnect through the credentials form for credential rotation. Added tenant integration connection deletion controls and kept capability setup selectors limited to connected credentials.
- Follow-up on 2026-06-10: removed the guided capability preview card from the tenant integrations page, renamed the setup section to user-facing "Tool access", expanded the tool-access layout to use the full card width, and added an "Add Zendesk credentials" action when the last connected Zendesk credential has been deleted.
- Follow-up on 2026-06-10: removed the separate Tools and grants catalog, provider-health, and provider-specific credential cards from the tenant integrations page. Provider rows now own connection setup through a registry-schema modal, show a green connected label plus account label after configuration, include connect/test/delete actions in one place, and use provider-logo marks instead of letter placeholders.
- Follow-up on 2026-06-11: widened the tool-access row allocation so provider labels take less fixed horizontal space, fixed the integrations page grid so the tool card spans the full available width on desktop, then changed provider capability lanes to auto-fit on the same line while active configuration forms expand to the full row below.
- Follow-up on 2026-06-11: listed configured provider tools inside their capability lane, changed connected providers from Connect to Edit, made Configure toggle the inline setup panel open/closed, and added reusable tooltip plus slide-panel transition primitives to the integration actions.
- Follow-up on 2026-06-11: browser-verified the tenant integrations page with a newly created local account, configured a Zendesk connection through the modal, checked that connected providers show Edit, opened/closed the agent-tool setup panel, and fixed a 920px viewport overflow in the expanded capability form.
- Follow-up on 2026-06-11: tightened integration action tooltips after browser review showed oversized provider hints. Tooltip copy is now terse, inactive tooltips are visually hidden, and the provider row hover box measured at 110x23px for the Revoke action.
- Follow-up on 2026-06-11: changed integration provider summaries to show only `Configured Tools (n)` plus configured tool names, removing connection count, scope, and account label copy from the provider row. Tooltip colors now invert by theme: black with white text in light mode and white with black text in dark mode.
- Follow-up on 2026-07-01: disabled the integrations-page inline workflow/capability grant editor. Provider rows now retain capability status and configured-tool posture only, while agent tool assignment moved to the workflow inspector's Integration-first multi-select Toolbelt card.
- Follow-up on 2026-07-02: refactored backend agent-tool grants so new grants can be workflow-independent and publish-created grants are scoped by workspace, integration connection, tool, and optional concrete agent instead of workflow. A later 2026-07-02 cleanup now rejects new workflow-scoped grants and drops persisted legacy workflow-narrowed grants on read instead of broadening or honoring them.

## Tests Run

- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "shows scoped integration connections"`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "shows scoped integration connections|tenant integration tools|configure Zendesk credentials"`
- `npx.cmd tsc -p apps/web/tsconfig.json --noEmit`
- `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts apps/api/src/integrations/tool-permission-grants.service.test.ts apps/api/src/integrations/integrations.persistence.test.ts`
- `npx.cmd tsc -p apps/api/tsconfig.json --noEmit`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/workflowBuilderToolCatalog.test.ts -t "shows scoped integration connections|tenant integration tools|configure Zendesk credentials|lists only real tenant connections"`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts`
- `npm.cmd run test:run -- apps/api/src/workflows/workflows.controller.test.ts`
- `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts`
- `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts apps/api/src/workflows/workflows.controller.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts`
- `npm.cmd run typecheck`
- `npm.cmd run test:run -- apps/api/src`
- `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "does not save a local workflow"`
- `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx`
- `npx.cmd tsc -p apps/web/tsconfig.json --noEmit`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "publishes builder manifests|publishes workflow|published workflow|Support billing lane|Phone test"`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "loads sandbox workflows only from the active workspace"`
- `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx apps/web/src/app.test.tsx`
- `npm.cmd run lint`
- Follow-up on 2026-06-10: `git diff --check -- apps/web/src/styles.css`
- Follow-up on 2026-06-10: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-10: `npm.cmd run build --workspace @zara/web`
- Follow-up on 2026-06-10: RED verified `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts -t "legacy Zendesk"` failed with `Cannot read properties of undefined (reading 'scope')`.
- Follow-up on 2026-06-10: `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts -t "legacy Zendesk"`
- Follow-up on 2026-06-10: `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts`
- Follow-up on 2026-06-10: `npm.cmd run typecheck --workspace @zara/api`
- Follow-up on 2026-06-10: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-10: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "prompts reconnect" --pool=threads`
- Follow-up on 2026-06-10: RED verified `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "reconnects revoked Zendesk"` failed while Zendesk credential configure ignored `reconnectConnectionId`.
- Follow-up on 2026-06-10: RED verified `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "delete integration connections and reconnect Zendesk" --pool=threads` failed while lifecycle rows had only generic revoke/reconnect and no delete action.
- Follow-up on 2026-06-10: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "reconnects revoked Zendesk"`
- Follow-up on 2026-06-10: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "delete integration connections and reconnect Zendesk" --pool=threads`
- Follow-up on 2026-06-10: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts`
- Follow-up on 2026-06-10: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "configure Zendesk credentials|scoped integration connections|delete integration connections and reconnect Zendesk|capability setup lanes|save a scoped capability grant|prompts reconnect" --pool=threads`
- Follow-up on 2026-06-10: RED verified `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "capability setup lanes|Zendesk credential action|guided setup presets|save a scoped capability grant|prompts reconnect|dashboard" --pool=threads` failed while the page still showed `Capability setup`, still rendered guided previews, and had no post-delete Zendesk credential action.
- Follow-up on 2026-06-10: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "capability setup lanes|Zendesk credential action|guided setup presets|save a scoped capability grant|prompts reconnect|dashboard" --pool=threads`
- Follow-up on 2026-06-10: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-10: `npm.cmd run build --workspace @zara/web`
- Follow-up on 2026-06-10: RED verified `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "tenant integrations controls|tenant integration tools|configure Zendesk credentials|delete integration connections|Zendesk credential action|OAuth connection" --pool=threads` failed while the page still rendered provider-health/catalog cards, lacked modal setup, and still had direct OAuth handoff buttons.
- Follow-up on 2026-06-10: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "tenant integrations controls|tenant integration tools|configure Zendesk credentials|delete integration connections|Zendesk credential action|OAuth connection" --pool=threads`
- Follow-up on 2026-06-10: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-10: `npm.cmd run build --workspace @zara/web`
- Follow-up on 2026-06-10: `npm.cmd run lint`
- Follow-up on 2026-06-10: `git diff --check -- apps/web/src/TenantIntegrationsScreen.tsx apps/web/src/app.test.tsx apps/web/src/integrationProviderBranding.ts apps/web/src/styles.css`
- Follow-up on 2026-06-10: after CI caught exact-text regressions, reran `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/integrationProviderBranding.test.ts --pool=threads`
- Follow-up on 2026-06-10: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-10: `npm.cmd run lint`
- Follow-up on 2026-06-11: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/integrationProviderBranding.test.ts --pool=threads`
- Follow-up on 2026-06-11: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-11: `npm.cmd run lint`
- Follow-up on 2026-06-11: `npm.cmd run build --workspace @zara/web`
- Follow-up on 2026-06-11: RED verified `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "capability setup lanes|toggles integration capability" --pool=threads` failed while configured tools were not listed in the capability lane, Configure did not close the open setup panel, and connected providers still exposed Connect.
- Follow-up on 2026-06-11: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "capability setup lanes|toggles integration capability|configure Zendesk credentials|delete integration connections|Zendesk credential action" --pool=threads`
- Follow-up on 2026-06-11: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/integrationProviderBranding.test.ts --pool=threads`
- Follow-up on 2026-06-11: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-11: `npm.cmd run lint`
- Follow-up on 2026-06-11: `npm.cmd run build --workspace @zara/web`
- Follow-up on 2026-06-11: `git diff --check -- apps/web/src/TenantIntegrationsScreen.tsx apps/web/src/app.test.tsx apps/web/src/styles.css`
- Follow-up on 2026-06-11: Browser automation with Playwright against `http://localhost:4173/integrations`: created a local tenant account, configured Zendesk credentials in the modal, verified connected/Edit state, opened and closed Configure, and checked desktop plus 920px layout bounds.
- Follow-up on 2026-06-11: RED verified `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "capability setup lanes" --pool=threads` failed while the Zendesk provider row still exposed sentence-length tooltip copy.
- Follow-up on 2026-06-11: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "capability setup lanes" --pool=threads`
- Follow-up on 2026-06-11: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/integrationProviderBranding.test.ts --pool=threads`
- Follow-up on 2026-06-11: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-11: `npm.cmd run lint`
- Follow-up on 2026-06-11: `npm.cmd run build --workspace @zara/web`
- Follow-up on 2026-06-11: `git diff --check -- apps/web/src/TenantIntegrationsScreen.tsx apps/web/src/app.test.tsx apps/web/src/styles.css`
- Follow-up on 2026-06-11: Browser automation measured the visible Zendesk Revoke tooltip at 110.35px by 23.2px with 11px text after hover.
- Follow-up on 2026-06-11: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-11: `npm.cmd run lint`
- Follow-up on 2026-06-11: `npm.cmd run build --workspace @zara/web`
- Follow-up on 2026-06-11: `git diff --check -- apps/web/src/TenantIntegrationsScreen.tsx apps/web/src/WorkflowBuilder.tsx apps/web/src/styles.css`
- Follow-up on 2026-06-11: Browser automation verified the Zendesk row shows `Configured Tools (0)` without connection count/scope/account copy, and verified light-mode tooltip colors as black background with white text. UI tests were skipped per user request.

UI test note: no UI tests were added or run for the 2026-06-10 layout refactor per user request.
- `npx.cmd tsc -p apps/web/tsconfig.json --noEmit`
- `npm.cmd run test:run` was attempted after the frontend publish wiring; affected app/builder suites passed after the timeout fix, but the full run still fails while the unrelated dirty `README.md` lacks the `## Quality Gates` heading required by `packages/core/src/ci-quality-gates.test.ts`.
- `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts -t "keeps separate grants"`
- `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts -t "does not allow runtime"`
- `npm.cmd run test:run -- packages/core/src/provider-registry.test.ts -t "post-call sync"`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "capability setup lanes"`
- `npm.cmd run test:run -- apps/web/src/integrationSetupPresets.test.ts`
- `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts -t "rejects capability grants"`
- `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "renders the dashboard with real workspace metrics"`
- `npm.cmd run test:run -- packages/core/src/provider-registry.test.ts apps/api/src/integrations/tool-permission-grants.service.test.ts apps/web/src/integrationSetupPresets.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "renders the dashboard with real workspace metrics|renders tenant integrations controls|renders tenant integration tools|configure Zendesk credentials|shows scoped integration connections|capability setup lanes"`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "save a scoped capability grant"`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "renders tenant integrations controls|capability setup lanes|save a scoped capability grant"`
- `npx.cmd tsc -p apps/web/tsconfig.json --noEmit`
- `npm.cmd run lint`
- RED verified: `npm.cmd run test:run -- apps/web/src/integrationSetupPresets.test.ts` failed with `createIntegrationSetupCopyPreview is not a function`.
- `npm.cmd run test:run -- apps/web/src/integrationSetupPresets.test.ts`
- `npx.cmd tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck --target ES2022 --lib ES2022,DOM --module ESNext --moduleResolution Bundler --jsx react-jsx apps/web/src/integrationSetupPresets.ts apps/web/src/integrationSetupPresets.test.ts`
- `npx.cmd eslint apps/web/src/integrationSetupPresets.ts apps/web/src/integrationSetupPresets.test.ts`
- RED verified: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "previews editable integration setup presets"` failed while the tenant integrations page had no setup preset surface.
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "previews editable integration setup presets"`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "renders tenant integrations controls|capability setup lanes|save a scoped capability grant|previews editable integration setup presets"`
- `npm.cmd run test:run -- apps/web/src/integrationSetupPresets.test.ts apps/web/src/app.test.tsx -t "previews support|copyable templates|previews editable integration setup presets"`
- `npm.cmd run test:run -- apps/web/src/integrationSetupPresets.test.ts`
- `npx.cmd tsc -p apps/web/tsconfig.json --noEmit`
- RED verified: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "previews workspace setup copies"` failed while the tenant setup preset preview had no copy action.
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "previews workspace setup copies"`
- `npx.cmd tsc -p apps/web/tsconfig.json --noEmit`
- RED verified: `npm.cmd run test:run -- packages/core/src/provider-registry.test.ts -t "required provider scopes"` failed while catalog tools had no `requiredScopes`.
- `npm.cmd run test:run -- packages/core/src/provider-registry.test.ts -t "required provider scopes"`
- `npm.cmd run build --workspace @zara/core`
- RED verified: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "prompts reconnect" --pool=threads` failed while the capability form had no missing-scope prompt.
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "prompts reconnect" --pool=threads`
- `npx.cmd tsc -p apps/web/tsconfig.json --noEmit`
- `npm.cmd run test:run -- packages/core/src/provider-registry.test.ts apps/web/src/integrationSetupPresets.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "renders tenant integrations controls|capability setup lanes|save a scoped capability grant|previews editable integration setup presets|previews workspace setup copies|prompts reconnect" --pool=threads`
- `npm.cmd run lint`
- `npm.cmd run typecheck`
- After CI caught duplicate preset/catalog text, reran `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "renders tenant integration tools|previews editable integration setup presets|previews workspace setup copies|prompts reconnect" --pool=threads`
- `npx.cmd tsc -p apps/web/tsconfig.json --noEmit`
- `npm.cmd run lint`
- RED on 2026-07-01: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "workflow-scoped capability grant controls" --pool=forks` failed while the integrations page still exposed workflow-bound Configure grant controls.
- RED on 2026-07-01: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "multi-assign tools" --pool=forks` failed while the inspector still selected tools before connections and could not multi-assign from a selected integration.
- GREEN on 2026-07-01: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "workflow-scoped capability grant controls" --pool=forks`
- GREEN on 2026-07-01: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "multi-assign tools" --pool=forks`
- Regression verification on 2026-07-01: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/WorkflowBuilder.test.tsx apps/web/src/workflowBuilderToolCatalog.test.ts --pool=forks`
- Typecheck verification on 2026-07-01: `npm.cmd run typecheck --workspace @zara/web`
- RED on 2026-07-02: `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts -t "integration-scoped agent" --pool=forks` failed while new grants still carried `workflowId` and publish auto-created workflow-scoped grants.
- GREEN on 2026-07-02: `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts -t "integration-scoped agent" --pool=forks`
- Regression verification on 2026-07-02: `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts --pool=forks`
- Regression verification on 2026-07-02: `npm.cmd run test:run -- apps/api/src/workflows/workflows.controller.test.ts --pool=forks`
- Regression verification on 2026-07-02: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts --pool=forks`
- Regression verification on 2026-07-02: `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=forks`
- Regression verification on 2026-07-02: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx --pool=forks`
- Regression verification on 2026-07-02: `npm.cmd run test:run -- apps/web/src/workflowBuilderToolCatalog.test.ts --pool=forks`
- Typecheck verification on 2026-07-02: `npm.cmd run typecheck --workspace @zara/api`
- Typecheck verification on 2026-07-02: `npm.cmd run typecheck --workspace @zara/web`
- Lint verification on 2026-07-02: `npm.cmd run lint`
- Diff check on 2026-07-02: `git diff --check` passed with CRLF warnings only.
- RED on 2026-07-02: `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts -t "workflow-scoped grants|workflow-scoped" --pool=forks` failed while new workflow-scoped grants were accepted and persisted legacy workflow grants were still broadened.
- RED on 2026-07-02: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "only integration connection removal path" --pool=forks` failed while the public provider revoke route still existed.
- RED on 2026-07-02: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "delete integration connections and reconnect Zendesk" --pool=forks` failed while the tenant provider row still exposed Revoke and reused `reconnectConnectionId` after deletion.
- GREEN on 2026-07-02: `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts -t "workflow-scoped grants|workflow-independent|deleted|integration-scoped" --pool=forks`
- GREEN on 2026-07-02: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts -t "delete as the only|grant integration tools|connection availability|connector health|Zendesk API-token" --pool=forks`
- GREEN on 2026-07-02: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "delete integration connections and reconnect Zendesk|integration capability setup lanes" --pool=forks`
- Regression verification on 2026-07-02: `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts --pool=forks`
- Regression verification on 2026-07-02: `npm.cmd run test:run -- apps/api/src/integrations/integrations.controller.test.ts --pool=forks`
- Regression verification on 2026-07-02: `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=forks`
- Regression verification on 2026-07-02: `npm.cmd run test:run -- apps/api/src/memory/memory.controller.test.ts --pool=forks`
- Regression verification on 2026-07-02: `npm.cmd run test:run -- apps/api/src/workflows/workflows.controller.test.ts --pool=forks`
- Typecheck verification on 2026-07-02: `npm.cmd run typecheck --workspace @zara/api`
- Typecheck verification on 2026-07-02: `npm.cmd run typecheck --workspace @zara/web`
- Lint verification on 2026-07-02: `npm.cmd run lint`
- Diff check on 2026-07-02: `git diff --check -- apps/api/src/integrations apps/api/src/memory apps/api/src/workflows apps/web/src/TenantIntegrationsScreen.tsx apps/web/src/tenantIntegrationsApi.ts apps/web/src/app.test.tsx docs/Integrations.md docs/API.md docs/Frontend-Architecture.md docs/Roadmap.md docs/Issue-Backlog.md docs/Handovers/ISSUE-158-capability-grants-and-connection-scope-setup-ux.md docs/Handovers/ISSUE-118-tenant-integrations-page.md` passed with CRLF warnings only.

## Pending Work

- None for ISSUE-158. Continue with ISSUE-159 provider contract tests and runtime side-effect safety.

## Risks And Edge Cases

- Connection availability is not the same as permission to use a capability.
- Promotion from workspace to organization scope must not create automatic grants.
- Deleting a connection removes dependent integration grants; imported historical data that must survive deletion should remain in the owning module's audit/history records, not in a revoked connection lifecycle.
- Existing saved grants without `capability` or `requiredScopes` are normalized on read, but follow-up migrations may be needed for future persisted stores.
- Role-specific grants must cover every role assigned to a tool node; a grant for one role is not enough for another role using the same provider tool.
- The tenant builder now trusts the server-returned published version, so any future backend publish metadata changes should be kept compatible with the local sandbox registry shape.
- `post-call-sync` is currently catalog-supported for HubSpot only; preset generation and grant creation should remain catalog-driven as more providers add that capability.
- The tenant integrations page no longer reads published workflows for grant setup; future server-backed workflow listings should stay owned by workflow/sandbox surfaces unless a new grant UX is explicitly reintroduced.
- Capability rows no longer open active setup forms; adding new grant controls beside provider actions can reintroduce horizontal clipping on narrow tenant app viewports.
- Provider connection setup is catalog-schema driven in the tenant UI, but only Zendesk/Freshdesk have API-token configure endpoints today; other providers still start OAuth after the setup modal confirms scope and any required setup field such as Shopify shop domain.
- Existing persisted workflow-narrowed grants are dropped on read and do not authorize runtime execution. New publish-created grants intentionally omit `workflowId`; reporting or filtering surfaces should treat workflowless grants as applicable across workflows in the same workspace/integration/agent/tool scope.

## Decisions

- Support both organization-wide and workspace-owned connections to reduce setup friction.
- Present grants as clear tool-access controls rather than raw permission records; keep guided setup templates out of the main integrations page until the registry UX is stable.
- Default new tenant-page setup to workspace-owned scope for safer least-privilege behavior, with an explicit organization-wide option.
- Delete is the only public provider-connection removal path. Credential rotation/reconnect may link to a prior connected credential, but it is not a revoke lifecycle.
- Capability setup and presets must be derived from provider catalog capabilities; existing provider IDs alone are not enough to expose post-call sync or future capability lanes.
- Keep connection setup, health checks, and capability status grouped by provider row; agent tool assignment belongs in the workflow inspector so the selected integration credential and agent tool list stay in one place.
- New agent-tool grant creation must not depend on a workflow selector. Workflow IDs are a legacy narrowing field and are ignored/dropped when found on persisted grants.

## Next Recommended Step

Start ISSUE-159 provider contract tests and runtime side-effect safety.
