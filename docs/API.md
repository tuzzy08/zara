# API Docs

## API Style

The control plane is a NestJS API. All tenant-scoped routes require authenticated organization membership. Public telephony webhooks require provider signature verification and idempotency keys.

## Modules

- Auth: Better Auth integration, sessions, invitations, roles.
- Organizations: tenants, memberships, permissions.
- Platform Admin: Zara staff dashboard, tenant operations, provider health, impersonation, and audit.
- Agents: roles, prompts, language policies, model defaults.
- Workflows: draft graphs, validation, publishing, manifest preview.
- Runtime: manifest compilation, sandbox start, runtime events.
- Telephony: connections, numbers, webhooks, dispatch, health checks.
- Integrations: OAuth connections, webhook HTTP tool definitions, connector health, tool grants.
- Memory: records, retrieval, approval, retention, deletion.
- Calls: sessions, transcripts, recordings, summaries, dispositions.
- Monitoring: live event stream, escalation queue, quality flags.
- Billing: usage events, budgets, plan limits, cost estimates.
- Audit: immutable security and admin activity records.

## Auth Client Contract

The tenant and platform-admin Vite apps use `packages/auth-client` as their shared Better Auth React client boundary. The package configures the client against `VITE_AUTH_BASE_URL` or `VITE_API_BASE_URL`, falling back to the local Nest API origin, and exposes normalized `useSession`, `getContext`, email/password sign-up, email/password sign-in, invitation create/list/revoke/accept, organization selection, and sign-out methods for the apps.

The NestJS API mounts the Better Auth catch-all handler under `/api/auth/*`. Core email/password routes include `GET /api/auth/ok`, `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email`, session reads, and sign-out through the Better Auth client. The Better Auth organization plugin is enabled with Zara's owner/admin/builder/operator/viewer roles. Test runs use the Better Auth memory adapter by default. Local development, staging, and production require configured Postgres storage through `DATABASE_URL`; `ZARA_AUTH_DATABASE=memory` is rejected outside tests so signed-up users and sessions cannot disappear across API restarts.

`POST /api/auth/onboarding/signup` is the server-owned tenant signup action used by the shared tenant auth client. It validates the tenant organization name before irreversible writes where possible, creates or signs in the Better Auth user, checks tenant slug availability, creates the Better Auth organization, sets it active, initializes the default workspace state, grants the new owner `owner` membership on `workspace-support`, and returns the same user, active organization, and active workspace shape the tenant shell needs to enter the app. A repeated completed request by the same user resumes successfully. A partial failure after user creation returns `409` with `code: "tenant_onboarding_recoverable"` and a recoverable stage so the client can retry the same payload. Blank tenant names return `400` with `code: "tenant_name_required"`, and duplicate tenant slugs from either the onboarding registry or Better Auth return `409` with `code: "tenant_name_unavailable"` so the user can choose a different tenant name and retry safely.

`GET /api/auth/context` is the server-owned Zara auth context contract. It reads the Better Auth session from cookies and returns one stable shape:

- `authenticated`: boolean session state.
- `user`: authenticated user id, name, and email, or `null`.
- `activeOrganization`: active tenant organization id, name, and tenant role, or `null`.
- `memberships`: tenant organization memberships visible to the signed-in user.
- `activeWorkspace`: active/default workspace id and name when an active organization is available.
- `platformRole`: platform role when the signed-in request has a valid platform role authority, otherwise `null`.
- `permissions`: flattened tenant and platform permission summaries.

Unauthenticated callers receive HTTP 200 with `authenticated: false`, null user/organization/workspace/platform role, empty memberships, and empty permission arrays. Tenant membership never grants platform access, and platform role context does not create tenant organization access.

Self-serve tenant signup goes through the server-owned onboarding action rather than a client-side Better Auth sequence. The shared client still rejects blank tenant organization names before calling the API, then preserves server-owned duplicate/recoverable error messages for the auth form. Because Better Auth starts fresh sign-in sessions with no active organization by default, tenant email sign-in restores the tenant organization only when the user has exactly one membership. Multi-tenant users remain signed in with memberships but no active organization until they choose one; the shared client then sets the chosen organization active through Better Auth. `GET /api/auth/context` returns memberships even when no active organization is selected, and returns an active workspace only when the signed-in user has an active workspace membership. The tenant app only opens the dashboard once the session has an active organization and active member role.

Tenant invitations use Zara-owned API routes in front of Better Auth organization invitations:

- `POST /api/auth/invitations` creates an invitation for a tenant organization. Body: `organizationId`, invited `email`, tenant `role`, and optional `workspaceAccess` with `workspaceId` and workspace role. The server validates the caller's Better Auth invitation permission, validates active workspace intent, stores workspace intent on the durable Better Auth invitation payload, and returns a normalized invitation with status `pending` plus invitation audit entries.
- `GET /api/auth/invitations?organizationId=...` lists invitations visible to the signed-in organization member.
- `POST /api/auth/invitations/:invitationId/revoke` cancels the provider invitation and returns Zara status `revoked`.
- `POST /api/auth/invitations/:invitationId/accept` accepts as the signed-in invited user, or creates/signs in a new user when `email`, `password`, and optional `name` are provided. Acceptance sets the invited organization active and grants only the configured workspace role when workspace intent is present.

Invitation failure responses use stable product codes: `invitation_email_mismatch`, `invitation_revoked`, `invitation_already_accepted`, `invitation_expired`, `invitation_forbidden`, `invitation_workspace_unavailable`, and `invitation_workspace_access_failed`. Wrong-email, revoked, already-accepted, expired, and cross-tenant attempts fail before granting workspace access. If workspace access fails after provider acceptance, the response is recoverable and reports `invitation_workspace_access_failed`.

