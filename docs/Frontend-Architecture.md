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
- Agent role nodes with instructions, role type, language policy, runtime-aware model settings, and reusable-specialist setting.
- Tool nodes with connector binding, credential state, risk posture, approval posture, and API request metadata for webhook-style actions.
- Handoff nodes that target a valid specialist role and carry a handoff reason.
- Condition nodes with branch expressions, route targets, and required fallback behavior.
- Exit nodes that terminate the workflow cleanly.
- Human escalation nodes with queue binding, fallback mode, and fallback message.
- Shared `@zara/core` workflow graph helpers for deterministic serialization and validation.
- Internal draft manifest compilation for runtime, telephony, memory, budget, tool bindings, handoffs, return routes, condition routes, exit nodes, and escalation policy. The inspector does not show the raw manifest preview.
- Immutable version publishing with active-call pinning.
- Existing edges can be reconnected in the canvas so tenants can rearrange flow without deleting and recreating links.
- Tool and intermediary agent paths can include return edges back to the calling node so a successful tool call or delegated agent can respond to the node that invoked it. Tool nodes are added only from selected agent nodes, automatically create the agent-to-tool call edge plus the tool-to-agent success edge, and default to an available connected integration credential when one exists. Agent cards expose two top handles for tool calls/results plus normal left/right flow handles for other node relationships; tool cards expose their call/result handles underneath so tool output returns only to the caller.
- Builder nodes use kind-specific accent borders and matching icon colors, and the same accents are reflected in the minimap.
- Reusable specialist templates can be saved from agent nodes, persisted per workspace, selected back into agent nodes, and used as handoff shortcuts without mutating already-published workflow snapshots.
- Agent role language policy supports dropdown-managed multi-select supported languages, a default fallback language, mid-call switching, and language-specific prompt metadata that is preserved in runtime-facing role config.

Node creation stays in the top toolbar with concise tool labels such as Agent, Tool, Handoff, Intent route, Escalation, and Exit. The Tool action is disabled until an agent node is selected because tool results can only return to the invoking agent. Intent route is also agent-scoped: inbound entry and tool nodes cannot create or connect into intent routes, and intent routes use normal horizontal flow handles rather than agent/tool call-return handles. Intent-route branch target selectors exclude tool nodes and the caller agent so the route cannot silently become a tool call or a loop back to the role that already determined the intent. Intent-route fallbacks prefer explicit terminal exit nodes and otherwise stay unselected; fallback target selectors include the calling agent so an operator can intentionally loop unmatched intents back to the caller. The intent inspector exposes branch intent, branch description, examples, classifier confidence threshold, and recent transcript window, while raw compatibility expressions remain hidden. On desktop, the builder uses an approximately 75:25 canvas-to-inspector split so the visualizer stays primary and the inspector remains secondary.

ISSUE-122 replaced the high-risk ad hoc builder relationship checks with a shared canonical node relationship policy in `@zara/core`. Builder add actions, connect/reconnect decisions, tool call/result handle roles, intent-route target selectors, relationship-specific validation, selected-node toolbar affordances, and stale-relationship repair UX consume that same policy. Browser QA covers clear-canvas recovery, tool call/result auto-links, disabled invalid actions, and relationship repair without console errors.

ISSUE-125 deepened the builder workbench with `apps/web/src/workflowBuilderWorkbench.ts`. That module interface returns selected-node action availability, route-target options, connection decisions, companion-edge instructions, and React Flow handle-role translation. `WorkflowBuilder.tsx` should stay a rendering and orchestration shell, and future builder behavior changes should start with focused workbench tests before changing the full screen.

The runtime orchestration standard is now captured in `docs/Intent-Routing-Standard.md`, `docs/Agent-Tool-And-Transfer-Standard.md`, and `docs/Turn-Runtime-Packet-v1.md`. Intent routes expose configured branches, classifier settings, examples, and fallback without making users manage a separate classifier agent. Tools now behave as optional agent capabilities, and handoffs/direct agent routes create receiving-agent context without exposing internal packet details to operators.

The builder UI should remain operational and dense. Avoid landing-page sections, scaffold copy, repeated hero cards, and decorative content inside the builder surface.

## Tenant Shell State

`apps/web` now treats NestJS as the source of truth for workspace directory state:

- workspaces, memberships, and workspace audit entries load from workspace API routes
- workspace create, rename, archive, restore, access marking, and membership changes write back through the same routes
- only the last active workspace ID remains browser-local so the shell can reopen in the same workspace after reload

The tenant sandbox now uses a shared live-audio session model for both `/workflows` and `/sandbox`:

