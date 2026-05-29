# Telephony

## Ownership Modes

- `platform_managed`: Zara owns provider account, numbers, and routing surface.
- `byo_sip_trunk`: tenant owns SIP credentials and Zara validates trunk posture before routing.
- `byo_provider_account`: tenant connects provider credentials, starting with Twilio.

## Current MVP Slice

The current telephony slice now covers the first hybrid control-plane milestone:

- tenant-scoped telephony connection model in `@zara/core`
- platform-managed telephony connections with Zara-managed number provisioning
- BYO Twilio account connect flow with imported voice-capable numbers
- BYO SIP trunk connect flow with manual DID registration
- masked credential references on the public API surface
- encrypted provider secret envelopes at rest with key version metadata
- provider validation and health status, including actionable SIP route warnings
- routing live numbers to published workflow versions
- per-connection and per-number recording policy
- recorded dispatch/session consent state and pre-bridge recording notices for two-party recording
- inbound dispatch resolution from a number to a published workflow route
- outbound dispatch policy evaluation for consent, budget, calling window, and caller ID
- outbound abuse rate limiting with optional tenant pause and compliance audit logs
- outbound DNC, timezone, and audited emergency override checks
- tenant/provider-connection minute accounting for completed, transferred, and failed calls
- provider-specific execution sessions for inbound, outbound, and loopback test calls
- first-class call control events for DTMF, voicemail, transfer, and failover
- session advancement on transfer failure and provider failover events
- provider outage fallback to another healthy routed number on the same workflow
- manual and scheduled provider heartbeats with durable diagnostics
- loopback provider test calls from the tenant `/calls` surface
- organization-wide credential rotation with legacy key support and compliance audit records
- Twilio webhook signature verification and duplicate `EventSid` suppression
- normalized Postgres-backed tenant telephony state that survives API restarts
- durable provider-native execution command history for dispatch, testing, and call-control actions
- protected PSTN phone-test routes with separate `liveRoute` and `testRoute` number records, caller allow-lists, expiry, and stored phone-test checklist results
- premium realtime PSTN route resolution through a separately labeled `pstn-premium-realtime` path with entitlement, provider capability, budget, and fallback-policy gates

The current NestJS implementation persists telephony control-plane state in normalized Postgres tables and encrypts provider secret material before writing credential envelopes at rest. Inbound, outbound, loopback, protected phone-test, and call-control flows all record provider-native execution sessions and command history so operator state, routing posture, and bridge actions reload cleanly after restart.

## PSTN Live Call Runtime

The PSTN live call runtime is standardized in `docs/PSTN-Live-Call-Runtime-Standard.md` and tracked by ISSUE-142 through ISSUE-149. It moves telephony from control-plane dispatch and simulations into real bidirectional PSTN media sessions:

- provider-neutral live call session core before provider-specific bridge code (implemented in ISSUE-142)
- dedicated `pstn-sandwich` runtime path optimized for G.711 mu-law 8 kHz audio (implemented in ISSUE-143 core/provider-config baseline)
- Twilio `<Connect><Stream>` bidirectional Media Streams as the first concrete bridge (implemented in ISSUE-144)
- separate protected `testRoute` and `liveRoute` state for phone numbers (implemented in ISSUE-145)
- explicit Phone test waiting sessions with allowed caller numbers and expiry (implemented in ISSUE-145)
- successful phone-test checklist stored against number ID, published version ID, and runtime profile (implemented in ISSUE-145)
- unified sandbox Phone test mode with `/calls` launch, `/workflows` deep links, waiting-session state, checklist progress, and manual result completion (implemented in ISSUE-146)
- manual live activation with subscription, budget, recording, provider health, and abuse/security gates (implemented in ISSUE-147)
- PSTN latency and call-quality observability for platform admins (implemented in ISSUE-148)
- premium realtime over PSTN as a separate `pstn-premium-realtime` provider path (implemented in ISSUE-149)

