# ISSUE-187: Gemini Live PSTN on the shared media contract

Status: Implemented
Date: 2026-07-12
External: [Linear ZAR-217](https://linear.app/zara-voice/issue/ZAR-217/issue-187-gemini-live-pstn-on-the-shared-media-contract)

## Work Completed
- Ticket and dependency relations created.
- Audited the post-ISSUE-186 path: Gemini setup readiness, 16 kHz PCM input, tools, handoffs, pressure limits, and cleanup already use shared contracts.
- Identified the remaining gap: Gemini 24 kHz PCM output bypasses deterministic 160-byte/20 ms playback framing, marks, and bounded playback ownership.
- Gemini 24 kHz PCM output now converts to 8 kHz PCMU and enters the shared deterministic playback controller, preserving remainders across arbitrary provider chunks and emitting exact 160-byte/20 ms frames plus a turn-completion boundary.
- Gemini interruption now uses the shared playback generation/clear ownership; stale Twilio marks cannot complete or release a newer turn.
- Gemini output outside the documented PCM 24 kHz contract fails closed with `premium_gemini_output_format_invalid` instead of silently decoding incompatible bytes.
## Tests Run
- 107 relevant Vitest tests across Gemini adapter, provider transport, runtime sessions, browser regression, premium execution/playback, runtime policy, and Twilio media WebSocket: passed.
- API TypeScript typecheck: passed.
- Changed-file ESLint: passed.
- `npm run eval:pstn`: 6/6 scenarios passed.
- `git diff --check`: passed.
## Pending Work
- None for ISSUE-187.
## Risks
- Live provider conformance still depends on Gemini retaining its documented 16 kHz PCM input, 24 kHz PCM output, and `setupComplete`/`turnComplete` lifecycle.
## Decisions
- Gemini-specific behavior remains behind the provider adapter/media contract.
- OpenAI remains the platform default; tenant graph metadata does not select the premium provider.
- Unsupported Gemini output formats terminate explicitly and never fall back to OpenAI or sandwich.
## Next Recommended Step
- Implement ISSUE-188 overload observability, provider-specific eval labeling, and release gates.