Tenant frontend routes render a sign-in gate until the Better Auth session includes an active tenant organization. Platform-admin frontend routes render a separate admin sign-in gate and reject tenant-only sessions unless the session carries a platform role. These frontend guards are UX boundaries; NestJS API guards remain the source of truth for authorization.

## Representative Routes

- POST /api/auth/onboarding/signup
- GET /api/auth/invitations
- POST /api/auth/invitations
- POST /api/auth/invitations/:invitationId/revoke
- POST /api/auth/invitations/:invitationId/accept
- GET /organizations/:orgId/workspaces/state
- POST /organizations/:orgId/workspaces
- PATCH /organizations/:orgId/workspaces/:workspaceId
- POST /organizations/:orgId/workspaces/:workspaceId/accessed
- PUT /organizations/:orgId/workspaces/:workspaceId/memberships/:userId
- POST /organizations/:orgId/workspaces/:workspaceId/memberships/:userId/revoke
- POST /organizations/:orgId/workflows/:workflowId/validate
- POST /organizations/:orgId/workflows/:workflowId/publish
- GET /organizations/:orgId/workflows/:workflowId/manifest-preview
- POST /organizations/:orgId/sandbox/calls
- POST /organizations/:orgId/sandbox/live-sessions
- GET /organizations/:orgId/sandbox/live-sessions
- GET /organizations/:orgId/sandbox/live-sessions/escalations
- POST /organizations/:orgId/sandbox/live-sessions/escalations/:escalationId/accept
- POST /organizations/:orgId/sandbox/live-sessions/escalations/:escalationId/decline
- GET /organizations/:orgId/sandbox/live-sessions/telemetry
- GET /organizations/:orgId/sandbox/live-sessions/:sessionId
- GET /organizations/:orgId/sandbox/live-sessions/:sessionId/events
- GET /organizations/:orgId/sandbox/live-sessions/:sessionId/memory
- POST /organizations/:orgId/sandbox/live-sessions/:sessionId/summary
- GET /organizations/:orgId/sandbox/live-sessions/:sessionId/quality
- GET /organizations/:orgId/sandbox/live-sessions/:sessionId/crm-sync
- POST /organizations/:orgId/sandbox/live-sessions/:sessionId/crm-sync/:summaryId/retry
- POST /organizations/:orgId/sandbox/live-sessions/:sessionId/reconnect
- POST /organizations/:orgId/sandbox/live-sessions/:sessionId/end
- POST /runtime/realtime/sessions
- GET /organizations/:orgId/telephony/state
- POST /organizations/:orgId/telephony/connections
- POST /organizations/:orgId/telephony/connections/:id/validate
- POST /organizations/:orgId/telephony/connections/:id/heartbeat
- POST /organizations/:orgId/telephony/connections/:id/import-twilio-numbers
- POST /organizations/:orgId/telephony/connections/:id/register-number
- POST /organizations/:orgId/telephony/connections/:id/test-call
- PATCH /organizations/:orgId/telephony/numbers/:numberId/routing
- POST /organizations/:orgId/telephony/numbers/:numberId/pstn-test-route
- POST /organizations/:orgId/telephony/numbers/:numberId/pstn-test-route/:sessionId/complete
- POST /organizations/:orgId/telephony/numbers/:numberId/live-route/activate
- POST /organizations/:orgId/telephony/numbers/:numberId/live-route/pause
- POST /organizations/:orgId/telephony/numbers/:numberId/live-route/resume
- POST /organizations/:orgId/telephony/dispatch/inbound
- POST /organizations/:orgId/telephony/dispatch/outbound
- POST /organizations/:orgId/telephony/calls/:callSessionId/runtime-policy
- POST /organizations/:orgId/telephony/calls/:callSessionId/human-fallback
- POST /organizations/:orgId/telephony/credentials/rotate
- GET /organizations/:orgId/compliance/readiness
- GET /organizations/:orgId/compliance/audit-logs
- POST /organizations/:orgId/compliance/retention-jobs
- POST /organizations/:orgId/integrations/:provider/connect
- GET /integrations/oauth/:provider/callback
- GET /organizations/:orgId/integrations/connections
- POST /organizations/:orgId/integrations/connections/:connectionId/health-check
- POST /organizations/:orgId/integrations/connections/:connectionId/revoke
- GET /organizations/:orgId/integrations/connectors/:provider/tools
- POST /organizations/:orgId/integrations/connectors/:provider/tools/:toolId/execute
- POST /organizations/:orgId/integrations/webhook-tools
- GET /organizations/:orgId/integrations/webhook-tools
- POST /organizations/:orgId/integrations/tool-grants
- GET /organizations/:orgId/integrations/tool-grants
- GET /organizations/:orgId/memory
- POST /organizations/:orgId/memory
- POST /organizations/:orgId/memory/retrieve
- POST /organizations/:orgId/memory/extract
- POST /organizations/:orgId/memory/drafts/:draftId/approve
- POST /organizations/:orgId/memory/drafts/:draftId/reject
- POST /organizations/:orgId/memory/knowledge
- GET /organizations/:orgId/memory/knowledge
- POST /organizations/:orgId/memory/retention/purge
- GET /organizations/:orgId/memory/export
- DELETE /organizations/:orgId/memory/tenant-data
- PATCH /organizations/:orgId/memory/:memoryId
- DELETE /organizations/:orgId/memory/:memoryId
- GET /organizations/:orgId/billing/state
- POST /organizations/:orgId/billing/checkout
- POST /organizations/:orgId/billing/customer-portal
- PATCH /organizations/:orgId/billing/budget-policy
- POST /organizations/:orgId/billing/budget-checks
- POST /organizations/:orgId/billing/usage-events
- POST /organizations/:orgId/billing/telephony-minute-events
- POST /organizations/:orgId/billing/runtime-cost-events
- POST /billing/polar/webhooks
- GET /organizations/:orgId/calls/:callId/events
- POST /organizations/:orgId/telephony/calls/:callSessionId/events
- POST /telephony/webhooks/:provider
- GET /platform-admin/dashboard
- GET /platform-admin/organizations
- GET /platform-admin/organizations/:orgId
- PATCH /platform-admin/organizations/:orgId/status
- GET /platform-admin/users
- POST /platform-admin/users/:userId/support-actions
- GET /platform-admin/telephony
- GET /platform-admin/integrations
- GET /platform-admin/runtime/health
- GET /platform-admin/runtime/ai-observability
- GET /platform-admin/runtime/prompt-policy
- PATCH /platform-admin/runtime/prompt-policy
- PATCH /platform-admin/organizations/:orgId/billing-controls
- GET /platform-admin/audit-logs
- GET /platform-admin/abuse-compliance/reviews
- POST /platform-admin/abuse-compliance/reviews/:reviewId/decision
- POST /platform-admin/organizations/:orgId/impersonation-sessions
- DELETE /platform-admin/impersonation-sessions/:id

