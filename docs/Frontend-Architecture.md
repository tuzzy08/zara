# Frontend Architecture

## Applications

Zara uses two separate Vite React applications.

- `apps/web`: tenant-facing product app for dashboard, builder, sandbox, telephony, integrations, memory, monitoring, and billing.
- `apps/platform-admin`: internal Zara staff app for platform operations, tenant oversight, provider health, billing operations, audit, abuse review, and impersonation.

The apps are separate because they have different audiences, risk profiles, navigation, deployment origins, and security policies.

## Stack Choice

The default frontend stack for both apps is:

- React + Vite
- Tailwind CSS v4
- shadcn/ui for component primitives
- Lucide for icons
- React Flow in `apps/web` for the workflow builder canvas

This stack is a foundation, not a visual prescription. Components must be customized to match `DESIGN.md` and should not ship with stock shadcn copy or default presentation styling.

## Tenant Workflow Builder

The tenant workflow builder lives in `apps/web` at `/workflows` and uses `@xyflow/react` 12.10.2. The current builder surface implements ISSUE-009 through ISSUE-017 and now supports a publishable workflow draft:

- React Flow canvas with add, move, connect, and delete interactions.
- Agent nodes with configured agent name, agent class, instructions, language policy, runtime-aware model settings, and voice/runtime controls.
- Concrete agent toolbelts with connector binding, credential state, risk posture, approval posture, and API request metadata for webhook-style actions.
- Exit nodes that terminate the workflow cleanly.
- Human escalation nodes with queue binding, fallback mode, and fallback message.
- Shared `@zara/core` workflow graph helpers for deterministic serialization and validation.
- Internal draft manifest compilation for runtime, telephony, memory, budget, tool bindings, return routes, agent-attached route policies, exit nodes, and escalation policy. The inspector does not show the raw manifest preview.
- Immutable version publishing with active-call pinning.
- Existing edges can be reconnected in the canvas so tenants can rearrange flow without deleting and recreating links.
- Intermediary agent paths can include return edges back to the calling node so a delegated agent can respond to the node that invoked it. New workflows no longer expose a visual Tool toolbox tile or create `agent -> tool -> agent` canvas paths; tools are assigned through reusable/concrete agent toolbelts and remain optional agent capabilities at runtime.
- Builder nodes use kind-specific accent borders and matching icon colors, and the same accents are reflected in the minimap.
- Platform-admin `/agents` owns specialist class/template creation. Platform-created specialist classes own base prompts plus routing descriptions/examples and model defaults; tenant builders load that catalog for workflow-builder agent inspectors and tenant reusable-agent creation, then create reusable concrete agents in the tenant Agents library and apply those agents to workflow nodes as snapshots.
- Agent role language policy supports dropdown-managed multi-select supported languages, a default fallback language, mid-call switching, and language-specific prompt metadata that is preserved in runtime-facing role config.

Node creation stays in the top toolbar with concise labels such as Agent, Router Agent, Escalation, and Exit. Agent and Router Agent are distinct builder presets and inspector experiences, while Router Agent is not a separate runtime node type: it creates the same Agent node with routing enabled by default. Handoff, Intent route, and visual Tool creation paths have been removed from the tenant builder for new workflows; existing workflows that relied on those legacy nodes should be recreated through fresh workflows. Agent-attached route policies own common route-after-agent behavior through the Router Agent inspector's Routing section; normal Agent inspectors do not expose route conversion controls. Route target options come from the current workflow's existing named agent nodes, tenant builders may choose targets and labels, branch descriptions/examples and specialist prompt templates are platform-admin owned, fallback uses existing safe targets, and the canvas stays simple with compact badges such as Routes instead of separate triage, intent-route, or tool-call nodes. On desktop, the builder uses an approximately 75:25 canvas-to-inspector split so the visualizer stays primary and the inspector remains secondary.

Toolbelt assignment surfaces separate provider selection from provider tool selection. Built-in provider tools are grouped by connector, for example Zendesk lists Search tickets, Create ticket, and Update ticket from the backend connector schema. When a provider has active agent-tool grants, the tool dropdown lists only those grants for the selected provider connection and supports selecting multiple tools from that same provider/connection. When a provider is connected but does not yet have explicit grants, the assignment surface can seed from that connected provider catalog so configured accounts do not appear as "No configured providers"; publish creates missing scoped agent-tool grants only after connection, workspace, provider, and scope validation pass, and runtime execution still requires those explicit grants. Cross-provider tool access uses separate toolbelt assignments, not separate visual tool nodes. The tool connection selector binds an assignment to a tenant integration credential/grant fetched from the integrations API; it is not an API endpoint selector. Built-in provider API URLs, paths, auth headers, and payload shapes remain Zara-owned connector metadata and are not editable in the workflow builder.

