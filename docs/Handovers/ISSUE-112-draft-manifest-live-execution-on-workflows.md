# ISSUE-112: Draft manifest live execution on workflows

External: [GitHub #112](https://github.com/tuzzy08/zara/issues/112)

Issue link: https://github.com/tuzzy08/zara/issues/112

## Goal

Run the current unpublished workflow draft as a live audio sandbox session directly from `/workflows`.

## Acceptance Criteria

- `/workflows` can compile the current validated draft into an ephemeral manifest without publishing
- Voice mode requests microphone access and starts a live sandbox run in the builder drawer
- Runtime events, transcript, and node-by-node progress reflect the real live execution path

## Work Completed

- Compiled validated draft graphs into ephemeral runtime manifests through `apps/web/src/sandboxRuntimeManifest.ts`.
- Replaced the builder drawer's local replay session with the shared live sandbox session hook in `apps/web/src/useLiveSandboxSession.ts`.
- Wired `/workflows` draft mode to create live sandbox sessions, open the websocket transport, render transcript plus runtime events, and request microphone access for voice mode.
- Routed-number mode now verifies telephony posture first, then starts the same live sandbox session against the published manifest for the selected routed number.
- Updated product and frontend docs so the builder drawer is documented as a live execution surface.
- Reworked the builder drawer voice path into a natural call-style session: once provider readiness succeeds, microphone capture starts immediately and live PCM chunks stream until AssemblyAI endpointing finalizes the caller turn.
- Added agent playback animation support in the drawer so streamed TTS chunks are visibly distinct from caller recording activity.
- Kept missing provider credential failures toast-only and blocked microphone capture before the drawer enters recording state.
- Follow-up pass on 2026-05-25 added the active End call affordance to the workflow sandbox drawer, tightened the drawer action/metric layout, surfaced validation status in the builder toolbar, primed browser audio playback from the start gesture, and made model-stage quality failures readable in the transcript event stream.
- Follow-up pass on 2026-06-11 fixed a live voice sandbox dead-air edge case by retiring a streaming STT session after provider endpointing so the next caller utterance creates a fresh stream and completes normally.
- Follow-up pass on 2026-06-11 made post-transcription runtime failures visible as system transcript entries and cleared voice capture/playback state so operators see why a sandbox call did not answer.

## Tests Run

- `npm.cmd run test:run -- apps/web/src/app.test.tsx`
- `npm.cmd run test:run -- apps/web/src/liveSandboxAudio.test.ts`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build --workspace @zara/web`
- GREEN: `npm.cmd run test:run -- apps/web/src/liveSandboxAudio.test.ts`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "continuous voice capture|provider setup error|agent playback|end call button" --pool=threads`
- GREEN: `npm.cmd run build`
- RED: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "workflow sandbox drawer|end call" --pool=threads` failed before the drawer rendered an End call button for active workflow sandbox sessions.
- RED: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "validation status" --pool=threads` failed before validation status was visible outside the inspector.
- RED: `npm.cmd run test:run -- apps/web/src/liveSandboxAudio.test.ts apps/web/src/liveSandboxEventFormatting.test.ts --pool=threads` failed before playback priming existed and model-stage quality events rendered as actionable text-model diagnostics.
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "workflow sandbox drawer|end call" --pool=threads`
- GREEN: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx -t "validation status" --pool=threads`
- GREEN: `npm.cmd run test:run -- apps/web/src/liveSandboxAudio.test.ts apps/web/src/liveSandboxEventFormatting.test.ts --pool=threads`
- GREEN: `npm.cmd run test:run -- apps/web/src/app.test.tsx apps/web/src/WorkflowBuilder.test.tsx apps/web/src/liveSandboxAudio.test.ts apps/web/src/liveSandboxEventFormatting.test.ts --pool=threads`
- GREEN: `npm.cmd run typecheck --workspace @zara/web`
- RED: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "starts a fresh streaming STT session"` failed before the server retired the ended streaming STT session after endpointing.
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "starts a fresh streaming STT session"`
- GREEN: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts`
- GREEN: `npm.cmd run test:run -- apps/web/src/useLiveSandboxSession.test.tsx -t "shows runtime failures"`
- GREEN: `npm.cmd run test:run -- apps/web/src/useLiveSandboxSession.test.tsx`
- GREEN: `npm.cmd run typecheck --workspace @zara/api`
- GREEN: `npm.cmd run typecheck --workspace @zara/web`
- GREEN: `npm.cmd run lint`

## Pending Work

- No remaining ISSUE-112 blockers.

## Risks And Edge Cases

- Graph changes while a draft sandbox run is active
- Draft becomes invalid before transport bootstrap completes
- Microphone permission is denied
- Provider setup errors must remain toast-only and must not appear in the transport panel or put the drawer into a false recording state.
- Playback animation follows streamed audio chunks; exact phrase-level timing is supplied separately by `turn.audio.timestamps`.
- Browsers can still reject autoplay outside a user gesture, so the shared live sandbox hook now primes the audio context during start while also resuming before each queued chunk.
- Text-model provider failures now appear as model diagnostics in the event stream; the fallback phrase is still safe to show but should not hide missing OpenAI/provider configuration.
- Continuous browser microphone capture can keep sending chunks immediately after provider endpointing; the server now retires the completed STT stream so the next utterance cannot be appended to a stale one.
- If the model, tool, or TTS stage fails after STT already produced caller text, the browser transcript now shows the runtime failure instead of leaving only caller entries with no agent response.

## Decisions

- Priority: P0
- Labels: frontend, runtime, tdd-required
- Draft-mode sandbox should execute the real workflow path before publish rather than simulating it.
- The drawer remains the right surface for this flow; the change is in transport and execution fidelity, not navigation.
- `/workflows` and `/sandbox` share one browser hook for session lifecycle, transport, transcript, events, microphone capture, and audio playback.
- Voice mode behaves like a call: users start the session once, then automatic provider endpointing drives turns instead of a manual send button.
- The workflow drawer should expose the same lifecycle controls as the standalone sandbox when the underlying live session is shared.

## Next Recommended Step

Move to ISSUE-114 so tool nodes emit richer execution events through the live sandbox timeline.
