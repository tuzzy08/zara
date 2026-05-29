# ISSUE-129: Live sandbox latency, identity prompts, and Gemini Live server transport

## Status

Implemented.

## Work completed

- Replaced the sandbox latency display source with `turn.latency.measured` caller-turn-to-first-audio timing while preserving provider first-byte telemetry for diagnostics.
- Wired the sandbox Intent selector through typed, buffered voice, committed voice, and streaming STT turns so explicit intent can drive condition routing.
- Added runtime support for streaming model chunks into streaming-capable TTS providers and for publishing TTS audio chunks as they are yielded.
- Updated Cartesia TTS to support continuation streaming, yield audio before the context completes, and reuse a warmed WebSocket for voice sessions.
- Added AudioWorklet microphone capture with a 1024-sample ScriptProcessor fallback.
- Removed hardcoded `You are Zara...` prompt identity. System prompts now use configured agent name, business name, role type, platform guardrails, role templates, and user instructions.
- Added required business-name role metadata through workflow publishing/runtime snapshots.
- Changed newly added agent nodes to start as a blank "New agent" with required Agent name, Business name, and Instructions fields highlighted.
- Added a server-owned Gemini Live adapter for WebSocket URL construction, setup/config messages, text/audio input messages, and server audio/transcript parsing.
- Added `gemini-live` as a premium realtime provider option on agent roles, preserved it through workflow publishing/runtime snapshots, exposed it in the builder inspector, and returned Gemini Live session metadata from the server-owned `/runtime/realtime/sessions` contract without exposing Google transport URLs to the browser.
- Added durable runtime prompt policy storage plus platform-admin `GET/PATCH /platform-admin/runtime/prompt-policy` APIs for guardrails and role templates with version checks and platform audit entries.
- Wired live sandbox OpenAI/Gemini text providers to read the current runtime prompt policy per turn instead of using a one-time hardcoded policy snapshot.
- Added platform-admin runtime-page controls for prompt policy guardrails, role templates, change reason, version metadata, and save action.

## Tests run

- RED/GREEN focused tests for intent transport/routing and actual latency events.
- RED/GREEN focused tests for runtime streaming TTS and audio callbacks.
- RED/GREEN focused tests for Cartesia continuation streaming, warm socket reuse, microphone AudioWorklet capture, prompt identity, and Gemini Live adapter/env contracts.
- RED/GREEN focused tests for Gemini Live premium realtime session selection, server-configured realtime model selection, durable prompt-policy APIs, prompt-policy repository persistence, provider prompt-policy wiring, and platform-admin prompt-policy editing controls.
- `npm.cmd run test:run -- packages/core/src/workflow.test.ts packages/core/src/runtime.test.ts packages/core/src/sandbox.test.ts packages/core/src/runtime-profiles.test.ts packages/core/src/workspace-workflow.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-env.test.ts apps/api/src/sandbox-live-sessions/gemini-live-realtime.adapter.test.ts apps/api/src/sandbox-live-sessions/cartesia-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/cartesia-tts.provider.test.ts apps/api/src/sandbox-live-sessions/sandbox-text-model-prompts.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.controller.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts apps/api/src/sandbox-live-sessions/openai-chat-text.provider.test.ts apps/api/src/sandbox-live-sessions/gemini-chat-text.provider.test.ts apps/api/src/sandbox-live-sessions/sandbox-text-model-provider-factory.test.ts apps/api/src/sandbox-live-sessions/sandbox-text-model-router.provider.test.ts apps/web/src/liveSandboxAudio.test.ts apps/web/src/liveSandboxTransport.test.ts apps/web/src/useLiveSandboxSession.test.tsx apps/web/src/WorkflowBuilder.test.tsx apps/platform-admin/src/index.test.tsx --pool=threads`
- `npm.cmd run test:run -- packages/core/src/runtime-profiles.test.ts apps/api/src/runtime-sessions/runtime-sessions.controller.test.ts apps/api/src/platform-admin/platform-admin.controller.test.ts apps/api/src/runtime-prompt-policy/runtime-prompt-policy.repository.test.ts apps/api/src/sandbox-live-sessions/openai-chat-text.provider.test.ts apps/api/src/sandbox-live-sessions/sandbox-text-model-provider-factory.test.ts apps/platform-admin/src/index.test.tsx --pool=threads`
- `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx --pool=forks`
- `npm.cmd run typecheck:core`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run typecheck --workspace @zara/platform-admin`
- `npm.cmd run typecheck --workspace @zara/web` currently fails on pre-existing unrelated errors in `apps/web/src/App.tsx` (`MarketingLandingPage` missing) and `apps/web/src/app.test.tsx` custom matcher typings; the new WorkflowBuilder realtime-provider changes are not in the remaining error list.
- Browser smoke on `http://127.0.0.1:4174/workflows`.

## Pending work

- No ISSUE-129 acceptance work remains.
- Follow-up: wire the Gemini Live adapter into a full native-audio runtime session bridge so a premium realtime call can run end to end on Gemini audio, including session lifecycle, browser audio forwarding, Gemini audio fanout, barge-in, tool-call events, and fallback behavior.

## Risks

- Cartesia continuation request shape should be rechecked against provider staging credentials because the local tests validate Zara's adapter contract without a live provider call.
- Gemini Live raw WebSocket schemas can evolve; keep the adapter isolated and covered before wiring it to live calls.
- Existing persisted draft workflows may lack `businessName`; the role clone path backfills an empty value so validation can guide the operator.
- Platform-admin prompt-policy edits are durable through the local file repository, while platform audit entries remain the existing in-memory platform-admin audit stream.

## Decisions

- Use Gemini Live server-to-server first. Client-to-server may reduce one hop, but production use requires ephemeral tokens and would bypass current Nest-owned credentials, tools, billing, replay, redaction, telephony, and event fanout boundaries.
- Keep provider first-byte telemetry separate from the visible Latency metric. The visible metric now represents when the caller actually waits for first audio.
- New agents intentionally start incomplete rather than inventing a name like `Specialist 1`.
- Keep Gemini Live transport URLs server-owned. The browser receives Zara session transport metadata only; Google API keys and provider WebSocket URLs stay server-side.

## Next recommended step

Create the next issue for end-to-end Gemini Live native-audio bridging from the existing server-owned adapter and premium realtime session metadata.
