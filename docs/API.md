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
- Integrations: OAuth connections, connector health, tool grants.
- Memory: records, retrieval, approval, retention, deletion.
- Calls: sessions, transcripts, recordings, summaries, dispositions.
- Monitoring: live event stream, escalation queue, quality flags.
- Billing: usage events, budgets, plan limits, cost estimates.
- Audit: immutable security and admin activity records.

## Representative Routes

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
- GET /organizations/:orgId/sandbox/live-sessions/:sessionId
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
- POST /organizations/:orgId/telephony/dispatch/inbound
- POST /organizations/:orgId/telephony/dispatch/outbound
- POST /organizations/:orgId/telephony/credentials/rotate
- POST /organizations/:orgId/integrations/:provider/connect
- GET /integrations/oauth/:provider/callback
- GET /organizations/:orgId/memory
- PATCH /organizations/:orgId/memory/:memoryId
- DELETE /organizations/:orgId/memory/:memoryId
- GET /organizations/:orgId/calls/:callId/events
- POST /organizations/:orgId/telephony/calls/:callSessionId/events
- POST /telephony/webhooks/:provider
- GET /platform-admin/dashboard
- GET /platform-admin/organizations
- GET /platform-admin/organizations/:orgId
- PATCH /platform-admin/organizations/:orgId/status
- GET /platform-admin/runtime/health
- GET /platform-admin/audit-logs
- POST /platform-admin/organizations/:orgId/impersonation-sessions
- DELETE /platform-admin/impersonation-sessions/:id

## Contract Rules

- APIs never return raw secrets.
- Tenant ID is always derived from authenticated membership or verified telephony route, not trusted from arbitrary payloads.
- Platform-admin APIs require platform roles and must not authorize from tenant organization roles.
- Mutations write audit logs.
- Platform-admin actions always write audit logs.
- Runtime event writes are idempotent.
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

- `session`: premium realtime session contract including runtime, policy, voice, transport URL, expiry, and observed event types

Behavior rules:

- Only roles or manifests opted into `premium-realtime` can create a session.
- Budget blocks return a conflict response.
- Realtime availability failures return service unavailable.
- Tool and handoff observation stays aligned with `@zara/core` event types.
- `apps/web` published sandbox runs call this route on demand before premium microphone or typed sandbox start, then display the returned transport contract in the sandbox surface.

## Live Sandbox Session Contract

The live sandbox transport foundation is now implemented as a NestJS-owned session layer for browser audio:

- `POST /organizations/:orgId/sandbox/live-sessions`
- `GET /organizations/:orgId/sandbox/live-sessions/:sessionId`
- `POST /organizations/:orgId/sandbox/live-sessions/:sessionId/end`
- `WS /organizations/:orgId/sandbox/live-sessions/:sessionId/stream`

Request body for session create:

- `workspaceId`
- `source`: `draft` or `published`
- `manifestSource`
  - draft: validated draft graph payload plus selected runtime configuration
  - published: published workflow version id
- `entryRoleId`
- `inputMode`: `voice` or `typed`
- `transport`: browser audio transport settings

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

Behavior rules:

- Session creation requires organization membership and workspace access.
- Draft sessions freeze the validated draft manifest at start time.
- Browser clients receive only short-lived transport tokens, never provider secrets.
- The current foundation creates session records, issues transport tokens, returns transport URLs, supports session teardown, and exposes a token-gated websocket stream endpoint.
- The websocket stream now supports server-to-browser event fanout for sandbox lifecycle and runtime events.
- Browser-to-server messages are currently transport-scoped placeholders until live audio frame handling lands.
- End session requests close provider streams, flush final events, and revoke the transport token.

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
- `POST /organizations/:orgId/telephony/dispatch/inbound`
- `POST /organizations/:orgId/telephony/dispatch/outbound`
- `POST /organizations/:orgId/telephony/credentials/rotate`
- `POST /organizations/:orgId/telephony/calls/:callSessionId/events`
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
- Inbound dispatch uses the same shared resolver for manual tests and validated webhook events, including provider fallback to another healthy routed number when one exists, then opens a provider-native execution session plus command record.
- Outbound dispatch evaluates consent, budget, calling window, and caller ID policy before the call is queued, then opens a provider-specific execution session and provider-native command record when it passes.
- Connection test calls reuse inbound dispatch but mark the execution session as a loopback provider test and persist the bridge command history.
- Call control events persist DTMF, voicemail, transfer, and failover actions against a call session, advance the stored execution session status, and append provider-native control commands with applied timestamps.
- Twilio webhooks verify signature against the absolute callback URL and suppress duplicate `EventSid` replays.
- Telephony connections, imported numbers, dispatch history, execution bridge history, and webhook replay state survive API restarts through normalized Postgres telephony tables.
- Credential rotation reseals stored envelopes to the active key version and supports restart-safe legacy-key recovery through environment configuration.