- `/workflows` draft runs compile the current validated graph into an ephemeral manifest and open a live sandbox drawer without requiring publish first.
- `/sandbox` opens the same live runtime pipeline for published workflow versions.
- Both surfaces connect to a NestJS-owned realtime session transport instead of holding provider credentials or runtime adapters in the browser.
- Voice mode requests microphone access and streams live audio; typed mode is an alternate input method into the same live runtime session.
- The default sandwich providers for browser sandbox are AssemblyAI streaming STT and Cartesia Sonic 3 streaming TTS.
- Agent node inspectors expose text tier/provider/model controls only when the selected role runtime resolves to cost-optimized or balanced. The model field can pin an exact provider model ID, while an empty value lets runtime choose from the tier defaults.
- Agent node inspectors expose OpenAI Realtime and Google Gemini Live provider/model controls only when the selected role runtime resolves to premium realtime.
- The workflow-page sandbox runtime card resolves premium realtime display from the effective entry role provider/model, so Gemini Live draft runs show Gemini Live instead of the profile-level OpenAI Realtime default or stale sandwich text-routing decisions.
- Builder draft and pre-route publish metadata use `browser-webrtc` for telephony until a published workflow is bound to a routed phone number on `/calls`.
- Builder draft and pre-route publish metadata use a named temporary browser-sandbox budget policy until ISSUE-076 introduces persisted tenant/workspace budget controls.
- The shared browser hook manages session creation, websocket lifecycle, transcript updates, runtime events, microphone capture, streamed audio playback, and workspace-plus-source scoped websocket bootstrap for both screens.
- Workflow sandbox call controls treat connecting, active, voice-capture, and agent-playback states as an in-progress call: start actions stay disabled and End Call stays available until listening/responding has stopped or the call has ended.
- Both screens now render readable live telemetry from the shared event stream, including tool execution, handoffs, node transitions, provider latency, and per-turn cost deltas.

The PSTN live call runtime keeps one sandbox concept instead of creating a second competing sandbox. The tenant UI exposes explicit modes: Draft test (browser), Published test (browser), and Phone test (Twilio/PSTN). `/calls` remains the setup and activation ladder for numbers, routes, and subscription state; `/workflows` deep-links Phone test mode for exact published workflow versions and routed numbers; `/sandbox` owns the shared Phone test surface. ISSUE-145 adds the backend/API baseline for protected Phone tests, and ISSUE-146 implements the unified UI: phone numbers expose `liveRoute`, `testRoute`, and `phoneTestResults`, legacy flat phone-number route fields are gone, number states read as Unassigned, Test route, Ready to activate, Live, and Paused, and the old workflow-page routed dispatch simulation is removed. See `docs/PSTN-Live-Call-Runtime-Standard.md`.

## Tenant Operations Pages

The tenant app now replaces the former sidebar placeholders for `/integrations`, `/memory`, and `/billing` with real operator pages:

- `/integrations` loads OAuth connections, health posture, revocation state, connector tools, webhook HTTP tools, and workspace tool grants from the Nest integrations APIs. Connect, reconnect, health-check, and revoke actions call backend routes and only display masked credential references.
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
- `packages/auth-client`: Better Auth React client setup shared where safe.
- `packages/core`: shared domain types.

Shared code must not weaken app separation. Platform-admin-only components and dangerous operations stay inside `apps/platform-admin`.

`packages/ui` should wrap and customize shared shadcn/ui primitives where that helps consistency, while keeping app-specific compositions inside each app.

## Auth

Both apps use the same NestJS-hosted Better Auth backend and cookie/session authority. Better Auth trusted origins must include both app origins for local, staging, and production.

Frontend guards are only UX. NestJS guards enforce all authorization.

`packages/auth-client` now provides the shared Better Auth React client boundary for both Vite apps. It normalizes `useSession`, email/password sign-up, email/password sign-in, and sign-out into a small Zara session contract so the tenant app and platform-admin app share session handling without sharing app-specific route trees.

Tenant app auth rules:

- authenticated session required
- active organization required
- tenant role required for tenant resources
- unauthenticated users see the tenant sign-in screen before any dashboard route renders
- `/signup` renders the tenant account creation form with user name, organization name, email, and password fields. It posts through the shared Better Auth client, creates the tenant organization, sets it active, and then opens the tenant shell as the owner.
- the profile menu exposes sign-out and returns the app to the sign-in gate

Platform admin app auth rules:

- authenticated session required
- platform role required
- tenant organization membership is not sufficient
- tenant-only sessions see a platform-access-required state instead of the staff console
- `/dashboard`, `/organizations`, `/users`, `/telephony`, `/integrations`, `/runtime`, `/billing`, `/audit`, `/impersonation`, and `/abuse` render inside an independent Zara Staff shell rather than reusing tenant navigation
- `/runtime` includes provider health plus prompt-policy controls for global guardrails, role templates, version metadata, change reason, and save action
- local development runs on `http://127.0.0.1:4174`; the admin deployment uses its own environment file and deploy headers so CSP and framing policy can differ from the tenant app

## Testing

Keep UI tests light. Smoke-test login gates, tenant app shell, builder load, platform admin shell, and impersonation banner. Put deeper coverage in API, guard, domain, and integration tests.