Draft workflow graphs must not answer PSTN calls. Phone tests and live routes always pin to exact published workflow versions. Phone-number route state is stored as `liveRoute` and `testRoute`; legacy flat workflow route fields were removed from the phone-number model. A saved live route starts as `pending_activation`, answers only when activation passes, can be paused without losing setup/history, and records activation actor/test or audited override metadata. The implemented live call session core, PSTN sandwich media harness, and premium realtime provider path are provider-neutral and keep Twilio-specific call IDs out of core session snapshots, packet events, and media runtime contracts. The implemented Twilio bridge lives in the Nest telephony module, returns safe `<Connect><Stream>` TwiML after webhook signature verification and routed dispatch, authorizes the media socket from the server-created execution session, and passes normalized mu-law frames into the runtime boundary while receiving normalized outbound frames plus clear/mark-worthy events. The Twilio stream includes `zaraRuntimePath` metadata for observability, but route authority still comes only from the server-created dispatch/session. If live answering is blocked by pending activation, pause, inactive subscription, hard budget block, tenant suspension, missing premium entitlement, provider capability failure, provider outage, or an unapproved premium fallback policy, the bridge returns safe unavailable TwiML and records a blocked dispatch. PSTN webhook and media lifecycle points now emit OpenTelemetry-ready spans, internal quality metrics, and redacted LangSmith PSTN projections; platform-admin runtime health shows PSTN quality posture and `npm run eval:pstn` gate state.

## Current API Surface

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
- `POST /organizations/:orgId/telephony/calls/:callSessionId/pstn-test-checkpoints`
- `POST /organizations/:orgId/telephony/calls/:callSessionId/runtime-policy`
- `POST /organizations/:orgId/telephony/calls/:callSessionId/human-fallback`
- `POST /organizations/:orgId/telephony/credentials/rotate`
- `POST /organizations/:orgId/telephony/calls/:callSessionId/events`
- `POST /telephony/webhooks/twilio`
- `WS /telephony/twilio/media-streams/:callSessionId`

## Tenant Flow On `/calls`

1. Operator connects platform telephony, a BYO Twilio account, or a BYO SIP trunk.
2. Zara stores a masked credential reference on the returned connection surface and keeps runtime secrets out of the API response body.
3. Operator validates provider health or runs a provider heartbeat. SIP validation warns when no DID or routed workflow exists yet.
4. Operator provisions platform numbers, imports Twilio numbers, or registers SIP DIDs.
5. Operator selects a published workflow from the active workspace and saves routing for a live number.
6. Operator starts a protected PSTN phone test for a routed number by choosing the exact published version/runtime profile, at least one allowed caller number, and an expiry.
7. Zara prefers the matching active `testRoute` only when the caller is allowed and the waiting session has not expired; otherwise inbound dispatch uses `liveRoute` or rejects safely.
8. Operator can launch the shared Phone test sandbox from `/calls` or `/workflows` instead of using a separate workflow-page simulation.
9. Operator activates the live route only after a successful matching phone test or audited override passes subscription, budget, tenant, provider health, credential, and recording gates.
10. Premium realtime routes additionally require premium runtime entitlement, provider capability/availability, budget allowance, and explicit fallback policy before media connects.
11. Operator can pause or resume a live route without losing the number setup, credentials, test history, dispatch history, or activation metadata.
12. Operator runs outbound dispatch policy checks for DNC, timezone, consent, budget, calling window, caller ID, and abuse limits.
13. Zara records provider execution sessions, heartbeat diagnostics, consent posture, phone-test checklist posture, activation posture, and outage fallback posture directly in telephony state.
14. Operator records DTMF, voicemail, transfer, and failover events against live or queued call sessions.
15. When escalation needs human help, Zara chooses live transfer for capable provider bridges and callback fallback for callback-only bridges, then audits the safe caller-facing message and provider command.

## Workflow Page Phone Test Launch

The workflow builder now reuses telephony state for published workflows. When a workflow version already has a routed live number in the active workspace, the `/workflows` sandbox drawer can switch from Draft test (browser) into Phone test (Twilio/PSTN) mode.

That Phone test mode:

- lists the published live numbers bound to the current workflow
- shows connection label, provider rail, recording posture, and published version
- deep-links to `/sandbox?mode=phone-test` with the exact published version and phone number selected
- does not start a separate routed dispatch simulation or duplicate the Phone test UI in the workflow drawer

This keeps pre-publish Draft test in the builder drawer while using one shared `/sandbox` Phone test surface for protected PSTN waiting sessions, allowed caller controls, checklist progress, transcript/events, and final stored results.

