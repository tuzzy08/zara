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
- Updated OpenAI Realtime parsing to support docs-style `response.done` function-call output items in addition to `response.function_call_arguments.done`.
- Updated Gemini Live setup messages to use the docs-style `setup` envelope while preserving function declarations and synchronous tool responses.
- Added `RuntimeSessionsWebSocketBridge` as the Zara-owned premium browser realtime WebSocket bridge. It resolves server-registered premium sessions, opens server-side OpenAI/Gemini provider WebSockets, forwards browser audio/text through Zara, processes provider messages through `RuntimeSessionsService.processProviderMessage(...)`, and sends provider continuation messages back server-side.
- Added `WsPremiumRealtimeProviderTransport` and injectable provider transport contracts for OpenAI Realtime and Gemini Live server-owned WebSocket sessions.
- Registered premium realtime sessions in `RuntimeSessionsService` with server-owned manifest/session/packet state and a `/runtime/realtime/sessions/:sessionId/stream` transport URL.
- Updated core premium realtime session URLs to point at the Zara stream endpoint rather than a manifest-only metadata path.
- Added premium browser bridge regression coverage proving provider tool calls continue server-side and provider URLs are not exposed to browser events.

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

## Pending Work

- None for the ISSUE-176 acceptance criteria.
- Future concrete PSTN OpenAI/Gemini audio transport implementations should call `processPstnPremiumRealtimeProviderToolMessage(...)` whenever provider-native function/tool events arrive, then send the returned continuation messages before final audio response.
- Future production hardening can add full end-to-end live provider smoke tests when configured credentials are available; ordinary CI should continue using deterministic fake provider transports.

## Risks

- Premium realtime browser orchestration now owns provider WebSockets server-side; future changes must keep provider credentials, provider URLs, and tool secrets out of browser messages.
- PSTN premium concrete audio transports must use the provider-loop helper rather than bypassing `executeToolCall(...)`.
- Tool outputs must stay in the untrusted lane and never leak raw connector credential metadata.
- Provider-native built-in tools remain out of scope; adding them later requires separate registry/policy work.

## Decisions

- Only Zara-configured agent tools are declared to providers in this slice.
- Provider-native built-in tools such as Google Search remain out of scope.
- Function names are provider-safe aliases mapped back to Zara assignment IDs server-side.

## Next Recommended Step

Move to the next prioritized issue after ISSUE-176, or add production smoke coverage for real configured OpenAI/Gemini realtime sessions outside ordinary CI.