ISSUE-122 replaced the high-risk ad hoc builder relationship checks with a shared canonical node relationship policy in `@zara/core`. Builder add actions, connect/reconnect decisions, tool call/result handle roles, relationship-specific validation, selected-node toolbar affordances, and stale-relationship repair UX consume that same policy. Browser QA covers clear-canvas recovery, tool call/result auto-links, disabled invalid actions, and relationship repair without console errors.

ISSUE-125 deepened the builder workbench with `apps/web/src/workflowBuilderWorkbench.ts`. That module interface returns selected-node action availability, connection decisions, companion-edge instructions, and React Flow handle-role translation. `WorkflowBuilder.tsx` should stay a rendering and orchestration shell, and future builder behavior changes should start with focused workbench tests before changing the full screen.

The runtime orchestration standard is now captured in `docs/Intent-Routing-Standard.md`, `docs/Agent-Tool-And-Transfer-Standard.md`, and `docs/Turn-Runtime-Packet-v1.md`. Agent-attached route policies now replace visible tenant-managed intent and handoff nodes for the common route-after-agent workflow. The tenant builder exposes router agents through the Router Agent preset without hard-coded specialist labels. Tools behave as optional agent capabilities, router agents preserve those tools, and runtime handoffs create receiving-agent context without exposing internal packet details to operators.

The builder UI should remain operational and dense. Avoid landing-page sections, scaffold copy, repeated hero cards, and decorative content inside the builder surface.

## Tenant Shell State

`apps/web` now treats NestJS as the source of truth for workspace directory state:

- workspaces, memberships, and workspace audit entries load from workspace API routes
- workspace create, rename, archive, restore, access marking, and membership changes write back through the same routes
- only the last active workspace ID remains browser-local so the shell can reopen in the same workspace after reload

The tenant sandbox now uses a shared live-audio session model for published browser runs on both `/workflows` and `/sandbox`:

- `/workflows` opens a blank draft canvas by default even when saved workflows exist. Operators load saved workflows explicitly from the toolbar selector, and in-progress canvas state is preserved for the current organization/workspace browser session when navigating away and back.
- `/workflows` `Run in sandbox` opens the publish flow when the current graph is unpublished or dirty, and opens the inline sandbox drawer only for an unchanged published workflow version. After a successful publish or overwrite, the builder adopts the returned published graph so server-owned normalization does not make the just-published canvas look dirty.
- `/sandbox` opens the same live runtime pipeline for published workflow versions.
- Both surfaces connect to a NestJS-owned realtime session transport instead of holding provider credentials or runtime adapters in the browser.
- Voice mode requests microphone access and streams live audio; the tenant web client does not expose typed sandbox turns.
- The default sandwich providers for browser sandbox are AssemblyAI streaming STT and Cartesia Sonic 3.5 streaming TTS.
- Agent node inspectors expose reusable-agent selection, platform-provided agent class selection, language policy, toolbelt, and voice controls. Tenant builders change workflow runtime only from the toolbox runtime selector, and do not edit runtime profile, text provider/model IDs, or realtime provider/model IDs in the inspector; those are platform-admin/runtime-policy governed defaults. Agent details is the only agent inspector panel expanded by default; other panels stay collapsed and show a required-info indicator in their summary when a required field inside that panel is missing.
- The workflow-page sandbox runtime card resolves premium realtime display from the effective entry agent provider/model when platform-admin/runtime policy provides one, without exposing provider/model selection to tenant builders.
- Builder draft and pre-route publish metadata use `browser-webrtc` for telephony until a published workflow is bound to a routed phone number on `/calls`.
- Builder draft and pre-route publish metadata use a named temporary browser-sandbox budget policy until ISSUE-076 introduces persisted tenant/workspace budget controls.
- The shared browser hook manages session creation, websocket lifecycle, transcript updates, runtime events, microphone capture, streamed audio playback, and workspace-plus-source scoped websocket bootstrap for both screens.
- Workflow sandbox call controls treat connecting, active, voice-capture, and agent-playback states as an in-progress call: start actions stay disabled and End Call stays available until listening/responding has stopped or the call has ended.
- Both screens now render readable live telemetry from the shared event stream, including tool execution, handoffs, node transitions, provider latency, and per-turn cost deltas. The workflow sandbox drawer also includes a collapsed Diagnostics panel for STT evidence review, keeping sequence-numbered non-buffered STT/turn/model/tool/TTS milestones visible without flooding the normal live-event feed with raw audio-buffer packets.

