# ISSUE-176: Premium realtime provider-native tool calling

External: [Linear ZAR-146](https://linear.app/zara-voice/issue/ZAR-146/issue-176-premium-realtime-provider-native-tool-calling)

Status: Implemented

## Work Completed

- Created the Linear issue and mirrored it into the local backlog.
- Added provider-neutral realtime tool bridge tests and implementation in `@zara/core`.
- Generated provider-safe function aliases from active-role agent tool assignments and mapped provider calls back to Zara assignment IDs.
- Ensured declaration payloads include safe labels/descriptions/risk/approval/schema metadata while omitting credential refs and connector internals.
- Added OpenAI Realtime adapter tests and implementation for session tool declarations, provider function-call parsing, function-call output submission, and `response.create` continuation.
- Added Gemini Live adapter tests and implementation for setup function declarations, docs-style `tool_call.function_calls` parsing, and synchronous `FunctionResponse` payloads.
- Added premium browser session contract coverage so server-owned premium sessions expose safe tool declarations and observe packet-backed tool event types.
- Added PSTN premium runtime coverage and implementation so provider turn inputs receive safe tool declarations and provider-native tool-call results are normalized into turn packets plus Zara call events.
- Rebuilt `@zara/core` declarations so API typecheck can consume the new bridge exports.
- Added `RuntimeAgentToolExecutorService` as the shared Nest-side tool executor for direct agent tool actions and provider-native realtime tool calls.
- Refactored `SandboxLiveSessionsService` to delegate existing cost-optimized live sandbox tool execution to the shared executor.
- Preserved assignment lookup, required-input validation, permission grant evaluation, approval-required handling, side-effect ledger publishing, connector/webhook registry execution, failure classification, and safe-output redaction in the shared executor.
- Added provider-call normalization so OpenAI/Gemini function names resolve through realtime declarations and execute through the same Zara `call_tool` path.
- Added unknown provider function rejection before execution.
- Added `PremiumRealtimeToolLoopService` for server-owned browser premium realtime loops: it parses OpenAI/Gemini provider tool-call events, invokes `RuntimeAgentToolExecutorService.executeRealtimeProviderToolCall`, and returns provider-specific continuation messages using safe tool output only.
- Registered the premium tool loop service in `RuntimeSessionsModule` and exported the shared executor from `SandboxLiveSessionsModule`.
- Added PSTN premium provider callback support: provider implementations now receive `executeToolCall(...)` during `runPstnTurn`, and callback results are recorded into the turn packet before final routing/audio completion.
- Preserved the existing provider-result `toolCalls` path for compatibility while adding callback-collected tool calls.
- Added `RuntimeSessionsService.processProviderMessage(...)` as the concrete server-side transport seam for premium realtime provider messages. It selects the OpenAI/Gemini adapter from the server-owned premium session contract, passes the session's safe tool declarations to `PremiumRealtimeToolLoopService`, and returns provider continuation messages.
- Added service-level tests proving OpenAI and Gemini provider messages are routed through the loop with session declarations.
- Added a focused PSTN provider-loop helper in `apps/api/src/sandbox-live-sessions/pstn-premium-realtime-provider-loop.ts` so concrete OpenAI/Gemini PSTN provider adapters can parse native tool-call messages, invoke the existing `executeToolCall(...)` callback, and return provider continuation messages without depending on the runtime-sessions WebSocket bridge.
- Added PSTN provider-loop tests for OpenAI `function_call_output` plus `response.create` continuation and Gemini synchronous `FunctionResponse` continuation.
- Updated OpenAI Realtime parsing to support docs-style `response.done` function-call output items as Zara's canonical execution surface.
- Updated Gemini Live setup messages to use the docs-style `setup` envelope while preserving function declarations and synchronous tool responses.
- Added `RuntimeSessionsWebSocketBridge` as the Zara-owned premium browser realtime WebSocket bridge. It resolves server-registered premium sessions, opens server-side OpenAI/Gemini provider WebSockets, forwards browser audio/text through Zara, processes provider messages through `RuntimeSessionsService.processProviderMessage(...)`, and sends provider continuation messages back server-side.
- Added `WsPremiumRealtimeProviderTransport` and injectable provider transport contracts for OpenAI Realtime and Gemini Live server-owned WebSocket sessions.
- Registered premium realtime sessions in `RuntimeSessionsService` with server-owned manifest/session/packet state and a `/runtime/realtime/sessions/:sessionId/stream` transport URL.
- Updated core premium realtime session URLs to point at the Zara stream endpoint rather than a manifest-only metadata path.
- Added premium browser bridge regression coverage proving provider tool calls continue server-side and provider URLs are not exposed to browser events.
- Follow-up fix: wired `/workflows` and `/sandbox` browser sandbox startup to create `/runtime/realtime/sessions` when the effective entry role resolves to `premium-realtime`, instead of silently creating the cost-optimized live sandbox session.
- Follow-up fix: projected premium realtime provider messages into the sandbox event vocabulary (`turn.transcribed`, `turn.response.started`, `turn.audio.chunk`, `turn.completed`, and provider metadata) so premium sandbox diagnostics no longer show AssemblyAI/Gemini text/Cartesia sandwich events.
- Follow-up fix: OpenAI premium typed turns now send a user conversation item followed by `response.create`; Gemini premium typed turns send a completed `clientContent` turn.
- Follow-up fix on 2026-06-15: removed the rejected Cartesia-to-premium voice mapping. OpenAI Realtime now reads only provider-native OpenAI voice settings from `realtimeVoiceConfig`, Gemini Live setup sends provider-native `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`, and Cartesia `voiceConfig` remains scoped to sandwich TTS.
- Follow-up fix on 2026-06-15: premium realtime provider sessions now receive a Zara role prompt built from the active role identity, business name, operator instructions, language policy, and active role tool assignments instead of raw instructions only.
- Follow-up fix on 2026-06-15: the browser bridge now waits for provider setup acknowledgement (`session.updated` for OpenAI Realtime, `setupComplete` for Gemini Live) before emitting `session.ready`, so first caller input is not accepted before provider prompt/session config has been applied.
- Follow-up fix on 2026-06-15: premium browser audio now preserves recorder `sampleRateHz` through the web transport; the server bridge keeps Gemini Live audio at the browser rate and resamples OpenAI Realtime microphone PCM to 24 kHz before forwarding. This prevents OpenAI from receiving 16 kHz microphone chunks as provider-native PCM and producing generic responses from effectively empty input.
- Follow-up diagnostics pass on 2026-06-15: live sandbox event formatting renders redacted premium provider evidence (`eventType`, response/item/call IDs, status) for provider diagnostic/message events and treats `tool.requested` as a first-class Zara tool lifecycle event alongside started/completed/failed/approval-required.
- Follow-up runtime pass on 2026-06-15: premium browser voice turns now rely on provider-owned turn detection. Browser `audio.commit` no longer sends Zara-authored `input_audio_buffer.commit`/`response.create` messages for OpenAI or Gemini; Zara forwards audio and reacts to confirmed provider transcript/turn events.
- Follow-up runtime pass on 2026-06-15: OpenAI Realtime session setup now uses the current nested session contract for audio input/output format, transcription, semantic VAD, voice, speed, tools, and instructions instead of older top-level audio fields.
- Follow-up runtime pass on 2026-06-15: premium sandbox projection now enforces "no completed agent turn without a confirmed user turn." Provider audio/transcript output is buffered until a typed input, final input transcript, or provider-confirmed voice item exists; unconfirmed provider output is not shown as a completed turn.
- Follow-up runtime pass on 2026-06-15: Gemini Live setup requests provider input/output transcription and treats provider activity/generation/tool lifecycle events as redacted evidence while `turnComplete` remains the provider-owned completion signal.
- Follow-up debug pass on 2026-06-15: OpenAI Realtime input transcription now uses the docs-aligned live transcription model `gpt-realtime-whisper`, parses `conversation.item.input_audio_transcription.delta` as `stt.partial`, keeps partials from confirming a turn, parses final input transcription as the confirmed caller turn, and falls back to response content transcripts on `response.done` when separate audio transcript done events are not emitted.
- Follow-up debug pass on 2026-06-15: OpenAI Realtime `input_audio_buffer.committed` is now treated as the provider-owned confirmation of a caller voice turn, so Zara no longer swallows completed provider responses when optional input transcription events are absent. The bridge marks those turns with `transcriptUnavailable: true` until OpenAI sends a final input transcript.
- Follow-up debug pass on 2026-06-15: OpenAI `session.updated` and `response.done` diagnostics now include redacted effective-session and response-content evidence, including input transcription configuration, output modalities, output content types, and whether audio output content was present.
- Follow-up debug pass on 2026-06-15: fixed the delayed-response race where a new browser `audio.append` could clear the session-level confirmed-turn flag and pending provider output before the prior OpenAI `response.done` projected to the sandbox. The bridge now queues provider-confirmed caller turns, consumes one per completed response, attaches OpenAI input transcript item IDs when present, and resets response output state on provider `response.created` rather than on microphone capture start.
- Provider-contract audit on 2026-06-15: cross-checked OpenAI Realtime WebSocket/VAD/interruption docs and Gemini Live WebSocket/capability/session docs against the premium browser bridge and adapters. Fixed the remaining confirmed mismatches: Gemini typed turns now use the documented `realtimeInput.text` envelope, Gemini input transcription now confirms and projects caller turns before `turnComplete` completes the model turn, OpenAI `input_audio_buffer.speech_started`, `response.cancelled`, `conversation.item.truncated`, and `error` events are surfaced as redacted diagnostics, cancelled OpenAI responses no longer complete Zara turns or consume the next caller turn, and browser PCM playback is interrupted when provider-owned interruption events arrive.
- Follow-up setup-failure pass on 2026-06-15: confirmed the premium prompt is built in `premium-realtime-role-prompt.ts` and sent through OpenAI `session.instructions`, then closed the failure path where browser voice capture could start after WebSocket open but before provider `session.ready`. Premium browser calls now wait for provider readiness before becoming active or starting microphone capture, OpenAI setup errors expose safe `message`, `param`, and `eventId` evidence, setup errors before readiness become `session.error` instead of a hidden diagnostic plus default-provider response, and the provider transport rejects missing active roles instead of sending an empty prompt.
- Follow-up provider-contract fix on 2026-06-15: OpenAI Realtime PCM output setup now includes the required `session.audio.output.format.rate: 24000`, matching the provider API reference and the bridge's 24 kHz playback path. Session acknowledgement diagnostics also surface the effective output audio rate when OpenAI echoes it back.
- Follow-up tool-call continuation fix on 2026-06-15: OpenAI Realtime browser premium tool execution now ignores `response.output_item.done` function-call items as diagnostic evidence and executes Zara tools only from completed docs-style `response.done` function-call output. OpenAI `function_call_output` and follow-up `response.create` messages carry deterministic Zara `event_id` values derived from the provider call ID. The premium browser bridge now projects packet-backed `tool.requested`, `tool.started`, `tool.completed`, `tool.failed`, and `tool.approval_required` events to the sandbox stream after provider-native tool execution, without raw provider payloads or connector secrets. The adjacent PSTN OpenAI provider-loop helper was updated to pass the provider call ID into its follow-up `response.create` for the same event-id contract.
- Follow-up duplicate-tool-call fix on 2026-06-15: OpenAI `response.function_call_arguments.done` is diagnostic-only in Zara browser/PSTN premium execution, matching the existing `response.output_item.done` diagnostic handling. Provider tool execution now waits for the completed `response.done` function-call output so a single provider `call_id` cannot execute once from incremental/final argument events and again from the completed response. Tool failure events remain in live events/diagnostics but are no longer inserted into live or replayed conversation transcripts as synthetic system turns.
- Follow-up replay guard on 2026-06-15: the shared premium realtime tool loop skips already-resulted provider `call_id`s in the turn packet, and the PSTN provider-loop helper accepts `handledProviderCallIds` so concrete PSTN transports can avoid replaying an already-recorded provider tool call before invoking side-effect-capable connector execution.
- Follow-up routing pass on 2026-06-17: OpenAI Realtime now keeps auto-response enabled for normal, tool-only, and route-capable agents. Route-capable active roles receive the internal `zara_route_to_agent` provider tool; when the model calls it, Zara validates the configured branch, updates active role/session prompt/tools after a route, and emits route announcement/transfer events without a separate classifier pass.

## Tests Run

- `npm.cmd run test:run -- packages/core/src/realtime-tool-bridge.test.ts`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts`
- `npm.cmd run test:run -- packages/core/src/runtime.test.ts packages/core/src/pstn-premium-realtime-runtime.test.ts`
- `npm.cmd run test:run -- packages/core/src/realtime-tool-bridge.test.ts packages/core/src/runtime.test.ts packages/core/src/pstn-premium-realtime-runtime.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts`
- `npm.cmd run build --workspace @zara/core`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run lint`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/pstn-premium-realtime-provider-loop.test.ts`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/pstn-premium-realtime-provider-loop.test.ts apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts`
- `npm.cmd run test:run -- packages/core/src/pstn-premium-realtime-runtime.test.ts`
- `npm.cmd run lint`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts`
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts apps/api/src/runtime-sessions/runtime-sessions.service.test.ts apps/api/src/runtime-sessions/premium-realtime-tool-loop.service.test.ts apps/api/src/sandbox-live-sessions/pstn-premium-realtime-provider-loop.test.ts apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts packages/core/src/pstn-premium-realtime-runtime.test.ts`
- `npm.cmd run test:run -- packages/core/src/runtime.test.ts packages/core/src/runtime-profiles.test.ts packages/core/src/pstn-premium-realtime-runtime.test.ts`
- `npm.cmd run build --workspace @zara/core`
- `npm.cmd run test:run -- packages/core/src/realtime-tool-bridge.test.ts packages/core/src/runtime.test.ts packages/core/src/runtime-profiles.test.ts packages/core/src/pstn-premium-realtime-runtime.test.ts apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts apps/api/src/runtime-sessions/runtime-sessions.service.test.ts apps/api/src/runtime-sessions/premium-realtime-tool-loop.service.test.ts apps/api/src/sandbox-live-sessions/pstn-premium-realtime-provider-loop.test.ts apps/api/src/sandbox-live-sessions/runtime-agent-tool-executor.service.test.ts apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/runtime-agent-tool-executor.service.test.ts`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/runtime-agent-tool-executor.service.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts packages/core/src/realtime-tool-bridge.test.ts packages/core/src/runtime.test.ts packages/core/src/pstn-premium-realtime-runtime.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run lint`
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/premium-realtime-tool-loop.service.test.ts`
- `npm.cmd run test:run -- packages/core/src/pstn-premium-realtime-runtime.test.ts`
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/premium-realtime-tool-loop.service.test.ts apps/api/src/runtime-sessions/runtime-sessions.controller.test.ts`
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/premium-realtime-tool-loop.service.test.ts apps/api/src/runtime-sessions/runtime-sessions.controller.test.ts apps/api/src/sandbox-live-sessions/runtime-agent-tool-executor.service.test.ts packages/core/src/pstn-premium-realtime-runtime.test.ts packages/core/src/realtime-tool-bridge.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts`
- `npm.cmd run build --workspace @zara/core`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run lint`
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/runtime-sessions.service.test.ts`
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/runtime-sessions.service.test.ts apps/api/src/runtime-sessions/premium-realtime-tool-loop.service.test.ts apps/api/src/runtime-sessions/runtime-sessions.controller.test.ts apps/api/src/sandbox-live-sessions/runtime-agent-tool-executor.service.test.ts packages/core/src/pstn-premium-realtime-runtime.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run lint`
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "surfaces premium runtime policy"`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run typecheck --workspace @zara/web`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts`
- `npm.cmd run test:run -- apps/web/src/liveSandboxTransport.test.ts apps/web/src/app.test.tsx -t "surfaces premium runtime policy"`
- `npm.cmd run test:run -- packages/core/src/workflow.test.ts packages/core/src/runtime.test.ts apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts`
- `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "shows provider-native voices instead of Cartesia controls for premium realtime agents" --pool=forks`
- `npm.cmd run build --workspace @zara/core`
- `npm.cmd run typecheck --workspace @zara/core`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run typecheck --workspace @zara/web`
- `npm.cmd run lint`
- Follow-up routing verification: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts apps/api/src/runtime-sessions/runtime-sessions.service.test.ts --pool=forks`
- Follow-up routing verification: `npm.cmd run test:run -- apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts --pool=forks`
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run test:run -- apps/web/src/liveSandboxTransport.test.ts apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts`
- `npm.cmd run typecheck --workspace @zara/web`
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts apps/web/src/liveSandboxTransport.test.ts`
- `npm.cmd run test:run -- apps/web/src/liveSandboxEventFormatting.test.ts`
- `npm.cmd run typecheck --workspace @zara/web`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts apps/api/src/runtime-sessions/premium-realtime-tool-loop.service.test.ts apps/web/src/liveSandboxEventFormatting.test.ts apps/web/src/liveSandboxTransport.test.ts`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run typecheck --workspace @zara/web`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts`
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts -t "does not delay a completed OpenAI response"`
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts`
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts apps/api/src/runtime-sessions/runtime-sessions.service.test.ts apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts apps/api/src/runtime-sessions/premium-realtime-tool-loop.service.test.ts apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts apps/web/src/liveSandboxTransport.test.ts apps/web/src/liveSandboxEventFormatting.test.ts`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts apps/api/src/runtime-sessions/premium-realtime-tool-loop.service.test.ts apps/web/src/liveSandboxEventFormatting.test.ts apps/web/src/liveSandboxTransport.test.ts`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run typecheck --workspace @zara/web`
- `npm.cmd run lint`
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/web/src/liveSandboxAudio.test.ts apps/web/src/useLiveSandboxSession.test.tsx --pool=forks`
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts apps/api/src/runtime-sessions/runtime-sessions.service.test.ts apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts apps/api/src/runtime-sessions/premium-realtime-tool-loop.service.test.ts apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts apps/web/src/liveSandboxTransport.test.ts apps/web/src/liveSandboxEventFormatting.test.ts apps/web/src/liveSandboxAudio.test.ts apps/web/src/useLiveSandboxSession.test.tsx --pool=forks`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run typecheck --workspace @zara/web`
- `npm.cmd run lint`
- `npm.cmd run test:run -- apps/web/src/useLiveSandboxSession.test.tsx apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts --pool=forks`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run typecheck --workspace @zara/web`
- `npm.cmd run lint`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/runtime-sessions/premium-realtime-provider-transport.test.ts --pool=forks`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run lint`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts --pool=forks`
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/premium-realtime-tool-loop.service.test.ts --pool=forks`
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts -t "surfaces packet-backed tool lifecycle events" --pool=forks`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/pstn-premium-realtime-provider-loop.test.ts --pool=forks`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/runtime-sessions/premium-realtime-tool-loop.service.test.ts apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts --pool=forks`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run lint`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/runtime-sessions/runtime-sessions.service.test.ts apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts apps/api/src/sandbox-live-sessions/pstn-premium-realtime-provider-loop.test.ts --pool=forks`
- `npm.cmd run test:run -- apps/web/src/useLiveSandboxSession.test.tsx apps/web/src/liveSandboxReplay.test.ts --pool=forks`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run typecheck --workspace @zara/web`
- `npm.cmd run test:run -- apps/api/src/runtime-sessions/premium-realtime-tool-loop.service.test.ts --pool=forks`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/pstn-premium-realtime-provider-loop.test.ts apps/api/src/runtime-sessions/premium-realtime-tool-loop.service.test.ts --pool=forks`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/openai-realtime.adapter.test.ts apps/api/src/runtime-sessions/runtime-sessions.service.test.ts apps/api/src/runtime-sessions/runtime-sessions.websocket.test.ts apps/api/src/runtime-sessions/premium-realtime-tool-loop.service.test.ts apps/api/src/sandbox-live-sessions/pstn-premium-realtime-provider-loop.test.ts --pool=forks`
- `npm.cmd run test:run -- apps/web/src/useLiveSandboxSession.test.tsx apps/web/src/liveSandboxReplay.test.ts --pool=forks`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run typecheck --workspace @zara/web`
- `npm.cmd run lint`

## Pending Work

- None for the ISSUE-176 acceptance criteria.
- Future concrete PSTN OpenAI/Gemini audio transport implementations should call `processPstnPremiumRealtimeProviderToolMessage(...)` whenever provider-native function/tool events arrive, then send the returned continuation messages before final audio response.
- Future production hardening can add full end-to-end live provider smoke tests when configured credentials are available; ordinary CI should continue using deterministic fake provider transports.

## Risks

- Premium realtime browser orchestration now owns provider WebSockets server-side; future changes must keep provider credentials, provider URLs, and tool secrets out of browser messages.
- PSTN premium concrete audio transports must use the provider-loop helper rather than bypassing `executeToolCall(...)`.
- Tool outputs must stay in the untrusted lane and never leak raw connector credential metadata.
- Provider-native built-in tools remain out of scope; adding them later requires separate registry/policy work.
- Premium realtime readiness is now provider-acknowledged rather than optimistic; future provider adapters must expose an equivalent setup/session acknowledgement before the browser is marked ready.
- Premium realtime audio must continue carrying sample-rate metadata across the Zara browser transport. Provider-specific audio conversion belongs in the server bridge/adapters, not in tenant-facing UI controls.
- OpenAI WebSocket interruption still cannot be perfectly transcript-truncated without browser playback position bookkeeping. Zara now stops queued playback and prevents cancelled responses from completing turns; future truncation work should use the documented `conversation.item.truncate` path with measured played-audio duration.
- Any provider `session.update` rejection must be treated as a failed setup. Continuing after a rejected setup lets OpenAI answer with its default persona and makes operator instructions appear ignored.
- Route-capable OpenAI roles depend on final input transcripts before classification. If a provider confirms a caller item without transcript text, Zara should continue using the existing no-transcript/interruption patterns rather than inventing route input.

## Decisions

- Only Zara-configured agent tools are declared to providers in this slice.
- Provider-native built-in tools such as Google Search remain out of scope.
- Function names are provider-safe aliases mapped back to Zara assignment IDs server-side.
- Premium realtime uses provider-owned VAD/turn detection and provider-native voice/language controls. Zara should not add speech-completion heuristics or map Cartesia controls into premium providers.
- Browser sandbox auto-greeting remains disabled for premium realtime unless the workflow entry node explicitly opts into greeting first; otherwise the first response must follow confirmed caller speech or typed input.
- Provider diagnostics are evidence-oriented and redacted: IDs, event names, status, provider/model metadata, and safe lengths are acceptable, but raw provider payloads/audio/tool secrets are not.
- OpenAI Realtime input transcription is useful for transcript display, but it is not the only valid provider-owned proof that the caller spoke. `input_audio_buffer.committed` confirms a voice input item; final input transcription updates the text transcript when available.
- Gemini Live input transcription is provider-owned caller-turn evidence even though the API does not emit the same final transcript event shape as OpenAI; Zara confirms the caller turn from Gemini `inputTranscription` and uses `turnComplete` only to close the model response.
- OpenAI Realtime function tool execution follows the documented complete `response.done` function-call payload. `response.function_call_arguments.done` and `response.output_item.done` function-call items are retained only as redacted diagnostics so Zara does not execute the same provider `call_id` from multiple event surfaces.
- Conversation transcripts contain caller, agent, and handoff system turns only. Tool failures stay in the tool timeline/diagnostics and should not be rendered as synthetic conversation transcript entries.
- A provider `call_id` with an existing packet result is considered already handled and must not invoke connector execution again.
- OpenAI client events sent after Zara tool execution use deterministic event IDs so provider `error` events can identify whether the failed outbound event was the `function_call_output` item or the follow-up `response.create`.
- OpenAI auto-response remains enabled for premium roles by default. Route-capable active roles use the internal route tool for model-decided handoff, while tool-bearing specialists without route policies continue through normal provider auto-response.

## Next Recommended Step

Move to the next prioritized issue after ISSUE-176, or add production smoke coverage for real configured OpenAI/Gemini realtime sessions outside ordinary CI.