## Telephony PSTN Runtime Contract

Telephony dispatch records include the server-selected `runtimePath`, currently `pstn-sandwich` or `pstn-premium-realtime`, alongside route mode, runtime profile, number ID, provider connection ID, published workflow version ID, and phone-test session ID when present.

Premium realtime PSTN dispatch is allowed only when the server resolves provider capability, provider availability, tenant entitlement, budget posture, and explicit fallback policy as passing. Failed checks return blocked dispatch/unavailable TwiML rather than silently downgrading the call to sandwich.

Twilio `<Connect><Stream>` responses include `zaraRuntimePath` as diagnostic stream metadata. Twilio custom parameters do not authorize or select tenants, routes, numbers, sessions, or runtime paths; the server-created execution session remains authoritative.

## Contract Rules

- APIs never return raw secrets.
- Tenant ID is always derived from authenticated membership or verified telephony route, not trusted from arbitrary payloads.
- Platform-admin APIs require platform roles and must not authorize from tenant organization roles.
- Mutations write audit logs.
- Tenant compliance audit logs are append-only and hash-chained with `previousHash` and `hash`.
- Platform-admin actions always write audit logs.
- Platform-admin routes require a platform role; tenant organization roles never grant staff access.
- Readonly platform roles can inspect operational state but cannot mutate tenant status, billing controls, support actions, impersonation sessions, or abuse/compliance reviews.
- Platform-admin responses expose health, status, usage, diagnostics, and masked operational metadata, never raw provider secrets, OAuth tokens, payment-provider secrets, or decrypted credentials.
- Platform-admin impersonation start and revoke actions also write tenant compliance audit records that link back to the impersonation session.
- Runtime event writes are idempotent.
- Payment webhooks, usage billing events, telephony minute events, and runtime cost events are idempotent.
- Published versions are immutable.

## Workflow Validation Contract

Workflow validation is shared through `@zara/core` so the tenant builder and future NestJS workflow routes use the same contract. Validation returns actionable errors with stable codes, messages, suggestions, and optional node or edge references.

Current validation covers:

- missing entry node
- duplicate node IDs
- edges that reference missing nodes
- unreachable nodes from the entry path
- unsafe cycles without an exit condition
- agent roles missing name, instructions, model tier, default language, or supported languages
- duplicate agent role names
- unsupported language codes
- tool nodes that require authorization without an integration credential reference
- webhook/API tool nodes missing request method, URL, auth token reference, or headers when request mode is enabled
- condition nodes with invalid expressions, missing branches, invalid targets, or missing fallback targets

Publishing consumes the same graph contract as validation and returns an immutable version snapshot. Active calls pin to the published version they started with, even if the tenant edits the draft immediately after publish.

## Runtime Session Contract

The current premium realtime session route is implemented as a narrow NestJS control-plane endpoint:

- `POST /runtime/realtime/sessions`

Request body:

- `manifest`: compiled runtime manifest
- `activeRoleId`: role requesting premium realtime
- `budgetAllowed`: budget gate result from the caller's policy check
- `now` optional ISO timestamp for deterministic tests
- `ttlMinutes` optional session lifetime override
- `realtimeAvailable` optional availability flag for outage handling

Response body:

- `session`: premium realtime session contract including runtime (`openai-realtime` or `gemini-live`), policy, model, voice, Zara-owned transport URL, expiry, and observed event types

Behavior rules:

- Only roles or manifests opted into `premium-realtime` can create a session.
- Agent roles may select OpenAI Realtime or Google Gemini Live as the realtime provider; Google provider URLs and credentials remain server-side.
- Budget blocks return a conflict response.
- Realtime availability failures return service unavailable.
- Tool and handoff observation stays aligned with `@zara/core` event types.
- The route remains available for premium runtime control-plane cases, but tenant browser sandbox flows now bootstrap through `/organizations/:orgId/sandbox/live-sessions` so both draft and published runs share one live session transport.

## Platform Runtime Prompt Policy Contract

Platform admins can inspect and update the runtime prompt policy used by live sandbox text providers:

- `GET /platform-admin/runtime/prompt-policy`
- `PATCH /platform-admin/runtime/prompt-policy`

The policy contains global platform guardrails plus role templates keyed by agent role type. Updates require `expectedVersion` and `reason`, are restricted to mutating platform roles, persist through the runtime prompt policy repository, and return a platform audit entry. Prompt text is not copied into audit metadata; audit metadata stores version, guardrail count, changed role keys, and reason.

## Platform AI Runtime Observability Contract

Platform staff can inspect AI runtime health and eval gate posture through:

- `GET /platform-admin/runtime/ai-observability`

The route requires a platform role and never authorizes from tenant organization roles. It returns `summary` metrics for intent fallback rate, classifier confidence, tool use/failure rate, transfer loop prevention, policy warnings, packet truncation, LangSmith export health, and eval regression status. It also returns the runtime eval gate command, protected change categories, deterministic and LLM-as-judge thresholds, emergency override policy, and redacted failing run references.

