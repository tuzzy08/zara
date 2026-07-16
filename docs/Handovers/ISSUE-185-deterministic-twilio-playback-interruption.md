# ISSUE-185: Deterministic Twilio playback and interruption control

Status: Implemented
Date: 2026-07-12
External: [Linear ZAR-215](https://linear.app/zara-voice/issue/ZAR-215/issue-185-deterministic-twilio-playback-and-interruption-control)

## Work Completed
- Ticket and dependency relation created.
- Confirmed the current path forwards provider-defined audio chunks directly, emits marks from transcript completion, and does not reject late audio after interruption.
- Confirmed Twilio marks acknowledge playback or cleared media and must own playback completion.
- Added a pure playback controller that preserves native OpenAI PCMU while producing ordered 160-byte/20 ms frames with cumulative timestamps and final-frame silence padding.
- Added a 50-mark Twilio playback window, a 40,000-byte local audio queue, a 64 KiB/256-message provider ingress ledger, and explicit overflow failures.
- Bound response identity to OpenAI `response.created`; unknown, completed, interrupted, evicted, and late old response IDs cannot emit audio.
- Moved completion ownership from output transcript completion to provider audio completion plus Twilio boundary-mark acknowledgement.
- Routed inbound Twilio marks to premium execution, validated mark stream identity, and treated marks returned after `clear` as stale rather than played.
- Deduplicated speech-start plus response-cancel interruption signals into one generation advance and one Twilio clear.
- Rechecked execution ownership after awaited provider/tool processing so terminated calls cannot accept stale state updates.
- ISSUE-220 production conformance later superseded the original 40,000-byte local queue with a 30-second/240,000-byte per-call queue plus shared 32 MiB playback admission after a normal provider burst reproduced a false `premium_playback_overflow`; the 50-mark Twilio window remains unchanged.
## Tests Run
- `npx vitest run apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/telephony/pstn-premium-playback-controller.test.ts apps/api/src/telephony/pstn-premium-call-execution.test.ts apps/api/src/telephony/twilio-media-streams.bridge.test.ts apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts --pool=forks --maxWorkers=1 --testTimeout=30000` - 53 passed.
- `npx vitest run apps/api/src/telephony/twilio-media-streams.websocket.test.ts --pool=forks --maxWorkers=1 --testTimeout=30000` - 5 passed.
- `npx tsc -p apps/api/tsconfig.json --noEmit --pretty false` - passed.
- Changed-file ESLint - passed.
- `npm run eval:pstn` - 6 passed.
## Pending Work
- None for ISSUE-185. Provider-session replacement during agent handoff continues in ISSUE-186.
## Risks
- Playback state is process-local and is discarded on safe call termination; durable crash recovery remains outside this slice.
- Gemini generation identity and shared-controller integration remain ISSUE-187 work.
## Decisions
- Audio completion, not transcript completion, owns response marks.
- Frame marks provide bounded playback acknowledgements; a separate boundary mark confirms response completion.
- Only provider lifecycle-registered response IDs may emit OpenAI audio.
- Twilio marks returned after a clear release no current-generation ownership and never count as played.
## Next Recommended Step
- Begin ISSUE-186 with RED tests for same-provider and cross-provider handoff replacement, bounded transition ingress, and stale old-provider callback rejection.
