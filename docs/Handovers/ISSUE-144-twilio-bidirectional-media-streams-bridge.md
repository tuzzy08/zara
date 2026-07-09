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
- Follow-up on 2026-07-08: aligned the Twilio Media Streams token transport with Twilio's `<Stream>` contract. Generated TwiML now keeps `<Stream url>` queryless, sends the opaque one-time `zaraStreamToken` as a nested `<Parameter>`, validates that token from Twilio `start.customParameters`, and serializes per-socket WebSocket message handling so back-to-back `start` and `media` frames are processed in provider order.
- Follow-up on 2026-07-09: hardened imported-number route configuration by clearing Twilio Voice Application/SIP Trunk overrides while setting the number-level Voice URL, then rejecting route save if Twilio still reports an attached override that would make incoming calls ignore Zara's webhook.
- Follow-up on 2026-07-09: added redacted `[twilio-pstn]` API diagnostics across imported-number route configuration, Twilio voice webhook receipt/signature/route/TwiML decisions, one-time media token minting/authorization, and Media Streams WebSocket start/first-frame/stop/error lifecycle so the next real PSTN attempt can be traced from Coolify/API logs without leaking auth tokens, stream tokens, full caller numbers, or raw media.

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
- Follow-up on 2026-07-08: `npm.cmd run test:run -- --pool=threads --testTimeout=30000 apps/api/src/telephony/twilio-media-streams.bridge.test.ts apps/api/src/telephony/twilio-media-streams.websocket.test.ts apps/api/src/telephony/telephony.controller.test.ts`
- Follow-up on 2026-07-09: RED `npm.cmd run test:run -- --pool=forks --testTimeout=30000 apps/api/src/telephony/twilio-number-routing.provider.test.ts` failed before route configuration cleared/checked Twilio app/trunk overrides.
- Follow-up on 2026-07-09: GREEN `npm.cmd run test:run -- --pool=threads --testTimeout=30000 apps/api/src/telephony/twilio-number-routing.provider.test.ts`
- Follow-up on 2026-07-09: GREEN `npm.cmd run test:run -- --pool=threads --testTimeout=30000 apps/api/src/telephony/telephony.controller.test.ts`
- Follow-up on 2026-07-09: GREEN `npm.cmd run typecheck --workspace @zara/api`
- Follow-up on 2026-07-09: RED `npm.cmd run test:run -- --pool=threads --testTimeout=30000 apps/api/src/telephony/telephony.controller.test.ts -t "logs Twilio PSTN route"` failed before route/webhook diagnostics were emitted.
- Follow-up on 2026-07-09: RED `npm.cmd run test:run -- --pool=threads --testTimeout=30000 apps/api/src/telephony/twilio-media-streams.websocket.test.ts -t "bridges verified Twilio media"` failed before Media Streams WebSocket diagnostics were emitted.
- Follow-up on 2026-07-09: GREEN `npm.cmd run test:run -- --pool=threads --testTimeout=30000 apps/api/src/telephony/telephony.controller.test.ts -t "logs Twilio PSTN route"`
- Follow-up on 2026-07-09: GREEN `npm.cmd run test:run -- --pool=threads --testTimeout=30000 apps/api/src/telephony/twilio-media-streams.websocket.test.ts -t "bridges verified Twilio media"`
- Follow-up on 2026-07-09: GREEN `npm.cmd run test:run -- --pool=threads --testTimeout=30000 apps/api/src/telephony/telephony.controller.test.ts apps/api/src/telephony/twilio-media-streams.websocket.test.ts apps/api/src/telephony/twilio-number-routing.provider.test.ts`
- Follow-up on 2026-07-09: GREEN `npm.cmd run test:run -- --pool=threads --testTimeout=30000 apps/web/src/app.test.tsx`
- Follow-up on 2026-07-09: GREEN `npm.cmd run typecheck --workspace @zara/api`
- Follow-up on 2026-07-09: GREEN `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-07-09: GREEN `npx.cmd eslint apps/api/src/telephony/telephony.service.ts apps/api/src/telephony/twilio-media-streams.websocket-bridge.ts apps/api/src/telephony/twilio-pstn-diagnostics.ts apps/api/src/telephony/telephony.controller.test.ts apps/api/src/telephony/twilio-media-streams.websocket.test.ts apps/api/src/telephony/twilio-number-routing.provider.ts apps/api/src/telephony/twilio-number-routing.provider.test.ts apps/web/src/TelephonyScreen.tsx apps/web/src/SandboxScreen.tsx apps/web/src/app.test.tsx`
- Follow-up on 2026-07-09: GREEN `git diff --check` (passed with line-ending warnings only)

## Pending Work

- None for ISSUE-144 / ZAR-90.

## Risks

- Token length must remain under Twilio's custom parameter name/value limit. Current one-time stream tokens are short HMAC payloads and covered by the focused TwiML tests.
- Twilio route configuration now attempts to clear number-level Voice Application/SIP Trunk overrides with empty update fields. If a provider account refuses to detach those overrides, route save fails instead of falsely showing a route that would not receive incoming calls.
- The new diagnostics are intentionally standard Nest logs rather than a tenant-visible event stream. Operators must collect them from the API service logs and filter by `[twilio-pstn]` until a dedicated tenant-safe call trace UI is built.

## Decisions

- Twilio webhook signature verification happens before route resolution and bridge TwiML.
- Twilio media payloads are base64 G.711 mu-law 8 kHz frames.
- Twilio Media Streams WebSocket authority comes from the server-created execution session plus one successful `zaraStreamToken` verification from `start.customParameters`; other Twilio custom parameters are not authority.
- Raw media payloads are kept out of persisted telephony state and tenant/browser-visible responses.
- Deployed Twilio webhook/media URLs derive from API public config; local defaults remain only for local development and tests.
- Twilio `<Stream url>` must stay queryless because Twilio does not support query parameters on that attribute.
- Imported BYO Twilio number routing should take over the number's direct Voice URL path, and should not silently coexist with a TwiML App or SIP Trunk that would supersede it.
- Twilio PSTN diagnostics may include account SID, call SID, stream SID, route IDs, runtime path, and Voice URL, but must redact auth/signature/token fields, mask caller/called numbers, and never print raw media payloads.

## Next Recommended Step

- Run a real Twilio inbound smoke call against the configured public API URL after saving the route again, then collect API logs filtered by `[twilio-pstn]` and confirm the trace reaches `webhook_received`, `twiml_rendered`, `media_start_authorized`, and `media_first_frame`.