Failing run references may include LangSmith experiment URLs and local trace IDs for Zara staff. They must not include tenant secrets, OAuth values, raw provider payloads, raw caller text, raw tool output, or unredacted trace data.

## Live Sandbox Session Contract

The live sandbox transport foundation is now implemented as a NestJS-owned session layer for browser audio:

- `POST /organizations/:orgId/sandbox/live-sessions`
- `GET /organizations/:orgId/sandbox/live-sessions`
- `GET /organizations/:orgId/sandbox/live-sessions/escalations`
- `POST /organizations/:orgId/sandbox/live-sessions/escalations/:escalationId/accept`
- `POST /organizations/:orgId/sandbox/live-sessions/escalations/:escalationId/decline`
- `GET /organizations/:orgId/sandbox/live-sessions/telemetry`
- `GET /organizations/:orgId/sandbox/live-sessions/:sessionId`
- `GET /organizations/:orgId/sandbox/live-sessions/:sessionId/events`
- `GET /organizations/:orgId/sandbox/live-sessions/:sessionId/memory`
- `POST /organizations/:orgId/sandbox/live-sessions/:sessionId/summary`
- `GET /organizations/:orgId/sandbox/live-sessions/:sessionId/quality`
- `GET /organizations/:orgId/sandbox/live-sessions/:sessionId/crm-sync`
- `POST /organizations/:orgId/sandbox/live-sessions/:sessionId/crm-sync/:summaryId/retry`
- `POST /organizations/:orgId/sandbox/live-sessions/:sessionId/reconnect`
- `POST /organizations/:orgId/sandbox/live-sessions/:sessionId/end`
- `WS /organizations/:orgId/sandbox/live-sessions/:sessionId/stream`

Request body for session create:

- `actorUserId`
- `workspaceId`
- `source`: `draft` or `published`
- `entryRoleId`
- `inputMode`: `voice` or `typed`
- `manifest`: compiled runtime manifest frozen for the lifetime of the sandbox session

Live-session runtime behavior:

- Structured agent action output is validated server-side. Only `respond` and assigned `call_tool` actions are accepted; unsupported command-shaped output is ignored, recorded as `agent_action.invalid`, and replaced with caller-safe fallback speech.
- Tool results are emitted as packet-backed `tool.completed`, `tool.failed`, or `tool.approval_required` events. Missing required inputs are `skipped`; timeouts and rate limits use recoverable `tool_execution.timeout` and `tool_execution.rate_limited`; partial successes keep `status: "partial"` and expose only `safeOutput` to the agent.
- Direct and handoff transfers validate the known caller language before activating the target agent. Unsupported targets emit `transfer_language.unsupported` and leave the source agent active.

Response body:

- `sessionId`
- `workspaceId`
- `source`
- `resolvedRuntimeProfile`
- `transportToken`
- `transportUrl`
- `expiresAt`
- `providerStack`
  - `stt`: `assemblyai-streaming`
  - `tts`: `cartesia-sonic-3`

Session list response body:

- `sessions[]`
  - `sessionId`
  - `workspaceId`
  - `source`
  - `status`
  - `runtimeProfile`
  - `activeRoleName`
  - `runtimeTier`
  - `eventCount`
  - `turnCount`
  - `lastEventAt`
  - `lastEventType` optional
  - `lastTranscriptPreview` optional

Replay events response body:

- `sessionId`
- `events[]`
  - `sequence`
  - `type`
  - `at`
  - `payload`

Session memory response body:

- `sessionId`
- `memory`
  - `status`: `active`, `summarized`, or `cleared`
  - `entryCount`
  - `entries[]`
    - `sourceEventType`
    - `text`
    - `capturedAt`
  - `summary` optional
  - `updatedAt`

Telemetry response body:

- `telemetry`
  - `organizationId`
  - `workspaceId` optional
  - `callCount`
  - `totals`
    - `costUsd`
    - `modelLatencyMs`
    - `sttLatencyMs`
    - `ttsLatencyMs`
    - `toolDurationMs`
    - `toolCount`
    - `modelInputTokens`
    - `modelOutputTokens`
    - `ttsCharacters`
    - `callMinutes`
    - `sttMinutes`
    - `missingUsageEventCount`
  - `calls[]`
    - `sessionId`
    - `workspaceId`
    - `status`
    - `runtimeProfile`
    - `runtimeTier`
    - `eventCount`
    - `modelLatencyMs`
    - `sttLatencyMs`
    - `ttsLatencyMs`
    - `toolDurationMs`
    - `toolCount`
    - `costUsd`
    - `modelInputTokens`
    - `modelOutputTokens`
    - `ttsCharacters`
    - `callMinutes`
    - `sttMinutes`
    - `missingUsageData`
    - `lastEventAt`

Escalation queue response body:

- `escalations[]`
  - `escalationId`
  - `organizationId`
  - `workspaceId`
  - `sessionId`
  - `nodeId`
  - `queueId` optional
  - `queueName` optional
  - `reason`
  - `requestedAt`
  - `slaDeadlineAt`
  - `status`: `pending`, `accepted`, `declined`, or `fallback_triggered`
  - `fallbackMode` optional
  - `fallbackMessage` optional
  - `acceptedByUserId` optional
  - `declinedByUserId` optional
  - `declineReason` optional
  - `resolvedAt` optional
  - `fallbackTriggeredAt` optional

Post-call summary response body:

- `summary`
  - `summaryId`
  - `organizationId`
  - `workspaceId`
  - `sessionId`
  - `outcome`: `resolved`, `human_escalated`, `fallback_triggered`, or `failed`
  - `disposition`: `resolved`, `callback_requested`, `ticket_required`, or `needs_review`
  - `summaryText`
  - `actionItems[]`
    - `id`
    - `label`
    - `status`
    - `source`
  - `crmSync`
    - `status`: `queued` or `skipped`
    - `provider`
    - `connectionId`
    - `objectType`
    - `externalId` optional
    - `queuedAt` optional
  - `createdByUserId`
  - `createdAt`

