# ISSUE-113: Published manifest live execution on sandbox

Issue link: https://github.com/tuzzy08/zara/issues/113

## Goal

Run published workflows through the same live audio sandbox pipeline on `/sandbox`.

## Acceptance Criteria

- `/sandbox` starts the same live audio pipeline for published workflow versions
- Workspace-safe published workflow selection gates session start
- Cost-optimized, balanced, and premium runtime profiles all start through the live session transport

## Work Completed

- Replaced the standalone `/sandbox` screen's local adapter flow with the shared live sandbox session hook.
- Wired published workflow selection to compile the chosen published manifest and start a live session through `POST /organizations/:orgId/sandbox/live-sessions`.
- Added live transcript rendering, runtime event rendering, streamed audio playback, typed caller turns, and microphone-driven voice turns to the standalone sandbox.
- Updated docs so `/sandbox` is described as the published-manifest live execution surface rather than a local simulation surface.
- Added published-session reconnect on browser refresh using persisted live sandbox session metadata plus fresh reconnect tokens.
- Added workspace-scoped active sandbox monitor cards and replay inspection directly on `/sandbox`.
- Added redacted replay transcript rendering so operator inspection hides email, phone, and secret-reference content.
- Added a live voice provider readiness gate so voice sandbox sessions fail before microphone capture when required provider credentials are missing.
- Moved browser microphone preparation until after the API accepts the live voice session, and added a visible recording meter only for successfully active voice capture.
- Added agent playback feedback for streamed TTS audio on `/sandbox` and the workflow sandbox drawer.
- Made the published sandbox end-call button use the destructive red treatment while a call is active.
- Routed missing provider credential failures through the existing toast surfaces, including the workflow sandbox drawer, without showing a false "started" toast.
- Split live sandbox error notifications from the transport panel status so repeated missing-key failures show as toasts every time and provider credential text no longer appears in the panel.
- Changed the live voice provider readiness gate so cost-optimized and balanced sandbox sessions require only speech providers at startup: AssemblyAI STT and Cartesia TTS. OpenAI is no longer startup-blocking for those profiles and remains reserved for the premium realtime path.
- Reworked voice sandbox capture into a continuous call-style stream: starting a voice sandbox now starts microphone capture immediately, streams PCM chunks over the Nest transport, and lets AssemblyAI `Turn.end_of_turn` trigger workflow execution without a manual "send voice turn" step.
- Updated the AssemblyAI streaming adapter to use the v3 U3 Pro query shape from the implementation guide (`speech_model=u3-rt-pro`, binary PCM16 frames, turn silence tuning) instead of the previous buffered-turn query parameters.
- Added provider diagnostics for STT failures so AssemblyAI close-code errors are emitted as replayable `provider.diagnostic` and `call.failed` events and also written through the Nest logger.
- Added Cartesia playback timestamp fanout to the shared live transport so published sandbox agent turns can animate playback with provider timing metadata.
- Follow-up pass on 2026-05-25 primed shared browser audio playback from the start gesture and mapped model-stage `quality.flagged` events to explicit text-model diagnostics, so fallback replies are no longer silent or unexplained in sandbox timelines.

## Tests Run

