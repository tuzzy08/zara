# Telephony

## Ownership Modes

- `platform_managed`: Zara owns provider account, numbers, and routing surface.
- `byo_sip_trunk`: tenant owns SIP credentials and Zara validates trunk posture before routing.
- `byo_provider_account`: tenant connects provider credentials, starting with Twilio.

## Current MVP Slice

The first implemented telephony slice is Twilio-first inbound control-plane support:

- tenant-scoped telephony connection model in `@zara/core`
- BYO Twilio account connect flow on `apps/web` `/calls`
- masked credential references on the public API surface
- provider validation and health status
- import of voice-capable Twilio numbers only
- routing imported numbers to published workflow versions
- per-connection and per-number recording policy
- inbound dispatch resolution from a number to a published workflow route
- Twilio webhook signature verification and duplicate `EventSid` suppression

The current NestJS implementation is intentionally in-memory. It is a working control-plane slice, not the final persistent production store.

## Current API Surface

- `GET /organizations/:orgId/telephony/state`
- `POST /organizations/:orgId/telephony/connections`
- `POST /organizations/:orgId/telephony/connections/:connectionId/validate`
- `POST /organizations/:orgId/telephony/connections/:connectionId/import-twilio-numbers`
- `PATCH /organizations/:orgId/telephony/numbers/:numberId/routing`
- `POST /organizations/:orgId/telephony/dispatch/inbound`
- `POST /telephony/webhooks/twilio`

## Tenant Flow On `/calls`

1. Operator connects a BYO Twilio account with account SID, auth token, region, and recording posture.
2. Zara stores a masked credential reference on the returned connection surface and keeps the runtime secret out of the API response body.
3. Operator validates provider health.
4. Zara imports voice-capable numbers and excludes SMS-only inventory.
5. Operator selects a published workflow from the active workspace and saves routing for a number.
6. Operator runs an inbound dispatch test before live traffic is pointed at the route.

## Webhook Rules

- Verify the incoming Twilio signature against the absolute callback URL.
- Identify the matching tenant connection by account SID plus verified signature.
- Reject invalid signatures with `401`.
- Treat `EventSid` as idempotent and return a duplicate response when the same event arrives twice.
- Reuse the same inbound dispatch resolver for manual tests and webhook-driven inbound routing.

## Recording Policy

Recording policy can be set at connection level and overridden at number-routing level.

Supported consent modes:

- `disabled`
- `single-party`
- `two-party`

The current UI exposes this while connecting Twilio and passes the selected policy into saved routes and inbound dispatch results.

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

## Known Gaps

- no durable telephony persistence yet
- no envelope-encrypted secrets store yet
- no platform-managed telephony UI yet
- no SIP trunk UI yet
- no outbound call dispatch yet
- no DTMF, transfer, voicemail, or failover execution yet
- no scheduled provider heartbeat jobs yet

These remain tracked by later telephony, security, and production-hardening issues.