CRM sync status response body:

- `crmSyncStatuses[]`
  - `summaryId`
  - `organizationId`
  - `workspaceId`
  - `sessionId`
  - `status`: `queued`, `skipped`, `failed`, `retry_queued`, or `synced`
  - `provider`
  - `connectionId`
  - `objectType`
  - `externalId` optional
  - `attemptCount`
  - `queuedAt` optional
  - `lastAttemptAt` optional
  - `retryQueuedAt` optional
  - `nextRetryAt` optional
  - `syncedAt` optional
  - `diagnostic` optional
    - `code`
    - `message`
    - `retryable`
    - `nextStep`

Quality report response body:

- `quality`
  - `organizationId`
  - `workspaceId`
  - `sessionId`
  - `flags[]`
    - `flagId`
    - `kind`: `dead_end`, `hallucination_risk`, `slow_turn`, or `escalation_miss`
    - `severity`
    - `eventSequence`
    - `observedAt`
    - `message`
  - `suggestions[]`
    - `suggestionId`
    - `flagId`
    - `title`
    - `rationale`
    - `status`: `pending_approval`
    - `approvalRequired`: `true`
    - `draftChange`
      - `target`: `workflow_draft`
      - `operation`
      - `description`
      - `appliesToPublishedVersion`: `false`

Behavior rules:

- Session creation requires organization membership and workspace access.
- Draft sessions freeze the validated draft manifest at start time.
- Published sessions submit the compiled published manifest the browser selected for the active workspace.
- Browser clients receive only short-lived transport tokens, never provider secrets.
- Transport tokens are HMAC-signed, stored as hashes at rest, scoped to organization, workspace, manifest source, and expiry, and consumed on first successful websocket bootstrap.
- The transport creates session records, issues transport tokens, returns transport URLs, supports session teardown, and exposes a token-gated websocket stream endpoint.
- Browser websocket bootstrap sends `token`, `workspaceId`, and `source` query parameters so the server can reject replay, expiry, or cross-workspace misuse before any live turn is accepted.
- The websocket stream supports server-to-browser event fanout for sandbox lifecycle and runtime events.
- Live session create, list, replay, and reconnect all read from the same persisted event history so browser refresh and operator monitor views can resume an in-flight sandbox without losing transcript or telemetry.
- Session memory captures short-term transcript/completed-turn text for active calls, survives reconnect, omits raw audio payloads, and is summarized with raw entries cleared when the session ends.
- Telemetry aggregates provider latency, tool duration/count, cost deltas, and usage metrics by tenant and optional workspace, and flags calls where a cost event arrives without provider usage data.
- `escalation.requested` events create at most one pending queue item per session and workflow node, preserving the original reason and SLA deadline when duplicate runtime signals arrive.
- Operators can accept or decline pending escalations. Decisions update queue status and append `escalation.accepted` or `escalation.declined` events to the same live-session timeline.
- Escalation queue reads accept an optional deterministic `now` timestamp and trigger fallback for pending items whose SLA has elapsed, appending an `escalation.failed` event with `sla_timeout`.
- Post-call summaries derive outcome, disposition, and action items from the session event spine, redact sensitive transcript/tool content before returning or emitting summary metadata, and can queue a CRM sync target without exposing credentials.
- CRM sync status reads expose queued, failed, retry-queued, and synced state for post-call summaries. Failure diagnostics are limited to actionable safe fields, and retry requests append `post_call.crm_sync.retry_queued` events without returning raw provider tokens.
- Quality reports derive deterministic flags from the live session event spine. Improvement suggestions are draft-only, require human approval, and never mutate a published workflow version directly.
- Browser-to-server messages now support:
  - `input.text`
  - `input.audio.append`
  - `input.audio.commit`
- Typed turns enter the sandwich runtime directly.
- Voice turns buffer audio frames server side, transcribe through AssemblyAI, then enter the same turn runtime path.
- The default sandwich runtime provider stack on the control plane is OpenAI chat text generation, optionally Google Gemini per agent role through the text-model router, plus Cartesia Sonic 3 TTS.
- Tool nodes compile into agent toolbelt assignments. They execute through the live sandbox tool registry only when the active agent returns a validated `call_tool` action, and they emit packet-backed `tool.requested`, `tool.started`, `tool.approval_required`, `tool.completed`, and `tool.failed` events.
- Turn routing is owned by the focused live sandbox router module. The router resolves model-backed intent classification, condition branch traversal, agent toolbelt availability, structured transfer context, handoff pre-events, terminal exit responses, and stale or empty frontier fallback without changing the live-session HTTP or websocket API surface. Intent classifier failures, invalid output, low confidence, and empty caller turns emit packet warnings and route to configured fallback targets.
- Route traversal emits `node.transition` plus transfer-aware handoff events with source and target IDs, model routing emits `routing.model_selected` with provider/model metadata, provider latency is exposed through `provider.telemetry`, every completed turn emits `turn.cost.delta`, and configured observability exports may emit `runtime.warning` plus `runtime.observability` events without changing turn success.
- Transport security audits now record accepted connections plus replay, expiry, invalid-token, source-scope, and workspace-scope rejections for future monitoring reuse.
- Reconnect issues a fresh one-time websocket bootstrap token for an active session and preserves the existing session ID plus event sequence history.
- End session requests close provider streams, flush final events, and revoke the transport token.
- `apps/web` `/workflows` and `/sandbox` now both use this contract through the shared live sandbox session hook.

## Integrations Contract

The current integrations contract supports platform OAuth connect flows, tenant-defined webhook HTTP tools, and explicit workflow tool grants:

