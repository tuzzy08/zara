# ISSUE-144: Twilio bidirectional Media Streams bridge

Status: Todo
Date: 2026-05-28
External: [Linear ZAR-90](https://linear.app/zara-voice/issue/ZAR-90/issue-144-twilio-bidirectional-media-streams-bridge)

## Work Completed

- Created the reconciled local backlog entry and matching Linear issue.
- Standardized Twilio as the first concrete provider bridge behind provider-neutral media interfaces.
- Captured WebSocket message, TwiML, media frame, DTMF, mark, clear, and stop behavior in the PSTN standard.

## Tests Run

- Not run. This pass created planning docs and issue records only.

## Pending Work

- Add failing Twilio webhook, TwiML, and media WebSocket message contract tests.
- Build the synthetic Twilio media harness before relying on real Twilio calls.
- Implement the bridge so Twilio types do not leak into the core runtime packet.
- Update telephony and security docs after implementation.

## Risks

- Provider-specific message shapes can leak into core runtime code if the adapter boundary is weak.
- Malformed media messages and duplicate webhooks can create call-state corruption unless handled explicitly.

## Decisions

- Twilio webhook signature verification happens before route resolution and bridge TwiML.
- Twilio media payloads are base64 G.711 mu-law 8 kHz frames.

## Next Recommended Step

- Start RED with Twilio message contract tests and synthetic WebSocket harness cases.