The PSTN live call runtime keeps one sandbox concept instead of creating a second competing sandbox. The tenant UI exposes explicit modes: Published test (browser) and Phone test (Twilio/PSTN). `/calls` remains the setup and activation ladder for numbers, routes, provider-connection deletion, and subscription state; `/workflows` deep-links Phone test mode for exact published workflow versions and routed numbers; `/sandbox` owns the shared Phone test surface. ISSUE-145 adds the backend/API baseline for protected Phone tests, ISSUE-146 implements the unified UI, and ISSUE-147 adds the activation controls: phone numbers expose `liveRoute`, `testRoute`, and `phoneTestResults`; legacy flat phone-number route fields are gone; number states read as Unassigned, Test route, Ready to activate, Live, and Paused; pending/paused routes do not answer live calls; and `/calls` exposes Activate live, Pause, Resume, imported-number inbound/outbound test selectors, tenant-wide published workflow routing options, and live-control session selectors backed by persisted dispatch/execution sessions after the Phone test result and activation gates are available. ISSUE-148 keeps PSTN call-quality observability staff-only in platform-admin runtime health instead of adding tenant-facing LangSmith/eval metadata. See `docs/PSTN-Live-Call-Runtime-Standard.md`.

## Tenant Operations Pages

The tenant app now replaces the former sidebar placeholders for `/integrations`, `/memory`, and `/billing` with real operator pages:

- `/integrations` loads OAuth connections, health posture, revocation state, connector tools, webhook HTTP tools, and workspace tool grants from the Nest integrations APIs. Connect, reconnect, health-check, and revoke actions call backend routes and only display masked credential references. Provider rows and catalog tools use accessible provider logo badges so Zendesk, HubSpot, Google Workspace, Microsoft 365, Notion, Salesforce, Slack, and webhook tools remain scannable without loading remote brand assets.
- `/memory` loads the tenant memory export package and renders approved memory, pending drafts, knowledge records, ingestion status, audit posture, export, approval/rejection, disable/delete, and retention-purge controls. The page does not render raw embeddings or sensitive source payloads.
- `/billing` loads Zara billing state from the Nest billing API and renders plan status, Polar customer state, usage totals, budget warning state, invoices/orders, entitlements, checkout, and customer-portal actions. Payment-provider credentials stay server side and the browser receives only hosted Polar URLs.

The three pages share the tenant shell, active organization ID, active workspace context, toast feedback, and the existing compact Vercel-inspired product styling. UI tests stay limited to route smoke and critical action coverage.

## Suggested Origins

- Local tenant app: `http://localhost:4173` or `http://127.0.0.1:4173`
- Local platform admin app: `http://localhost:4174` or `http://127.0.0.1:4174`
- Local API: `http://127.0.0.1:4010`
- Production tenant app: `https://app.zara.ai`
- Production platform admin app: `https://admin.zara.ai`
- API: `https://api.zara.ai`

Staging should mirror this shape with staging subdomains.

When local frontend and API ports differ, `apps/web` should use `VITE_API_BASE_URL` to point at the Nest API origin. The current web fallback also assumes the local API default of `http://127.0.0.1:4010`, which avoids colliding with unrelated tools that often occupy port `3000`. Nest CORS explicitly allows both `localhost` and `127.0.0.1` local app origins for the current tenant and platform-admin ports.

## Shared Packages

- `packages/ui`: reusable UI primitives and design tokens.
- `packages/api-client`: typed API client and request helpers.
- `packages/auth-client`: Zara-owned auth boundary with server-owned context reads and direct cookie-authenticated auth mutations.
- `packages/core`: shared domain types.

Shared code must not weaken app separation. Platform-admin-only components and dangerous operations stay inside `apps/platform-admin`.

`packages/ui` should wrap and customize shared shadcn/ui primitives where that helps consistency, while keeping app-specific compositions inside each app.

## Auth

Both apps use the same NestJS-hosted Better Auth backend and cookie/session authority. Better Auth trusted origins must include both app origins for local, staging, and production.