- `POST /organizations/:orgId/integrations/:provider/connect`
- `GET /integrations/oauth/:provider/callback`
- `GET /organizations/:orgId/integrations/connections`
- `POST /organizations/:orgId/integrations/connections/:connectionId/health-check`
- `POST /organizations/:orgId/integrations/connections/:connectionId/revoke`
- `GET /organizations/:orgId/integrations/connectors/:provider/tools`
- `POST /organizations/:orgId/integrations/connectors/:provider/tools/:toolId/execute`
- `POST /organizations/:orgId/integrations/webhook-tools`
- `GET /organizations/:orgId/integrations/webhook-tools`
- `POST /organizations/:orgId/integrations/tool-grants`
- `GET /organizations/:orgId/integrations/tool-grants`

OAuth connection responses expose masked credential references, health posture, status, and audit events without raw tokens. Tenant admins can run a health check to update connector status, revoke a connection to mark it unusable while preserving its history, and reconnect through the OAuth connect flow with `reconnectConnectionId` so the new connection inherits prior audit breadcrumbs.

Connector tool schema and execution routes expose deterministic typed tools for Zendesk, HubSpot, Google Workspace, and Notion. Execution requires a tenant-scoped connected OAuth credential with the tool's required scopes, rejects revoked or missing connections, maps provider recoverable failures such as rate limits or duplicate contact matches into structured API errors, and never returns OAuth tokens.

Webhook HTTP tool definitions store method, URL, headers, optional body template, timeout, and retry policy. Public API responses return an `authTokenReference` and never return the raw token. Runtime resolves `secret://webhook-http-tools/:toolId/auth-token` only inside the live sandbox tool registry, injects it as a bearer header when no explicit authorization header is present, and enforces the stored timeout plus retry policy around the outbound request.

## Memory Contract

The current memory contract supports opt-in durable caller/account memory plus tenant knowledge memory:

- `POST /organizations/:orgId/memory`
- `GET /organizations/:orgId/memory?callerKind=:kind&callerValue=:value&accountId=:accountId`
- `POST /organizations/:orgId/memory/retrieve`
- `POST /organizations/:orgId/memory/extract`
- `POST /organizations/:orgId/memory/drafts/:draftId/approve`
- `POST /organizations/:orgId/memory/drafts/:draftId/reject`
- `POST /organizations/:orgId/memory/knowledge`
- `POST /organizations/:orgId/memory/knowledge/ingestions`
- `GET /organizations/:orgId/memory/knowledge/ingestions/:ingestionId`
- `POST /organizations/:orgId/memory/knowledge/ingestions/:ingestionId/retry`
- `GET /organizations/:orgId/memory/knowledge?publishedWorkflowVersionId=:publishedVersionId&now=:isoTimestamp`
- `POST /organizations/:orgId/memory/retention/purge`
- `GET /organizations/:orgId/memory/export`
- `DELETE /organizations/:orgId/memory/tenant-data`
- `PATCH /organizations/:orgId/memory/:memoryId`
- `DELETE /organizations/:orgId/memory/:memoryId`

Caller/account memory writes require `optIn: true`; rejected writes do not create records. Sensitive memory classes such as payment card data, passwords, tokens, SSNs, and other secret-like data are rejected before durable storage. Memory records are scoped by organization, caller identity, and optional account ID. Caller-scoped records are returned for the matching caller, while account-scoped records require both the matching caller identity and account ID. Public responses include source, confidence, approval state, and status, but no transcript/audio payloads beyond the approved memory text. Writes may include an `embedding` vector for semantic retrieval; embedding vectors are never returned by public APIs.

Tenant-scoped memory operators can edit memory text/confidence, disable active records, and delete records through the memory item routes. Edit, disable, and delete actions append public audit trail entries with actor and timestamp. Deletes are soft deletes for the memory fact so audit context remains available, and they remove associated embedding records so deleted facts no longer appear in semantic retrieval.

If a write includes `approvalRequired: true`, `POST /memory` returns a pending draft and does not create durable active memory. Approvers can approve a pending draft, optionally editing text or confidence, which writes the approved memory. Approvers can also reject a pending draft with an optional reason. Draft responses include an audit trail for draft creation, approval, and rejection.

Embedding retrieval accepts `queryEmbedding`, optional `topK`, optional `scope`, optional `minConfidence`, and the matching scope context such as caller identity, account ID, or published workflow version ID. Results are ordered by cosine similarity and filtered by tenant, scope, and confidence before ranking.

Post-call extraction accepts a call session ID, transcript ID, caller identity, optional account ID, opt-in flag, and transcript entries. It returns pending caller/account memory drafts linked back to source transcript event IDs plus filtered candidate reasons. Extraction rejects non-opt-in requests, ignores non-caller assertions to reduce false memory, and filters sensitive content such as card numbers, passwords, tokens, and SSNs. Drafts are not persisted as approved memory by this route.

Tenant knowledge records store policies and FAQs with one or more published workflow version IDs, source title, source kind, optional URI, optional external ID, and optional `staleAt`. Workflow retrieval returns only active, non-stale knowledge attached to the requested published workflow version. Conflicting active records with the same kind and title are returned as separate source-traceable records with `conflictState: "conflicting"` instead of silently overwriting either source.

Knowledge ingestion jobs accept already-resolved content from `document`, `website`, `pdf`, `notion`, `google_drive`, and `crm_help_center` sources. The job response exposes aggregate status plus per-source success or retryable failure details. Successful sources create tenant knowledge records for the target published workflow versions. Failed sources can be retried with corrected source payloads without duplicating successful sources from the original job.

Retention purge removes memory, knowledge records, embeddings, and linked ingestion source rows older than a tenant-supplied cutoff unless legal hold is active. Tenant export returns memory records, knowledge records, drafts, ingestion job status, and embedding metadata without raw embedding vectors. Tenant memory delete clears all memory-module state for the organization, is blocked by legal hold, and does not affect other tenants.

