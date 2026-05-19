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
- inbound dispatch resolution from a number to a published workflow route
- outbound dispatch policy evaluation for consent, budget, calling window, and caller ID
- provider-specific execution sessions for inbound, outbound, and loopback test calls
- first-class call control events for DTMF, voicemail, transfer, and failover
- session advancement on transfer failure and provider failover events
- provider outage fallback to another healthy routed number on the same workflow
- manual and scheduled provider heartbeats with durable diagnostics
- loopback provider test calls from the tenant `/calls` surface
- organization-wide credential rotation with legacy key support
- Twilio webhook signature verification and duplicate `EventSid` suppression
- normalized Postgres-backed tenant telephony state that survives API restarts
- durable provider-native execution command history for dispatch, testing, and call-control actions

The current NestJS implementation persists telephony control-plane state in normalized Postgres tables and encrypts provider secret material before writing credential envelopes at rest. Inbound, outbound, loopback, and call-control flows all record provider-native execution sessions and command history so operator state, routing posture, and bridge actions reload cleanly after restart.

## Current API Surface

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

## Tenant Flow On `/calls`

1. Operator connects platform telephony, a BYO Twilio account, or a BYO SIP trunk.
2. Zara stores a masked credential reference on the returned connection surface and keeps runtime secrets out of the API response body.
3. Operator validates provider health or runs a provider heartbeat. SIP validation warns when no DID or routed workflow exists yet.
4. Operator provisions platform numbers, imports Twilio numbers, or registers SIP DIDs.
5. Operator selects a published workflow from the active workspace and saves routing for a live number.
6. Operator runs inbound dispatch tests, loopback provider test calls, or workflow-page routed sandbox simulations before live traffic is pointed at the route.
7. Operator runs outbound dispatch policy checks for consent, budget, calling window, and caller ID.
8. Zara records provider execution sessions, heartbeat diagnostics, and outage fallback posture directly in telephony state.
9. Operator records DTMF, voicemail, transfer, and failover events against live or queued call sessions.

## Workflow Page Route Simulation

The workflow builder now reuses telephony state for published workflows. When a workflow version already has a routed live number in the active workspace, the `/workflows` sandbox drawer can switch from draft graph mode into routed-number mode.

That routed mode:

- lists the published live numbers bound to the current workflow
- shows connection label, provider rail, recording posture, and published version
- starts a telephony-backed dispatch simulation through `POST /organizations/:orgId/telephony/dispatch/inbound`
- replays caller turns against the exact published phone path while showing the latest bridge action and call session ID

This keeps pre-publish draft testing and post-publish phone-path verification on one page, while `/sandbox` remains the broader workspace test surface for published workflows.

## Webhook Rules

- Verify the incoming Twilio signature against the absolute callback URL.
- Identify the matching tenant connection by account SID plus verified signature.
- Reject invalid signatures with `401`.
- Treat `EventSid` as idempotent and return a duplicate response when the same event arrives twice.
- Reuse the same inbound dispatch resolver for manual tests and webhook-driven inbound routing.
- Load persisted tenant telephony state on demand so verified webhooks still resolve after an API restart.

## Recording Policy

Recording policy can be set at connection level and overridden at number-routing level.

Supported consent modes:

- `disabled`
- `single-party`
- `two-party`

The current UI exposes recording posture on connection setup and carries it into saved routes plus inbound and outbound dispatch results.

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

## Operational Controls

Optional local environment variables:

- `TELEPHONY_CREDENTIAL_MASTER_KEY`: overrides the master secret used to derive telephony encryption keys. If omitted, Zara falls back to `BETTER_AUTH_SECRET`.
- `TELEPHONY_CREDENTIAL_KEY_VERSION`: stored with each encrypted secret envelope.
- `TELEPHONY_CREDENTIAL_LEGACY_KEYS`: optional JSON object of legacy key versions to master secrets used during restart-safe credential rotation. Example: `{"7":"old-secret"}`.
- `ZARA_TELEPHONY_HEARTBEAT_INTERVAL_MS`: enables scheduled heartbeat sweeps when greater than zero.

Operational persistence depends on the main `DATABASE_URL` and stores telephony state across normalized control-plane tables for connections, numbers, health checks, dispatches, execution sessions, execution commands, webhook events, and encrypted credential envelopes.