- `npm.cmd run test:run -- apps/web/src/app.test.tsx`
- `npm.cmd run test:run -- apps/web/src/liveSandboxAudio.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx --pool=threads`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build --workspace @zara/web`
- RED/GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts -t "provider credentials|creates a workspace"`
- RED/GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "voice capture indicator|provider setup error"`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/liveSandboxTransport.test.ts`
- RED/GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "agent playback|end call button|provider setup error"`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/liveSandboxTransport.test.ts`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run typecheck --workspace @zara/api`
- HISTORICAL, later resolved: `npm.cmd run typecheck --workspace @zara/web` previously failed in `apps/web/src/TelephonyScreen.tsx` because `callback.scheduled` was not included in the local event-type union.
- RED/GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/assemblyai-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/assemblyai-stt.provider.test.ts`
- RED/GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "automatically|provider failures"`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/assemblyai-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/assemblyai-stt.provider.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts`
- HISTORICAL, later resolved: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "continuous voice capture" --pool=threads` previously hit a Vitest worker startup timeout before importing tests.
- HISTORICAL, later resolved: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "continuous voice capture" --pool=forks` previously hit a Vitest worker startup timeout before importing tests.
- GREEN: `npm.cmd run typecheck --workspace @zara/web`
- GREEN: `npm.cmd run typecheck --workspace @zara/api`
- GREEN: `npm.cmd run typecheck`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run build --workspace @zara/web`
- GREEN: `npm.cmd run test:run -- apps/web/src/liveSandboxAudio.test.ts`
- HISTORICAL: browser smoke loaded `/sandbox` on `http://127.0.0.1:4173`; automated transport and session tests now cover the start path without relying on that desktop API auth state.
- RED/GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts -t "provider credentials|speech providers"`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- HISTORICAL, later resolved: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "provider setup error"` hit a Vitest fork-worker startup timeout before loading tests.
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "provider setup error" --pool=threads`
- GREEN: `npm.cmd run typecheck --workspace @zara/api`
- GREEN: `npm.cmd run typecheck --workspace @zara/web`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run typecheck`
- RED/GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "provider setup error"`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/liveSandboxTransport.test.ts`
- GREEN: `npm.cmd run lint`
- GREEN: `npm.cmd run typecheck --workspace @zara/api`
- HISTORICAL, later resolved: `npm.cmd run typecheck --workspace @zara/web` previously failed in `apps/web/src/TelephonyScreen.tsx` because `callback.scheduled` was not included in the local event-type union.
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "continuous voice capture|provider setup error|agent playback|end call button" --pool=threads`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/liveSandboxTransport.test.ts --pool=threads`
- GREEN: `npm.cmd run typecheck --workspace @zara/web`
- GREEN: `npm.cmd run build`
- RED: `npm.cmd run test:run -- apps/web/src/liveSandboxAudio.test.ts apps/web/src/liveSandboxEventFormatting.test.ts --pool=threads` failed before the shared audio player exposed gesture-time priming and model-stage quality events had sandbox-facing labels.
- GREEN: `npm.cmd run test:run -- apps/web/src/liveSandboxAudio.test.ts apps/web/src/liveSandboxEventFormatting.test.ts --pool=threads`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/WorkflowBuilder.test.tsx apps/web/src/liveSandboxAudio.test.ts apps/web/src/liveSandboxEventFormatting.test.ts --pool=threads`
- GREEN: `npm.cmd run typecheck --workspace @zara/web`

## Pending Work

- No remaining ISSUE-113 blockers.

## Risks And Edge Cases

- Published version is archived after selection but before session start
- Active workspace changes during session bootstrap
- Browser refresh occurs during a live sandbox run
- Missing provider credentials should block voice capture before the browser requests microphone access.
- Missing provider credential text should be toast-only; the transport panel should keep generic status copy so repeated attempts do not look like panel-only failures.
- Playback animation is tied to `turn.audio.chunk`; unusually long or sparse audio streams may need a future provider-level playback-ended signal for exact end timing.
- Non-premium sandbox sessions can start without OpenAI credentials when AssemblyAI and Cartesia are configured; if the text model is unavailable during a turn, the sandwich runtime falls back to a safe spoken response instead of blocking microphone capture.
- A missing or failing text model still causes the safe fallback response; the UI now calls this out as a text-model diagnostic instead of showing an opaque runtime event.
- AssemblyAI close code `3006` means invalid message type or invalid JSON. The previous buffered-send model could make diagnosis hard because the only user-visible symptom was a toast; provider failures now stay in the session replay.
- AssemblyAI close code `3007` remains a risk if browser audio chunks fall outside the documented 50-1000ms range or are sent faster than real time. The current browser `ScriptProcessorNode` sends live chunks, but a future AudioWorklet should make chunk duration tighter and easier to reason about.

## Decisions

- Priority: P0
- Labels: frontend, runtime, tdd-required
- `/sandbox` and `/workflows` should share the same session engine; they differ only in manifest source.
- Published-mode sandbox remains the place to compare existing releases, but it must use the same live audio transport as draft mode.
- Premium, balanced, and cost-optimized workflows now all enter the browser sandbox through the same live session API contract.
- Published sandbox monitor and reconnect both reuse the same persisted event history instead of rebuilding transcript state separately.
- Voice sandbox recording requires the server-side provider stack to be configured first; the browser should not collect caller audio when the runtime cannot process it.
- Caller recording and agent playback use separate meters so operators can distinguish input capture from outbound audio.
- Missing provider credential errors are toast-worthy because they require operator setup action before a live voice run can begin.
- OpenAI credentials are treated as premium-realtime startup requirements, not cost-optimized or balanced startup requirements.
- Voice sandbox should behave like a normal call: a single start action opens the mic, and provider endpointing drives turns.
- Provider diagnostics belong in the session event log and server logs, not only in transient browser toasts.
- Published sandbox playback timing belongs in the shared transport event stream so `/sandbox` and `/workflows` stay behaviorally aligned.
- Audio playback should be primed while the user is starting a session, then resumed defensively for later streamed chunks.

## Next Recommended Step

Extend the operator story from sandbox-only monitoring into escalation queueing, live call operations, and cross-session analytics.