## Billing And Polar Contract

The current tenant billing contract exposes plan, usage, budget, invoice/order, entitlement, checkout, portal, webhook, and usage-billing state:

- `GET /organizations/:orgId/billing/state`
- `POST /organizations/:orgId/billing/checkout`
- `POST /organizations/:orgId/billing/customer-portal`
- `PATCH /organizations/:orgId/billing/budget-policy`
- `POST /organizations/:orgId/billing/budget-checks`
- `POST /organizations/:orgId/billing/usage-events`
- `POST /organizations/:orgId/billing/telephony-minute-events`
- `POST /organizations/:orgId/billing/runtime-cost-events`
- `POST /billing/polar/webhooks`

Billing state responses are tenant-scoped and public-safe. They include the Polar customer external ID, plan, subscription status, granted entitlements, usage totals, budget policy, budget warnings, usage aggregates by feature, telephony minute aggregates by provider connection, runtime cost events, and invoice/order summaries, but never return `POLAR_ACCESS_TOKEN`, webhook secrets, provider bearer tokens, or raw payment provider payload secrets.

Checkout and customer portal actions require tenant billing admin access and route through Zara backend APIs. Checkout creates a Polar session with `externalCustomerId` set to the Zara organization ID and metadata that includes the organization and actor IDs. Customer portal actions create an authenticated Polar customer-session URL from the backend so the browser only receives the hosted portal URL.

The API includes `@polar-sh/better-auth` and `@polar-sh/sdk`. `apps/api/src/billing/better-auth-polar.ts` defines the Better Auth Polar plugin composition for checkout, portal, usage, and webhooks, while `BillingService` owns Zara's tenant billing state and the public API contract. Polar webhook handling currently processes `customer.state_changed` and `order.paid`, verifies signatures when `POLAR_WEBHOOK_SECRET` is configured, updates subscription, plan, entitlement, invoice/order, and cancellation state, and stores processed webhook IDs to suppress replay. Usage events use caller-supplied idempotency keys before forwarding event ingestion to Polar with the Zara organization ID as the external customer ID. Usage events carry a feature key, and tenant billing state derives feature aggregates only from unique persisted events.

Telephony minute events are keyed by tenant, call session, provider, and provider connection. Completed and transferred calls are rounded up to the next full minute and forwarded to Polar as `zara_telephony_minutes`; failed calls are classified, retained in accounting state, and billed as zero minutes. Billing state exposes provider-connection aggregates with completed, failed, and transferred call counts.

Runtime cost events accept the same usage shape emitted by `turn.cost.delta` runtime events for STT minutes, model input tokens, model output tokens, and TTS characters. Billing resolves them against a versioned runtime rate catalog, stores complete/incomplete cost components, flags unknown model/STT/TTS rates in `missingRates`, and creates Polar usage events only for components with known rates.

Tenant budget policy controls monthly spend, call minutes, and premium runtime minutes. Budget checks project a requested call or premium runtime reservation against current billing usage, then return `allow`, `warn`, or `block` according to the configured over-budget behavior. Billing state exposes warning records once configured usage crosses the policy threshold so admins can see near-limit budgets before a hard block.

## State Repository Implementation Notes

Billing, integrations, and memory currently use tenant-scoped file-backed JSON state repositories for their local control-plane state. Telephony keeps the same file-backed adapter for focused tests and support paths while the production module uses normalized Postgres tables. These file-backed repositories share `createTenantJsonStateRepository` for storage mechanics: tenant file naming, tenant listing, validated load, atomic replacement, optional corrupt snapshot quarantine, optional encoded organization IDs, and optional trailing newline writes.

Feature repositories remain responsible for their own persisted schema validation, compatibility normalization, encrypted credential references, and public response shaping. The shared adapter should not learn billing, integration, memory, or telephony domain rules.

## Workspace State Contract

The current workspace state contract is implemented as a small NestJS control-plane module that serves the tenant shell and workspace settings UI:

- `GET /organizations/:orgId/workspaces/state`
- `POST /organizations/:orgId/workspaces`
- `PATCH /organizations/:orgId/workspaces/:workspaceId`
- `POST /organizations/:orgId/workspaces/:workspaceId/accessed`
- `PUT /organizations/:orgId/workspaces/:workspaceId/memberships/:userId`
- `POST /organizations/:orgId/workspaces/:workspaceId/memberships/:userId/revoke`

State payload:

- `organizationId`
- `directoryUsers`
- `workspaces`
- `memberships`
- `auditEntries`

Current behavior:

- The tenant shell loads workspace directory state from Nest instead of browser-local persistence.
- Tenant onboarding initializes the default workspace state and grants the new tenant owner `owner` membership on `workspace-support` before the tenant shell opens.
- Active workspace selection is still stored locally in the browser for UX continuity, but the accessible workspace list, memberships, and audit trail come from the API.
- Rename, archive, restore, membership role changes, membership revocation, and workspace-access audit writes all round-trip through the Nest module.
- Final-owner protection and archive blocking with active sessions are enforced by shared `@zara/core` domain rules and surfaced as conflict responses.
- Local tenant origins such as `http://127.0.0.1:4173`, `http://localhost:4173`, `http://127.0.0.1:4174`, and `http://localhost:4174` are explicitly allowed by Nest CORS configuration so the split local apps can call the API without proxy hacks.

## Telephony State Contract

The current telephony contract is implemented as a NestJS control-plane module that backs the tenant `/calls` surface and the current hybrid telephony MVP:

