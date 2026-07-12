# ISSUE-186: Provider-aware premium PSTN handoff

Status: Implemented
Date: 2026-07-12
External: [Linear ZAR-216](https://linear.app/zara-voice/issue/ZAR-216/issue-186-provider-aware-premium-pstn-handoff)

## Work Completed
- Ticket and dependency relations created.
- Runtime handoff resolution now creates an authoritative target session from the target concrete agent's provider, model, voice, prompt, and tool declarations while preserving logical session, manifest, transport, identity, expiry, transcript, and packet continuity.
- Same-provider immutable model/voice changes, every Gemini agent change, and cross-provider handoffs explicitly replace the premium PSTN provider connection.
- OpenAI source announcements use transfer-scoped response metadata and exact `response.created`/`response.done` correlation; unrelated concurrent responses cannot release the handoff boundary. Failed announcements transfer the announcement responsibility to the target instead of abandoning routing.
- The premium call actor implements a bounded `handing_off` state with ordered media buffering capped at 1,000 ms and 16 KiB, replacement-provider ownership, reentrant ordering, and terminal cleanup.
- PSTN execution waits for source Twilio playback acknowledgement when applicable, opens and acknowledges the target provider, sends target-native continuation context before buffered caller audio, applies the target runtime packet only after readiness, and logs `agent.handoff.completed` without exposing caller text or workflow metadata.
- Provider-leg epochs reject stale source messages and close events. Replacement timeout, readiness failure, Twilio stop, actor overflow, and application shutdown close source, target, and caller legs without sandwich fallback.
## Tests Run
- 119 relevant Vitest tests across runtime sessions, browser realtime regression, provider transport, OpenAI adapter, premium provider loop, playback, actor, PSTN execution, and Twilio media WebSocket: passed.
- API TypeScript typecheck: passed.
- ESLint on all changed production and test files: passed.
- `npm run eval:pstn`: 6/6 scenarios passed.
- `git diff --check`: passed.
## Pending Work
- None for ISSUE-186. ISSUE-187 can now enable Gemini Live PSTN on the shared media contract.
## Risks
- Provider handoff state remains in-memory for the active call and follows the existing premium PSTN restart policy: an unrecoverable runtime restart closes safely rather than reconstructing live provider audio state.
## Decisions
- Immutable voice/model/provider changes always replace the provider session.
- Gemini agent changes always replace the provider session because prompt, voice, and tools are fixed by Gemini setup.
- Target continuation is provider-neutral runtime context; source provider call IDs and workflow metadata never cross provider boundaries or enter connector tool inputs.
- A five-second handoff deadline fails closed; there is no silent downgrade to the sandwich runtime.
## Next Recommended Step
- Implement ISSUE-187 against the shared actor, playback, provider transport, and provider-aware handoff contracts.