## Webhook Rules

- Verify the incoming Twilio signature against the absolute callback URL.
- Identify the matching tenant connection by account SID plus verified signature.
- Reject invalid signatures with `401`.
- Treat `EventSid` as idempotent and return a duplicate response when the same event arrives twice.
- Reuse the same inbound dispatch resolver for manual tests and webhook-driven inbound routing.
- Load persisted tenant telephony state on demand so verified webhooks still resolve after an API restart.
- Return TwiML, not internal JSON, to Twilio webhook callers. Routed calls receive `<Connect><Stream>` and blocked/duplicate calls receive safe reject TwiML.
- Bind Twilio media WebSockets to a verified server-created execution session. Do not trust Twilio custom parameters as tenant, route, or call authority.
- Treat `zaraRuntimePath` custom parameters as diagnostic metadata only; they cannot override the server-selected `pstn-sandwich` or `pstn-premium-realtime` route.

## Recording Policy

Recording policy can be set at connection level and overridden at number-routing level.

Supported consent modes:

- `disabled`
- `single-party`
- `two-party`

The current UI exposes recording posture on connection setup and carries it into saved routes plus inbound and outbound dispatch results.

Dispatches and execution sessions include `recordingConsent`:

- `recording_disabled` when recording is off
- `not_required` for single-party recording
- `notice_queued` for two-party recording

When `notice_queued` is present, Zara writes `telephony.recording.play-notice` before the provider bridge/origination command so the caller-facing notice is played before recording proceeds.

## Outbound Abuse Controls

Outbound dispatch accepts an abuse policy with `maxCallsPerWindow`, `windowSeconds`, and `pauseTenantOnViolation`.

When the recent queued outbound call count exceeds the configured window, the dispatch is blocked with `policyChecks.abuse.status = "blocked"`. If tenant pausing is enabled, Zara disables the tenant's telephony connections, marks their health failed, and writes `telephony.outbound_abuse_paused` to the compliance audit log with enough metadata for later review.

## DNC And Safe Calling Windows

Outbound dispatch accepts a compliance policy with tenant DNC phone numbers plus destination timezone and local time context.

When the destination appears on the DNC list, dispatch blocks the call with `policyChecks.dnc.status = "blocked"`. When compliance policy is supplied without destination timezone context, dispatch blocks with `policyChecks.timezone.status = "blocked"`.

Emergency safe-window overrides require a reason and approving user. Overrides can bypass the safe calling window but not DNC blocks, and they write `telephony.outbound_compliance_override` audit records.

## Minute Accounting

Telephony billing uses `POST /organizations/:orgId/billing/telephony-minute-events` rather than trusting provider dashboards as the tenant-facing source of truth. Each event is keyed by tenant, call session, provider, and provider connection.

Completed and transferred calls compute duration from `startedAt` to `endedAt` and round up to the next full minute. Failed calls are classified with the provider failure reason when present and remain billable at zero minutes. Billing state exposes provider-connection aggregates with billable minutes and completed, failed, and transferred call counts.

## Required Events

- `call.started`
- `call.ended`
- `call.failed`
- `telephony.webhook.received`
- `telephony.route.resolved`
- `telephony.health.failed`
- `telephony.transfer.requested`
- `telephony.voicemail.detected`
- `telephony.dtmf.received`
- `telephony.callback.scheduled`

## Operational Controls

Optional local environment variables:

- `TELEPHONY_CREDENTIAL_MASTER_KEY`: overrides the master secret used to derive telephony encryption keys. If omitted, Zara falls back to `BETTER_AUTH_SECRET`.
- `TELEPHONY_CREDENTIAL_KEY_VERSION`: stored with each encrypted secret envelope.
- `TELEPHONY_CREDENTIAL_LEGACY_KEYS`: optional JSON object of legacy key versions to master secrets used during restart-safe credential rotation. Example: `{"7":"old-secret"}`.
- `ZARA_TELEPHONY_HEARTBEAT_INTERVAL_MS`: enables scheduled heartbeat sweeps when greater than zero.

Operational persistence depends on the main `DATABASE_URL` and stores telephony state across normalized control-plane tables for connections, numbers, health checks, dispatches, execution sessions, execution commands, webhook events, and encrypted credential envelopes.