- `GET /organizations/:orgId/telephony/state`
- `POST /organizations/:orgId/telephony/connections`
- `POST /organizations/:orgId/telephony/connections/:connectionId/validate`
- `POST /organizations/:orgId/telephony/connections/:connectionId/heartbeat`
- `POST /organizations/:orgId/telephony/connections/:connectionId/import-twilio-numbers`
- `POST /organizations/:orgId/telephony/connections/:connectionId/register-number`
- `POST /organizations/:orgId/telephony/connections/:connectionId/test-call`
- `PATCH /organizations/:orgId/telephony/numbers/:numberId/routing`
- `POST /organizations/:orgId/telephony/numbers/:numberId/pstn-test-route`
- `POST /organizations/:orgId/telephony/numbers/:numberId/pstn-test-route/:sessionId/complete`
- `POST /organizations/:orgId/telephony/numbers/:numberId/live-route/activate`
- `POST /organizations/:orgId/telephony/numbers/:numberId/live-route/pause`
- `POST /organizations/:orgId/telephony/numbers/:numberId/live-route/resume`
- `POST /organizations/:orgId/telephony/dispatch/inbound`
- `POST /organizations/:orgId/telephony/dispatch/outbound`
- `POST /organizations/:orgId/telephony/calls/:callSessionId/human-fallback`
- `POST /organizations/:orgId/telephony/credentials/rotate`
- `POST /organizations/:orgId/telephony/calls/:callSessionId/events`
- `POST /organizations/:orgId/telephony/calls/:callSessionId/runtime-policy`
- `POST /telephony/webhooks/twilio`

State payload:

- `organizationId`
- `connections`
- `phoneNumbers`
- `healthChecks`
- `providerHeartbeats`
- `dispatches`
- `executionSessions`
- `executionCommands`
- `webhookEvents`
- `callControlEvents`

Current behavior:

- The connection model supports `platform_managed`, `byo_sip_trunk`, and `byo_provider_account`, and the tenant UI now exposes all three.
- The public API returns credential references and never raw provider secrets.
- Provider secret material is encrypted before it is written to durable telephony state, and encrypted envelopes carry key version metadata.
- Validation updates connection health posture and returns the latest provider check result.
- Heartbeat runs write durable provider diagnostics, latency, and scheduled/manual posture into telephony state.
- Platform-managed connections can provision Zara-owned numbers directly.
- SIP trunk connections can register DIDs directly and return actionable warning messages when no DID or routed workflow exists yet.
- Twilio number import only accepts voice-capable numbers and marks webhook posture separately from route posture.
- Number routing binds a number to a published workflow version plus workspace and recording policy.
- Protected PSTN Phone test routes create expiring allowed-caller waiting sessions and can store sanitized manual completion results.
- Saved live routes start as `pending_activation`; they answer live calls only after activation from a matching successful Phone test result or an audited override.
- Live route activation evaluates subscription, tenant suspension, budget, provider health, required credentials, and recording posture before setting `activationStatus: "active"`.
- Pause/resume endpoints preserve route setup, credentials, test results, and dispatch history while changing whether live inbound calls can be answered.
- Inactive subscription, hard budget block, tenant suspension, pending activation, or paused route creates a blocked inbound dispatch and returns safe unavailable TwiML for Twilio webhooks.
- Runtime policy updates can move active execution sessions to subscription grace, budget closeout after the current turn, or immediate tenant-suspension termination.
- Inbound dispatch uses the same shared resolver for manual tests and validated webhook events, including provider fallback to another healthy routed number when one exists, then opens a provider-native execution session plus command record.
- Outbound dispatch evaluates DNC, timezone, consent, budget, calling window, caller ID, and abuse policy before the call is queued, then opens a provider-specific execution session and provider-native command record when it passes.
- Outbound abuse policy supports `maxCallsPerWindow`, `windowSeconds`, and `pauseTenantOnViolation`; violations can disable tenant telephony connections and emit `telephony.outbound_abuse_paused` audit records for review.
- Outbound compliance policy supports tenant DNC numbers, destination timezone/local-time context, and audited emergency safe-window overrides. DNC blocks cannot be overridden in this slice.
- Dispatches and execution sessions record `recordingConsent`; two-party recording queues `telephony.recording.play-notice` before bridge/origination commands.
- Connection test calls reuse inbound dispatch but mark the execution session as a loopback provider test and persist the bridge command history.
- Call control events persist DTMF, voicemail, transfer, and failover actions against a call session, advance the stored execution session status, and append provider-native control commands with applied timestamps.
- Human fallback resolves live takeover only for provider bridges that support safe transfer; callback-only bridges schedule a callback using a valid E.164 callback number and return safe caller-facing copy.
- Human fallback actions append call-control audit events and provider-native execution commands, including `transfer.requested` for takeover and `callback.scheduled` for callback fallback.
- Twilio webhooks verify signature against the absolute callback URL and suppress duplicate `EventSid` replays.
- Telephony connections, imported numbers, dispatch history, execution bridge history, and webhook replay state survive API restarts through normalized Postgres telephony tables.
- Credential rotation reseals stored envelopes to the active key version and supports restart-safe legacy-key recovery through environment configuration.
- Credential rotation emits `telephony.credentials_rotated` tenant audit records.

## Compliance

Routes:

- `GET /organizations/:orgId/compliance/audit-logs`
- `GET /organizations/:orgId/compliance/readiness`
- `POST /organizations/:orgId/compliance/retention-jobs`

Current behavior:

- Audit logs include actor, tenant, target, action, outcome, timestamp, metadata, and hash-chain fields.
- Missing actor IDs are recorded as system actors.
- Failed compliance mutations write failed audit entries.
- Readiness responses expose the general SaaS control checklist for encryption, audit, retention, consent, and access control.
- Readiness responses explicitly make no HIPAA or PCI claim and document regulated-data and data-residency gaps.
- Retention jobs apply tenant cutoffs to telephony calls, transcript-like call-control events, memory retention data, and recording object deletions.
- Legal hold blocks deletion before destructive work starts.
- Recording object delete failures return `retry_scheduled`, failed targets, and `nextRetryAt`; retry jobs can reference `retryOfJobId`.
