# ISSUE-144: Twilio bidirectional Media Streams bridge

Status: Implemented
Date: 2026-05-28
External: [Linear ZAR-90](https://linear.app/zara-voice/issue/ZAR-90/issue-144-twilio-bidirectional-media-streams-bridge)

## Work Completed

- Created the reconciled local backlog entry and matching Linear issue.
- Standardized Twilio as the first concrete provider bridge behind provider-neutral media interfaces.
- Captured WebSocket message, TwiML, media frame, DTMF, mark, clear, and stop behavior in the PSTN standard.
- Moved Linear ZAR-90 and the local issue status to In Progress for the implementation pass.
- Added `twilio-media-streams.bridge.ts` with Twilio message normalization, provider-neutral `PstnAudioFrame` projection, outbound `media`/`mark`/`clear` builders, unsupported codec and malformed media guards, replay detection, and post-stop rejection.
- Added verified Twilio webhook TwiML responses: routed calls receive `<Connect><Stream>` and duplicates/blocked calls receive safe reject TwiML.
- Added `twilio-media-streams.websocket-bridge.ts` as a Nest-owned WebSocket bridge that authorizes against server-created execution sessions, rejects duplicate stream attachment, ignores forged custom parameters as authority, records DTMF through call-control state, exposes outbound send methods, and closes malformed streams safely.
- Registered the Twilio WebSocket bridge in the telephony module.
- Updated architecture, runtime manifest, telephony, security, testing, roadmap, and backlog docs to reflect the implemented bridge baseline.
- Synced Linear ZAR-90 to Done after full verification.
- Removed stale unused frontend/runtime lint leftovers uncovered during verification so the repository lint gate passes.
- Follow-up on 2026-07-08: replaced hardcoded production Twilio callback/media assumptions with public URL resolution. Webhook signature verification and connection metadata now use `ZARA_TWILIO_WEBHOOK_URL`, or `API_PUBLIC_URL` plus `/telephony/webhooks/twilio`, before falling back to the local dev URL. TwiML media stream URLs now use `ZARA_TWILIO_MEDIA_STREAM_BASE_URL`, or `API_PUBLIC_URL` converted to `wss://` plus `/telephony/twilio/media-streams`.

## Tests Run

- `npm.cmd run test:run -- apps/api/src/telephony/twilio-media-streams.bridge.test.ts --pool=forks` (passed)
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts apps/api/src/telephony/telephony.persistence.test.ts apps/api/src/telephony/twilio-media-streams.bridge.test.ts --pool=forks` (passed)
- `npm.cmd run test:run -- apps/api/src/telephony/twilio-media-streams.websocket.test.ts --pool=forks` (passed)
- `npm.cmd run test:run -- apps/api/src/telephony/twilio-media-streams.bridge.test.ts apps/api/src/telephony/twilio-media-streams.websocket.test.ts --pool=forks` (passed)
- `npm.cmd run test:run -- apps/api/src/telephony/telephony.controller.test.ts apps/api/src/telephony/telephony.persistence.test.ts apps/api/src/telephony/postgres-telephony-state.repository.test.ts apps/api/src/telephony/twilio-media-streams.bridge.test.ts apps/api/src/telephony/twilio-media-streams.websocket.test.ts packages/core/src/telephony.test.ts packages/core/src/live-call-session.test.ts packages/core/src/pstn-sandwich-runtime.test.ts --pool=forks` (passed)
- `npm.cmd run typecheck` (passed)
- `npm.cmd run test:run -- --pool=forks` (passed: 73 files, 395 tests)
- `npm.cmd run lint` (passed)
- `npm.cmd run typecheck` after lint cleanup (passed)
- `npm.cmd run test:run -- --pool=forks` after lint cleanup (passed: 73 files, 395 tests)
- `git diff --check` (passed; line-ending warnings only)
- Core boundary scan for Twilio/Media Streams strings in provider-neutral runtime files (passed: no matches)
- Follow-up on 2026-07-08: `npm.cmd run test:run -- --pool=threads --testTimeout=30000 apps/api/src/telephony/telephony.controller.test.ts`
- Follow-up on 2026-07-08: `npm.cmd run test:run -- --pool=threads --testTimeout=30000 apps/api/src/telephony/twilio-number-routing.provider.test.ts apps/api/src/telephony/twilio-number-inventory.provider.test.ts`
- Follow-up on 2026-07-08: `npm.cmd run typecheck --workspace @zara/api`

## Pending Work

- None for ISSUE-144 / ZAR-90.

## Risks

- Twilio `<Stream>` authorization still depends on the existing one-time token bridge contract; any future token transport change should be handled as a separate bridge contract pass.

## Decisions

- Twilio webhook signature verification happens before route resolution and bridge TwiML.
- Twilio media payloads are base64 G.711 mu-law 8 kHz frames.
- Twilio Media Streams WebSocket authority comes from the server-created execution session, not Twilio custom parameters.
- Raw media payloads are kept out of persisted telephony state and tenant/browser-visible responses.
- Deployed Twilio webhook/media URLs derive from API public config; local defaults remain only for local development and tests.

## Next Recommended Step

- Commit ZAR-90 and move to ISSUE-145 / ZAR-91.
