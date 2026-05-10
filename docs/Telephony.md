# Telephony

## Ownership Modes

- platform_managed: Zara controls provider account, numbers, and trunks.
- byo_sip_trunk: tenant configures SIP trunk credentials and routing.
- byo_provider_account: tenant connects provider credentials, starting with Twilio.

## BYO Twilio V1

- Store encrypted credential reference.
- Validate account access.
- Import voice-capable numbers.
- Configure or verify webhooks.
- Map imported numbers to published workflow versions.
- Show health and last validation result.

## BYO SIP V1

- Store encrypted SIP credentials and trunk metadata.
- Validate SIP route with test call or provider diagnostic.
- Capture codec, region, failover, and caller ID policy.
- Block production routing if required health checks fail.

## Required Events

- call.started
- call.ended
- call.failed
- telephony.webhook.received
- telephony.route.resolved
- telephony.health.failed
- telephony.transfer.requested
- telephony.voicemail.detected
- telephony.dtmf.received

## Edge Cases

DTMF menus, voicemail detection, transfers, duplicate webhooks, carrier retries, disabled numbers, provider outage, bad credentials, codec mismatch, and calling-window enforcement must be covered.
