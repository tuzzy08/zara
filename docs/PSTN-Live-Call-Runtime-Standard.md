# PSTN Live Call Runtime Standard

Status: Implemented. ISSUE-142 through ISSUE-149 are implemented.
Date: 2026-05-28
External project: [Linear - Zara PSTN Live Call Runtime](https://linear.app/zara-voice/project/zara-pstn-live-call-runtime-ef061c6a0276)
Related issues: ISSUE-142 through ISSUE-149

## Purpose

Zara must support real PSTN calls from Twilio and later telephony providers while preserving the runtime standards already established for turn packets, intent routing, tools, transfers, policies, observability, and evals.

The PSTN path is not just the browser live sandbox with a Twilio adapter attached. PSTN audio has different codec, latency, interruption, security, and operational constraints. The standard is therefore:

- a provider-neutral live call session core (implemented in ISSUE-142)
- a dedicated `pstn-sandwich` runtime path optimized for G.711 mu-law 8 kHz media
- a first Twilio bridge implemented behind provider-neutral interfaces
- one unified sandbox concept with explicit Draft browser, Published browser, and Phone test modes
- manual live activation only after a successful protected phone test or an audited override
- premium realtime over PSTN as a clearly labeled provider path, separate from PSTN sandwich v1

Provider docs referenced by this standard:

- [Twilio Media Streams overview](https://www.twilio.com/docs/voice/media-streams)
- [Twilio Media Streams WebSocket messages](https://www.twilio.com/docs/voice/media-streams/websocket-messages)
- [Twilio malformed Media Streams message guidance](https://www.twilio.com/docs/api/errors/31950)
- [Cartesia TTS parameter guide](https://docs.cartesia.ai/build-with-cartesia/capability-guides/choosing-tts-parameters)
- [AssemblyAI Streaming API reference](https://www.assemblyai.com/docs/api-reference/streaming)

Implementation issues must re-check provider docs during coding because provider limits and supported codecs can change.

## Product Rule

1. PSTN calls run only against immutable published workflow versions.
2. Draft workflows can use browser sandbox only.
3. A phone number has separate `testRoute` and `liveRoute` state.
4. `test_route` is protected, temporary, and requires at least one allowed caller number in v1.
5. `test_route` uses an explicit waiting session with expiry. It is not always-on test answering.
6. `live_route` is manually activated from a successful PSTN test result for the same number, published version, and runtime profile.
7. Routes stay pinned to exact published versions. They do not auto-follow latest.
8. One sandbox system exists, with explicit modes:
   - Published test: browser
   - Phone test: Twilio/PSTN
9. `/calls` owns setup, number state, and activation. `/workflows` and `/sandbox` can initiate or deep-link tests.
10. PSTN v1 supports cost-optimized and balanced sandwich profiles through `pstn-sandwich`.
11. Premium realtime over PSTN uses `pstn-premium-realtime` only when explicit provider capability, tenant entitlement, budget, and fallback-policy call-start gates pass.
12. Subscription loss preserves setup, routes, credentials, numbers, and history, but blocks new answering.

## Runtime Paths

| Runtime path | Transport | Audio path | Allowed in PSTN v1 | Notes |
| --- | --- | --- | --- | --- |
| `browser-sandwich` | Zara browser transport | browser audio to STT, text model, TTS to browser | No | Existing draft/published browser sandbox path. |
| `pstn-sandwich` | provider media bridge | G.711 mu-law 8 kHz into telephony STT/TTS path | Yes | First real PSTN path. Optimized for latency and call quality. |
| `pstn-premium-realtime` | provider media bridge to premium realtime provider | provider-native realtime audio | Yes, gated | Separate ISSUE-149 path with provider-native interruption semantics and no silent sandwich downgrade. |

The PSTN sandwich path shares:

- workflow graph and immutable manifest semantics
- Turn Runtime Packet v1
- intent routing
- discretionary agent toolbelts
- structured transfer context
- policy guards
- OpenTelemetry/LangSmith redacted trace projection
- tenant/workspace/call isolation

It does not share browser-only assumptions about WebRTC, browser microphone state, or browser playback state.

The premium realtime PSTN path shares the same manifest pinning, route resolution, Turn Runtime Packet facts, policy guards, and redacted observability contracts. It does not share the sandwich STT/text-model/TTS loop; provider-native realtime audio produces provider/model events, outbound PSTN frames, and normalized interruption events at the runtime boundary.

## Primary Inputs

The PSTN live call runtime receives these inputs before a call can answer:

- tenant organization ID
- workspace ID
- telephony connection ID
- phone number ID
- provider ownership mode
- provider account identity, such as Twilio account SID
- incoming call identity, such as provider call SID
- caller number and called number
- route mode: `test_route` or `live_route`
- exact published workflow version ID
- compiled runtime manifest ID
- runtime profile and runtime path
- premium realtime call-start policy, when the selected profile is premium realtime
- recording consent policy
- subscription and budget posture
- tenant abuse/security posture
- allowed caller list for test sessions
- active test waiting session, when present

Once the media stream connects, the runtime also receives:

- provider stream ID
- codec metadata
- inbound audio frames
- media sequence numbers and timestamps
- DTMF events
- provider marks
- stream stop/close events
- provider diagnostics

The active turn receives:

- current Turn Runtime Packet
- transcript windows from STT
- current route frontier
- active agent role
- agent toolbelt capability list
- recent safe tool results
- structured transfer context, when routed
- untrusted prompt lane content
- policy state and warnings

## Primary Outputs

Before media connection:

- safe TwiML or equivalent provider response
- blocked-dispatch record when policy prevents answering
- route-resolution events
- audit records for unsafe or blocked states

During the call:

- live call lifecycle events
- Turn Runtime Packet facts
- redacted transcript events
- model/provider routing events
- tool call/result events
- transfer events
- policy warning events
- outbound G.711 mu-law 8 kHz media frames
- provider marks and clear commands
- cost and usage events
- OpenTelemetry spans
- optional redacted LangSmith traces

After the call:

- call ended/failed result
- PSTN sandbox test result, when this was a phone test
- usage and billing events
- safe post-call summary inputs
- provider diagnostics
- replayable redacted event history

## Provider-Neutral Session Core

The live call session core is the owner of call lifecycle, manifest pinning, packet state, runtime routing, and policy execution. Provider bridges adapt external telephony protocols into this core.

ISSUE-142 implements the first core baseline in `packages/core/src/live-call-session.ts`: provider-neutral browser/PSTN sources, manifest-pinned snapshots, ordered lifecycle events, packet-backed turn creation, in-memory coordinator rehydration, lifecycle transition guards, and tenant/workspace/number/version/profile scope validation. It deliberately does not import Twilio or browser sandbox session models.

ISSUE-143 implements the provider-neutral `pstn-sandwich` media baseline in `packages/core/src/pstn-sandwich-runtime.ts`: synthetic G.711 mu-law 8 kHz inbound frames are normalized into telephony STT input, packet-backed caller turns, model-routed text responses, Cartesia-ready mu-law 8 kHz TTS requests, outbound mu-law frames, latency classifications, safe no-frame closeout, PSTN-ready TTS fallback, and Zara-owned barge-in/clear events. The API provider adapters now accept AssemblyAI `pcm_mulaw` 8 kHz streaming metadata and Cartesia raw `pcm_mulaw` 8 kHz generation requests while preserving browser defaults.

ISSUE-144 implements the first concrete Twilio bridge in `apps/api/src/telephony/twilio-media-streams.bridge.ts` and `apps/api/src/telephony/twilio-media-streams.websocket-bridge.ts`. Verified inbound Twilio webhooks return TwiML with `<Connect><Stream>` only after signature verification, dedupe, and routed-dispatch resolution. The Twilio `<Stream url>` is queryless; Zara carries the opaque one-time media auth token as `zaraStreamToken` in nested `<Parameter>` TwiML so Twilio sends it in `start.customParameters`. The media WebSocket validates that token once against the server-created execution session before accepting media, serializes provider messages in arrival order, normalizes `connected`, `start`, `media`, `dtmf`, `mark`, and `stop` messages into API-local provider bridge events, converts inbound media into provider-neutral `PstnAudioFrame` values, and exposes outbound `media`, `mark`, and `clear` sends for the runtime. Raw media payloads and forged custom parameters are not persisted to tenant state.

ISSUE-145 implements protected phone-test route state in `@zara/core` and the Nest telephony module. Phone numbers now persist `liveRoute`, `testRoute`, and `phoneTestResults` records instead of legacy flat workflow route fields. Creating a `testRoute` requires an exact published workflow version ID, a supported runtime profile, at least one allowed caller, and a future expiry. Inbound dispatch prefers a matching unexpired `testRoute`, records `test_route` mode and test session IDs, otherwise falls back to `liveRoute` or safe rejection. Webhook dispatch, media socket lifecycle, inbound frames, outbound audio, and runtime checkpoint calls update the phone-test checklist; passed, failed, expired, unauthorized-caller, and manually-ended results are stored without raw audio, provider payloads, or secrets.

ISSUE-146 implements the unified sandbox Phone test experience. `/sandbox` exposes Published test (browser) and Phone test (Twilio/PSTN) modes; Phone test starts protected waiting sessions, accepts allowed caller and expiry input, shows session/checklist/result state, and manually completes waiting tests through the sanitized completion API. `/calls` shows standardized number states and launches Phone test for routed numbers. `/workflows` no longer runs its own routed-number dispatch simulation or draft sandbox runtime; it exposes Published test (browser) and Phone test (Twilio/PSTN) labels and deep-links to the shared `/sandbox` Phone test surface for the exact routed number and published version.

ISSUE-149 implements the first premium realtime PSTN provider slice in `packages/core/src/pstn-premium-realtime-runtime.ts` and the Nest telephony resolver. A premium PSTN route resolves to `pstn-premium-realtime` only after provider capability, provider availability, tenant entitlement, budget posture, and explicit fallback policy checks pass. The runtime calls the approved provider path through a provider-neutral `runPstnTurn` contract, emits provider/model and outbound audio events, writes Turn Runtime Packet facts, normalizes native interruption into `pstn.barge_in.detected` and `pstn.audio.clear_requested`, and safe-closes on provider failure without silently downgrading to sandwich.

Core runtime modules must not import Twilio-specific types. Twilio belongs behind interfaces like:

```ts
type PstnAudioCodec = {
  name: "g711_mulaw";
  sampleRateHz: 8000;
  channels: 1;
};

type PstnAudioFrame = {
  callSessionId: string;
  mediaStreamId: string;
  direction: "inbound" | "outbound";
  codec: PstnAudioCodec;
  sequence: number;
  timestampMs: number;
  payloadBase64: string;
};

type TelephonyProviderBridge = {
  provider: "twilio" | "future_provider";
  answerInboundCall(input: TelephonyAnswerInput): Promise<TelephonyAnswerResult>;
  connectMediaStream(input: TelephonyMediaConnectInput): Promise<TelephonyMediaStream>;
  sendAudio(frame: PstnAudioFrame): Promise<void>;
  sendMark(mark: TelephonyMediaMark): Promise<void>;
  clearBufferedAudio(input: TelephonyClearAudioInput): Promise<void>;
  endCall(input: TelephonyEndCallInput): Promise<void>;
};
```

The v1 coordinator can be in-process for local implementation, but it must sit behind a durable realtime session coordinator interface so production can move to Cloudflare Durable Objects, Redis, or another session coordinator without changing runtime semantics.

## Twilio Bridge Contract

Twilio is the first concrete bridge. It uses Programmable Voice bidirectional Media Streams.

Twilio-specific rules:

- answer eligible inbound calls with TwiML that opens `<Connect><Stream>`
- verify Twilio signatures before resolving routes or returning bridge TwiML
- treat webhook event IDs as idempotent
- accept Twilio `connected`, `start`, `media`, `mark`, `dtmf`, and `stop` messages
- send outbound `media`, `mark`, and `clear` messages to Twilio
- carry Twilio call SID and stream SID only as provider metadata, not as core runtime types
- reject malformed messages with structured provider errors and safe call closure
- never expose Twilio credentials, WebSocket auth secrets, or raw media payloads to browser clients or model prompts

The implemented v1 media socket is bound to a verified, server-created Twilio execution session. Twilio `customParameters` carry the opaque `zaraStreamToken` transport credential because Twilio does not support query strings on `<Stream url>`, but they cannot select tenant, route, or call session authority.

Twilio media payloads must be base64 G.711 mu-law 8 kHz audio when sent to or received from the PSTN media stream.

Twilio stream custom parameters may carry runtime metadata such as `zaraRuntimePath` for observability and debugging. Apart from the server-minted one-time `zaraStreamToken` being verified against existing session state, custom parameters are never authority for tenant, route, number, or call-session selection.

## PSTN Sandwich Turn Loop

The `pstn-sandwich` turn loop is:

1. Receive inbound mu-law media frames from the provider bridge.
2. Buffer and normalize frames with sequence/timestamp checks.
3. Run PSTN-safe VAD/end-of-turn detection.
4. Stream audio into telephony-configured STT.
5. Write transcript input into the Turn Runtime Packet.
6. Route through the compiled workflow using intent/tool/transfer/policy standards.
7. Generate an agent response through the selected text model for cost-optimized or balanced profile.
8. Stream response text to PSTN-ready TTS.
9. Send outbound mu-law media frames to the provider bridge as soon as audio is available.
10. Send provider marks for playback correlation.
11. Handle caller interruption by canceling non-side-effect work, clearing buffered audio, and writing packet warnings/events.

The agent may use zero, one, or multiple assigned tools at its discretion within tool-call limits. PSTN routing does not force every assigned tool to run.

## Premium Realtime PSTN Turn Loop

The `pstn-premium-realtime` turn loop is:

1. Receive inbound PSTN media frames from the provider bridge.
2. Resolve the premium call-start gate for provider capability, provider availability, tenant entitlement, budget posture, and fallback policy.
3. Stream the turn through the approved premium realtime provider path.
4. Write provider/model facts into the Turn Runtime Packet and runtime events.
5. Stream provider-native audio output back as normalized PSTN outbound frames.
6. Normalize provider-native interruption semantics into Zara runtime events.
7. On provider failure, emit structured quality and failure events, then block or close according to explicit policy instead of silently downgrading to sandwich.

## Audio And Latency Policy

PSTN audio defaults:

- codec: G.711 mu-law
- sample rate: 8000 Hz
- channels: 1
- inbound/outbound payloads: base64 encoded media frames
- TTS target: Cartesia `pcm_mulaw` at 8000 Hz when available
- STT target: telephony-aware streaming configuration with explicit sample rate

Latency and failure thresholds:

- first response target: under 1.5 seconds after end-of-turn
- model timeout: 8 seconds
- STT reconnect grace: 2 seconds
- TTS first-byte timeout: 2 seconds
- provider media no-frame timeout: 5 seconds
- hard runtime provider failure: one safe apology, then end unless human fallback exists

These thresholds produce events and observability classifications. They are not silent best-effort guidelines.

## Interruption Semantics

PSTN sandwich v1 uses Zara-owned barge-in:

- inbound caller speech during agent playback can interrupt non-side-effect response audio
- runtime cancels outstanding model/TTS streams when safe
- bridge sends provider clear command to drop buffered outbound audio
- side-effect tool execution is not undone by interruption
- packet records interruption reason, canceled work, and resumed turn state

Premium realtime over PSTN uses provider-native interruption semantics where available, normalized through Zara events such as `pstn.barge_in.detected` and `pstn.audio.clear_requested`. It must not duplicate or partially fork the PSTN sandwich v1 barge-in logic.

## Route Resolution

Inbound route resolution order:

1. Verify provider webhook authenticity.
2. Resolve tenant connection and number.
3. Check tenant abuse/security status.
4. Check subscription and budget start-call policy.
5. If an active `test_route` waiting session exists:
   - require caller number to match allowed callers
   - require session not expired
   - pin to the route's published workflow version and runtime profile
   - start a phone-test session
6. Otherwise, resolve `live_route`:
   - require active route
   - require subscription and provider health
   - pin to the live route's published workflow version and runtime profile
   - start a production call session
7. If no eligible route exists, return a safe unavailable response and record blocked dispatch.
8. If the resolved route selects `pstn-premium-realtime`, require the premium realtime provider capability, provider availability, tenant entitlement, budget posture, and explicit fallback policy checks before media connects.

Draft manifests never answer PSTN calls.

## Number States

Operators should see these number states:

- `unassigned`: no test or live route
- `test_route`: protected phone test waiting or recently tested
- `ready_to_activate`: successful PSTN test for a version/profile that can be promoted
- `live`: active live route answering eligible callers
- `paused`: route setup preserved but answering blocked by operator, subscription, budget, abuse, provider health, or policy

## Successful Phone Test

A PSTN sandbox test is successful only when all required checkpoints are true:

- verified inbound Twilio webhook
- allowed caller matched
- media WebSocket connected
- inbound caller frame received
- transcript/turn input created
- agent response generated
- outbound audio frame sent to Twilio
- call ended cleanly or user ended intentionally
- no fatal provider/runtime error
- result stored against number ID, published version ID, and runtime profile

The result should also store latency classifications, provider diagnostics, and redacted event references.

## Activation Rule

Live activation is manual and requires an operator confirmation summary:

- number
- provider connection
- workflow name
- exact published workflow version ID
- runtime profile and runtime path
- last successful phone-test result
- recording posture
- subscription and budget posture
- provider health
- known warnings or required overrides

Hard activation blocks:

- no published version
- no routed number
- no recent successful phone test for the same number/version/profile
- inactive subscription
- tenant suspended for abuse/security
- provider health failed
- unsafe recording/consent posture
- missing required credentials
- budget hard block

Authorized overrides must be explicit, audited, and visible to platform admins.

Implemented baseline:

- `liveRoute.activationStatus` is required and is one of `pending_activation`, `active`, or `paused`.
- Saving a route creates a pending live route; it does not answer live calls until activation succeeds.
- Activation records `activatedAt`, `activatedBy`, and the successful phone-test result or override used.
- Pause/resume preserves the route setup, test history, credentials, and activation history.
- `/calls` shows the activation summary and exposes Activate live, Pause, and Resume actions from the number row.

## Subscription And Budget Behavior

Before answer:

- inactive subscription returns safe unavailable TwiML or equivalent provider response
- dispatch is recorded as blocked
- setup, routes, numbers, credentials, and history remain stored

During active calls:

- subscription lapse lets the active call finish within a configured grace window, such as 30 minutes
- budget hard limit triggers safe closeout after the current turn unless emergency/human policy says otherwise
- abuse or security suspension terminates active calls immediately when possible, with a safe caller-facing message

Implemented baseline:

- New inbound calls with inactive subscription, blocked budget, suspended tenant, pending route, or paused route create blocked dispatch records and return unavailable TwiML instead of connecting media.
- Subscription loss during a call moves the execution session to `grace-active`.
- Budget hard block during a call moves the execution session to `closeout-pending`.
- Tenant abuse/security suspension during a call moves the execution session to `terminated`.

## Observability And Evals

PSTN calls emit OpenTelemetry spans and internal metrics for:

- webhook receipt
- route resolution
- answer/TwiML generation
- media WebSocket connect
- first inbound frame
- STT first transcript
- turn packet creation/finalization
- model first token
- TTS first byte
- outbound first audio frame
- provider mark
- barge-in clear
- DTMF
- stop/end reason
- provider/runtime failure

LangSmith remains an internal AI trace and eval workbench. It may receive only redacted AI trace projections. Raw audio, raw transcript, caller number, provider credentials, and raw tool output must not be exported.

Implemented baseline:

- PSTN observability builds OpenTelemetry-ready spans and internal metrics from webhook, route, media, STT, model, TTS, outbound audio, barge-in, call-end, and failure events.
- Redacted LangSmith PSTN projections include IDs, provider/model metadata, policy warnings, and quality metrics while omitting raw audio, raw transcript, caller numbers, secrets, credentials, and untrusted tool output.
- Platform-admin runtime health exposes PSTN first-response latency, no-frame timeout count, STT reconnects, TTS first-byte timeouts, model timeouts, bridge errors, barge-ins, Twilio stop reasons, and successful Phone test rate.
- `npm run eval:pstn` runs deterministic `zara.pstn-media.v1` Twilio media scenarios separately from ordinary tests and non-PSTN runtime evals.
- Premium realtime PSTN traces include `runtimePath: pstn-premium-realtime`, provider/model metadata, provider-native interruption events, first outbound frame latency, provider failure classifications, and the same redaction rules as sandwich PSTN traces.

Synthetic PSTN evals use a Twilio media harness with deterministic scenarios:

- clean successful phone test
- unauthorized caller
- expired test session
- malformed media message
- no inbound frame timeout
- STT reconnect within grace
- model timeout
- TTS first-byte timeout
- caller barge-in
- provider stop before response
- safe closeout after provider failure
- premium realtime provider path with separate runtime path, model/provider metadata, and blocked fallback semantics

## Security And Policy Guards

Required guards:

- Twilio signature verification before route resolution
- provider account/connection tenant isolation
- number tenant/workspace isolation
- one active test waiting session per number in v1
- allowed caller matching for test routes
- published-version pinning
- no draft PSTN answering
- no provider secret exposure to browser or model prompts
- raw media excluded from tenant replay and LangSmith
- untrusted tool output stays in untrusted prompt lane
- direct transfer loop and language mismatch guards remain active
- unsupported model commands are ignored and warned
- provider callback ordering must not corrupt packet sequence
- premium realtime routes require provider capability, tenant entitlement, budget, and explicit fallback-policy gates
- premium realtime provider failure must not silently downgrade to `pstn-sandwich`

## Edge Cases

- Caller calls a test number after the waiting session expired: reject safely or route live only if an eligible live route exists.
- Caller number is blocked or withheld: reject `test_route` in v1 because allowed caller cannot match.
- Same number receives multiple test attempts: one active waiting session; later attempts must reuse, replace, or fail explicitly.
- Provider sends duplicate webhooks: idempotent dispatch result.
- Provider sends media before route session is ready: buffer only within strict limits, otherwise close safely.
- Provider sends malformed media: structured bridge error and safe closure.
- Media WebSocket connects but sends no frames: no-frame timeout after 5 seconds.
- STT reconnects within 2 seconds: preserve call if packet sequence remains safe.
- Model times out: safe apology and retry/escalation policy if configured.
- TTS cannot emit PSTN-ready audio: use tested fallback or safe closeout; do not stream incompatible audio.
- Caller interrupts during response: clear buffered audio and resume turn if safe.
- Caller interrupts during side-effect tool execution: do not undo side effect; explain safe state.
- Subscription lapses mid-call: allow grace completion unless hard budget or suspension applies.
- Abuse/security suspension mid-call: terminate immediately when possible.
- Provider outage during activation: block activation or mark route paused.
- Premium realtime entitlement is missing: block the call start and record the gate reason.
- Premium realtime provider is unavailable: block or close according to explicit policy; do not silently downgrade to sandwich.
- Runtime restart: rehydrate durable session metadata where possible; otherwise close safely and preserve audit.

## Implementation Slices

| Local issue | Linear | Scope |
| --- | --- | --- |
| ISSUE-142 | [ZAR-88](https://linear.app/zara-voice/issue/ZAR-88/issue-142-provider-neutral-live-call-session-core) | Provider-neutral live call session core. Implemented. |
| ISSUE-143 | [ZAR-89](https://linear.app/zara-voice/issue/ZAR-89/issue-143-pstn-sandwich-audio-pipeline-and-synthetic-media-harness) | PSTN sandwich audio pipeline and synthetic media harness. Implemented. |
| ISSUE-144 | [ZAR-90](https://linear.app/zara-voice/issue/ZAR-90/issue-144-twilio-bidirectional-media-streams-bridge) | Twilio bidirectional Media Streams bridge. Implemented. |
| ISSUE-145 | [ZAR-91](https://linear.app/zara-voice/issue/ZAR-91/issue-145-protected-pstn-test-route-lifecycle) | Protected `test_route` lifecycle and successful phone-test record. Implemented. |
| ISSUE-146 | [ZAR-92](https://linear.app/zara-voice/issue/ZAR-92/issue-146-unified-sandbox-phone-test-experience) | Unified sandbox Phone test experience. Implemented. |
| ISSUE-147 | [ZAR-93](https://linear.app/zara-voice/issue/ZAR-93/issue-147-live-route-activation-and-subscription-gates) | Live route activation, subscription gates, and operations behavior. Implemented. |
| ISSUE-148 | [ZAR-94](https://linear.app/zara-voice/issue/ZAR-94/issue-148-pstn-observability-latency-evals-and-production-gates) | PSTN observability, latency evals, and production gates. Implemented. |
| ISSUE-149 | [ZAR-95](https://linear.app/zara-voice/issue/ZAR-95/issue-149-premium-realtime-over-pstn-provider-slice) | Premium realtime over PSTN provider slice. Implemented. |