Frontend guards are only UX. NestJS guards enforce all authorization.

`packages/auth-client` now provides the shared Zara auth boundary for both Vite apps. It normalizes `useSession`, `getContext`, email/password sign-up, email/password sign-in, password reset request/reset submit, email verification request, safe session list/revoke, invitation create/list/revoke/accept, organization selection, and sign-out into small Zara contracts so the tenant app and platform-admin app share session handling without sharing app-specific route trees. App-shell reads use the server-owned `GET /api/auth/context` contract with cookies included and return the stable user, active tenant organization, memberships, active/default workspace, platform role, platform auth posture, and permission summary used by auth-boundary migrations. Normal tenant and platform-admin shell rendering does not mount Better Auth's session, active-organization, or active-member hook readers, and the frontend auth boundary no longer bundles Better Auth React/plugin clients for those readers. Browser auth mutations call mounted Better Auth REST endpoints directly with cookies. The server-owned auth context restores active tenant/workspace authority and staff session state. Production auth context expands organization memberships from the Better Auth Postgres tables with one query after the session read, which keeps normal shell rendering from burning Better Auth organization read buckets.

Tenant app auth rules:

- authenticated session required
- active organization required
- tenant role required for tenant resources
- unauthenticated users see the tenant sign-in screen before any dashboard route renders
- `/signup` renders the tenant account creation form with user name, organization name, email, and password fields. It posts through the shared auth client to the server-owned `POST /api/auth/onboarding/signup` action, which creates or resumes the Better Auth user, tenant organization, active organization selection, and default workspace owner membership before the tenant shell opens.
- Recoverable onboarding errors stay on the signup form with the server-provided retry message; duplicate tenant names stay on the signup form and do not enter the tenant app.
- Email sign-in auto-enters the tenant shell only when the signed-in user has exactly one tenant membership. Multi-tenant users see a compact tenant chooser before any tenant routes render; choosing a tenant calls the shared auth client's Better Auth `set-active` wrapper and refreshes the server-owned context.
- Last active workspace restore is scoped per tenant organization and ignored when the stored workspace is archived or the signed-in user no longer has workspace membership. Inaccessible workspace states fall back to an accessible active workspace or the tenant access-required screen instead of opening stale tenant data.
- On initial tenant shell load, `GET /api/auth/context` is the server-owned active workspace authority. If workspace state is stale or races auth context, the shell keeps the auth-context active workspace instead of falling back to seeded workspace defaults.
- The Settings workspace screen lists pending invitations, creates invitations with tenant role plus selected-workspace role intent, and revokes pending invitations through the shared auth client. Invitation acceptance restores the accepted tenant session before routes render.
- The sign-in screen can request a password reset without account-enumeration feedback, `/reset-password?token=...` submits reset tokens through the shared auth client, and the Settings screen exposes account security controls for verification email and safe session revocation. Session rows use server-issued safe IDs; browser code never receives Better Auth session tokens.
- the profile menu exposes sign-out and returns the app to the sign-in gate

Platform admin app auth rules:

- authenticated session required
- platform role required
- platform auth posture required for mutating controls
- tenant organization membership is not sufficient
- platform role must come from server-owned auth context or an equivalent NestJS authority, never from tenant organization role data
- tenant-only sessions see a platform-access-required state instead of the staff console
- expired staff sessions see a sign-in-again state
- password-only staff sessions can read allowed staff surfaces but mutating controls show an MFA/passkey required state and remain disabled
- `/dashboard`, `/organizations`, `/users`, `/telephony`, `/integrations`, `/runtime`, `/billing`, `/audit`, `/impersonation`, and `/abuse` render inside an independent Zara Staff shell rather than reusing tenant navigation
- `/agents` includes platform-owned specialist class creation and catalog inspection; created classes become available to tenant workflow builder and reusable-agent class selectors
- `/runtime` includes provider health, AI runtime observability, saveable route-policy controls for agent-attached handoff governance, plus prompt-policy controls for global guardrails, platform-owned agent class templates, class-level text/realtime model defaults, version metadata, change reason, and save action
- local development runs on `http://127.0.0.1:4174`; the admin deployment uses its own environment file and deploy headers so CSP and framing policy can differ from the tenant app

## Testing

Keep UI tests light. Smoke-test login gates, tenant app shell, builder load, platform admin shell, and impersonation banner. Put deeper coverage in API, guard, domain, and integration tests.
