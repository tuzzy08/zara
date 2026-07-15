# ISSUE-220: Premium realtime turn policy, interruption truncation, and ingress contract

Status: Implemented
Date: 2026-07-15
External: [Linear ZAR-220](https://linear.app/zara-voice/issue/ZAR-220/issue-220-premium-realtime-turn-policy-interruption-truncation-and)

## Work Completed

- Diagnosed two live OpenAI PSTN calls: one failed because the one-second startup ingress limit expired before the five-second provider-readiness deadline; the other fragmented one caller utterance into multiple pause-based server-VAD turns and cleared each premature response.
- Confirmed the current runtime chooses `server_vad` from `mediaProfile: "pstn"`, while browser sessions default to semantic VAD and premium sessions do not snapshot a resolved turn policy.
- Confirmed startup and handoff reuse the same one-second/16 KiB limits even though both readiness paths allow five seconds.
- Confirmed ingress byte accounting measures source Twilio PCMU bytes rather than the resident provider message, undercounting Base64 storage and Gemini PCM expansion.
- Confirmed Twilio interruption clears playback but does not send the OpenAI-required `conversation.item.truncate` event for unheard WebSocket audio.
- Verified current OpenAI documentation names `gpt-realtime-2.1` for Realtime speech-to-speech sessions and requires WebSocket clients to stop playback and truncate unplayed assistant audio on interruption.
- Locked OpenAI Realtime as the default premium provider and `gpt-realtime-2.1` as the default model, subject only to explicit platform-admin policy.
- Created the external issue and implementation plan.
- Added a durable, versioned premium realtime conversation policy with guarded platform-admin GET/PATCH endpoints, expected-version concurrency, required audit reason, redacted audit metadata, persisted-policy validation, and a runtime control surface for provider/model and OpenAI PSTN turn policy.
- Added immutable premium session `providerConfig` snapshots containing provider, model, media profile, fixed media contract, provider turn/activity policy, and policy version. Cross-provider handoff resolves the target from the same call-start policy snapshot and fails if no registered snapshot exists.
- Removed media-profile VAD selection from provider transport. OpenAI PSTN now defaults to native PCMU plus low-eagerness semantic VAD; Gemini retains provider-native activity handling and its PCM contracts.
- Added normalized caller/assistant lifecycle events at both provider adapters and removed premium execution branches and diagnostic logs based on raw OpenAI event names.
- Added exact OpenAI interruption truncation using provider item/content identity and acknowledged 20 ms Twilio frame marks. No truncation is sent before playback acknowledgement.
- Added separate 5,250 ms/256 KiB startup and handoff ingress policies using serialized resident provider-message bytes, plus a shared process-wide 32 MiB admission budget with idempotent leases.
- Added stable terminal-media handling, provider/session contract drift rejection, and redacted provider/model/policy/media diagnostics for readiness, pressure, failures, interruption, and truncation.
- Updated deterministic PSTN evals and runtime/admin documentation to the new policy, ingress, and interruption contracts.
- Corrected the runtime-session controller contract after the first remote CI run exposed one stale Gemini environment-model assertion; the test now verifies the platform-owned `gemini-3.1-flash-live-preview` policy default and no longer implies that tenant runtime creation reads `GEMINI_LIVE_MODEL`.

## Tests Run

- RED/GREEN focused tests covered malformed/stale admin policy updates, corrupted persistence, immutable call-start policy across cross-provider handoff, provider contract drift, normalized lifecycle events, acknowledged truncation, aggregate ingress admission, deadline-aligned startup/handoff overflow, terminal media, and redacted diagnostics.
- `npm.cmd run test:run -- packages/core/src/runtime.test.ts apps/api/src/premium-realtime-policy/premium-realtime-conversation-policy.service.test.ts apps/api/src/premium-realtime-policy/premium-realtime-conversation-policy.resolver.test.ts apps/api/src/runtime-prompt-policy/runtime-prompt-policy.model-defaults.test.ts apps/api/src/runtime-sessions/runtime-sessions.service.test.ts apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts apps/api/src/telephony/pstn-premium-ingress-admission.test.ts apps/api/src/telephony/pstn-premium-call-actor.test.ts apps/api/src/telephony/pstn-premium-playback-controller.test.ts apps/api/src/telephony/pstn-premium-call-execution.test.ts --pool=forks --fileParallelism=false` passed: 159 tests.
- Neighbor regression suite for core runtime profiles, runtime-session websocket, Twilio media websocket, and platform-admin rendering passed: 95 tests.
- Guarded platform-admin premium policy API/UI focused tests passed.
- `npm.cmd run build --workspace @zara/core` passed.
- `npm.cmd run typecheck --workspace @zara/api` passed.
- `npm.cmd run typecheck --workspace @zara/platform-admin` passed.
- Focused ESLint pass across all ISSUE-220 production/test files passed after removing the two dead refactor remnants it identified.
- `npm.cmd run eval:pstn` passed: 25 deterministic PSTN scenarios.
- Initial GitHub CI on commit `7532839` passed lint, typecheck, and migration checks but found the stale Gemini controller expectation. The corrected controller and production ESM regression set passed locally: 2 files and 4 tests.

## Pending Work

- No repository acceptance work remains. A deployed Twilio call should be used as the release smoke test to confirm real provider turn timing and barge-in truncation against production network conditions.

## Risks

- Incorrect truncation identity or duration can corrupt OpenAI conversation state after barge-in.
- Raising per-call limits without aggregate admission can trade premature call failures for process memory pressure.
- A provider-neutral abstraction that hides provider-specific turn semantics can create false equivalence between OpenAI and Gemini.
- Existing unrelated working-tree changes must not be staged, reverted, or folded into this issue.

## Decisions

- Zara does not implement VAD for premium realtime. Providers own activity/turn detection; Zara configures platform policy and consumes normalized lifecycle signals.
- OpenAI PSTN defaults to `semantic_vad` with `eagerness: "low"`, `create_response: true`, and `interrupt_response: true`.
- `mediaProfile` controls codec and framing only.
- Provider/model selection remains platform-admin owned; tenant manifests do not own or override premium provider policy.
- Conversation policy is resolved once at call start and remains immutable for the logical call. Provider replacement during handoff resolves the target provider session from that same call-start policy version plus the platform-owned target-agent override.
- Startup and handoff have separate ingress policies and no silent frame dropping or sandwich fallback.
- Provider transport rejects mutable session/provider/model projections that disagree with the frozen provider contract.
- Persisted media contracts are fixed and validated; platform admins configure supported provider/model defaults and OpenAI turn settings, not arbitrary media payload shapes.

## Next Recommended Step

Deploy the completed slice and run one OpenAI premium PSTN call with a normal caller turn plus one barge-in. Confirm the trace records `gpt-realtime-2.1`, policy version, low-eagerness semantic VAD, one playback clear, and an acknowledged truncation duration without raw audio or transcript data.
