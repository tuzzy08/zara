# ISSUE-171: Fix live sandbox streaming STT lifecycle and follow-up turns

Status: Implemented
External: [Linear ZAR-141](https://linear.app/zara-voice/issue/ZAR-141/issue-171-fix-live-sandbox-streaming-stt-lifecycle-and-follow-up-turns)

## Goal

Fix the no-response follow-up bug and make AssemblyAI streaming sessions behave correctly across multiple turns.

## Work Completed

- Created the Linear issue and local backlog entry.
- Started implementation pass on 2026-06-11.
- Moved Linear ZAR-141, local backlog, and this handover to In Progress.
- Added AssemblyAI `ForceEndpoint` session contract support and separated forced endpointing from session termination.
- Added explicit `forceEndpoint()` and `terminate()` methods to live streaming STT sessions.
- Changed streaming final handling to keep the AssemblyAI stream open across multiple caller turns.
- Kept websocket/session teardown mapped to explicit STT termination.
- Added a multi-turn websocket regression that preserves the `event.sequence` type guard and payload cast while proving follow-up caller turns produce another response.
- Added runtime-diagnostic regression coverage proving a transcript is visible before model failure diagnostics.
- Added live-event recent-list selection that de-emphasizes repeated `input.audio.buffered` noise without deleting event history.
- Follow-up on 2026-06-11: added selected text-model provider preflight for non-premium live sandbox sessions so a Gemini-selected role with missing `GEMINI_API_KEY` is blocked at session creation with a clear provider setup message instead of failing on the first turn behind the generic apology response.
- Follow-up on 2026-06-11: exposed selected-provider availability from the text-model router so sandbox startup can diagnose the exact model provider chosen by the active role.
- Follow-up on 2026-06-11: added STT evidence surfacing for live sandbox debugging. Streaming voice runs now emit provider telemetry for `session_opened`, per-turn `audio_first_frame`, and `final` before `turn.transcribed`/`turn.completed`, while the workflow sandbox drawer keeps a collapsed Diagnostics panel with the last non-buffered STT/turn/model/tool/TTS events and compact payload details.
- Follow-up on 2026-06-11: fixed a workflow sandbox start race where the browser could post a real actor user ID before auth context finished repairing/confirming selected workspace access. The workflow toolbar now disables `Run in sandbox` until the selected workspace is locally accessible or the server-owned active workspace has been returned by auth context, and the start path also guards against direct invocation.
- Follow-up on 2026-06-12: fixed draft sandbox connector-tool execution grants for all providers by matching active grants against `manifest.publishedVersionId` when present and falling back to stable `manifest.workflowId` for draft manifests. This keeps workspace, provider, tool, connection, scope, and role checks intact while allowing configured tools to run in draft tests.
- Follow-up on 2026-06-12: split streaming STT final telemetry into `latencyMs`/`listeningMs`, `speechMs`, and `endpointMs`, and updated diagnostics copy to prefer endpoint timing so idle listening no longer reads as provider transcription latency.
- Follow-up on 2026-06-12: surfaced degraded model fallback turns as explicit diagnostics. Model provider telemetry now carries `degraded` and `failureStage` when the runtime falls back, the workflow diagnostics list retains `quality.flagged` and `runtime.warning` events, and degraded `turn.completed` events no longer appear as ordinary successful agent responses in the UI.
- Follow-up on 2026-06-12: fixed provider-agnostic tool grant matching for draft sandbox calls. Draft sandbox manifests now preserve the real workflow id instead of rewriting it to `-draft-sandbox`, and runtime grant evaluation accepts grants scoped to either the stable workflow id or the published version id while preserving provider/tool/connection/workspace/role checks.
- Follow-up on 2026-06-12: pinned failure diagnostics in long sandbox calls. The Diagnostics selector now reserves room for tool failures, model/runtime warnings, call failures, provider diagnostics, provider-close telemetry, and degraded completions so early tool-failure evidence is not pushed out by later routine STT milestones.
- Follow-up on 2026-06-12: surfaced provider-tool execution evidence after successful STT/model turns. Default HTTP tool execution now attaches status metadata and a short redacted provider response excerpt to non-2xx failures, and the workflow Diagnostics formatter shows structured `tool.failed.error.message` before falling back to generic copy.
- Follow-up on 2026-06-12: fixed live sandbox execution for catalog-backed connector tools. Built-in connector bindings such as `zendesk.tickets.search` intentionally do not carry editable HTTP request metadata, so the sandbox tool registry now dispatches those bindings through `ConnectorToolsService` with the tenant connection id, idempotency key, and model-provided arguments; webhook HTTP tools continue using the existing request-metadata path.
- Follow-up on 2026-06-12: projected catalog connector input schemas into live sandbox model-facing tool assignments. Provider tools such as Zendesk Search Tickets and HubSpot Contact Lookup now expose their required inputs in `availableTools`, so the agent prompt and runtime missing-input guard share the same server-owned connector schema instead of relying on empty compiled assignment metadata.
- Follow-up on 2026-06-12: fixed duplicate voice responses when AssemblyAI emits more than one final transcript while a turn is already running. Streaming STT finals now serialize at the session level: a final received during an in-flight model/tool/TTS turn is ignored with `provider.telemetry` event `final_ignored_in_flight` instead of starting another tool/model response for the same conversational moment.
- Follow-up on 2026-06-12: hardened agent action-mode parse failures for closing turns. Partial structured JSON from the text model is no longer spoken raw; if the caller is closing the call, the runtime emits `quality.flagged` with `agent_action.invalid_json` and returns a natural goodbye instead of the generic apology.
- Follow-up on 2026-06-12: corrected browser voice sandbox turn-taking to trust provider-confirmed STT final events instead of maintaining a Zara-side phrase list. AssemblyAI streaming defaults still use a less eager silence window, AssemblyAI `end_of_turn` finals and Cartesia `turn.end` finals now start model/tool/TTS work directly, and Cartesia `turn.eager_end` / `turn.resume` remain telemetry only until a real `turn.end` arrives.
- Moved Linear ZAR-141, local backlog, and this handover to Implemented.

## Tests Run

- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/assemblyai-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/assemblyai-stt.provider.test.ts --pool=threads`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts --testNamePattern "keeps one streaming STT session" --pool=threads`
- `npm.cmd run test:run -- apps/web/src/liveSandboxEventFormatting.test.ts --pool=threads`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts --pool=threads`
- `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/assemblyai-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/assemblyai-stt.provider.test.ts apps/web/src/liveSandboxEventFormatting.test.ts --pool=threads`
- `npm.cmd run typecheck --workspace @zara/api`
- `npm.cmd run typecheck --workspace @zara/web`
- `npm.cmd run lint`
- Follow-up on 2026-06-11: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-text-model-router.provider.test.ts`
- Follow-up on 2026-06-11: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "blocks live voice sessions"`
- Follow-up on 2026-06-11: `npm.cmd run typecheck --workspace @zara/api`
- Follow-up on 2026-06-11: `npm.cmd run lint`
- Follow-up on 2026-06-11: `npm.cmd run test:run -- apps/web/src/liveSandboxEventFormatting.test.ts -t "STT"`
- Follow-up on 2026-06-11: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "emits STT lifecycle"`
- Follow-up on 2026-06-11: `npm.cmd run test:run -- apps/web/src/WorkflowBuilder.test.tsx --pool=threads`
- Follow-up on 2026-06-11: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "keeps one streaming STT session|emits STT lifecycle"`
- Follow-up on 2026-06-11: `npm.cmd run test:run -- apps/web/src/liveSandboxEventFormatting.test.ts --pool=threads`
- Follow-up on 2026-06-11: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-11: `npm.cmd run typecheck --workspace @zara/api`
- Follow-up on 2026-06-11: `npm.cmd run lint`
- Follow-up on 2026-06-11: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts --pool=threads` was attempted and failed in local verification because tests that instantiate default live providers returned no session when provider credentials were unset; the fake-provider regressions for this slice passed.
- Follow-up on 2026-06-11: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "waits for auth workspace access"` failed before the fix because `Run in sandbox` was enabled while auth workspace access was unresolved, then passed after the fix.
- Follow-up on 2026-06-11: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "(starts workflow sandbox sessions|keeps the server-owned active workspace|waits for auth workspace access)"`
- Follow-up on 2026-06-11: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-11: `npm.cmd run test:run -- apps/web/src/app.test.tsx -t "workspace"` was attempted as a broader smoke and failed in an existing integrations assertion looking for `Organization-wide`; the sandbox workspace tests above passed.
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts -t "allows draft sandbox execution"` failed before the fix because draft manifests without `publishedVersionId` denied workflow-scoped connector grants, then passed after the fix.
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts`
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "emits STT lifecycle milestones"` failed before the fix because STT final telemetry did not include `listeningMs`, `speechMs`, or `endpointMs`, then passed after the fix.
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/web/src/liveSandboxEventFormatting.test.ts -t "names STT telemetry"` failed before the formatter used endpoint timing, then passed after the fix.
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/web/src/liveSandboxEventFormatting.test.ts`
- Follow-up on 2026-06-12: `npm.cmd run typecheck --workspace @zara/api`
- Follow-up on 2026-06-12: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/web/src/liveSandboxEventFormatting.test.ts` failed before the fix because `quality.flagged` was hidden from diagnostics and degraded completions were labelled as successful agent responses, then passed after the fix.
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "publishes runtime failures after a streaming transcript"` failed before the fix because model telemetry did not include degraded/failure-stage metadata, then passed after the fix.
- Follow-up on 2026-06-12: `npm.cmd run typecheck --workspace @zara/api`
- Follow-up on 2026-06-12: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts -t "allows runtime execution when grants are scoped"` failed before the fix because runtime execution only matched one manifest workflow identifier, then passed after the fix.
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/web/src/sandboxRuntimeManifest.test.ts` failed before the fix because draft sandbox manifests rewrote workflow ids to `-draft-sandbox`, then passed after the fix.
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/integrations/tool-permission-grants.service.test.ts`
- Follow-up on 2026-06-12: `npm.cmd run typecheck --workspace @zara/api` first timed out at 120s during a parallel run, then passed when rerun alone with a 240s timeout.
- Follow-up on 2026-06-12: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/web/src/sandboxRuntimeManifest.test.ts apps/web/src/liveSandboxEventFormatting.test.ts`
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/web/src/liveSandboxEventFormatting.test.ts -t "pins failure diagnostics"` failed before the fix because an early `tool.failed` event was pushed outside the 40-event diagnostics window, then passed after the fix.
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/web/src/liveSandboxEventFormatting.test.ts`
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/web/src/liveSandboxEventFormatting.test.ts` failed before the fix because `tool.failed` diagnostics ignored nested structured error messages, then passed after the fix.
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts` failed before the fix because non-success HTTP tool failures lacked status metadata and redacted provider response detail, then passed after the fix.
- Follow-up on 2026-06-12: `npm.cmd run typecheck --workspace @zara/web`
- Follow-up on 2026-06-12: `npm.cmd run typecheck --workspace @zara/api` first timed out at 120s during a parallel run, then passed when rerun alone with a 300s timeout.
- Follow-up on 2026-06-12: `npm.cmd run lint`
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts` failed before the fix because catalog-backed Zendesk bindings without `request` metadata raised `missing request metadata`, then passed after routing connector tools through `ConnectorToolsService`.
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts`
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts`
- Follow-up on 2026-06-12: `npm.cmd run typecheck --workspace @zara/api`
- Follow-up on 2026-06-12: `npm.cmd run lint`
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-session-router.test.ts` failed before the fix because connector-backed tool assignments exposed empty `inputSchema` and `requiredInputs`, then passed after schema projection was added.
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.providers.test.ts apps/api/src/sandbox-live-sessions/sandbox-live-tool-failures.test.ts`
- Follow-up on 2026-06-12: `npm.cmd run typecheck --workspace @zara/api`
- Follow-up on 2026-06-12: `npm.cmd run lint`
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "ignores duplicate streaming STT finals|answers closing turns naturally"` failed before the fix because duplicate STT finals created two model calls and partial JSON was spoken as `{`, then passed after the fix.
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "keeps one streaming STT session|rejects unsupported structured agent commands|emits STT lifecycle|publishes runtime failures"`
- Follow-up on 2026-06-12: `npm.cmd run typecheck --workspace @zara/api`
- Follow-up on 2026-06-12: `npm.cmd run lint`
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts` was attempted and still fails in broader local verification because some default-provider tests instantiate unconfigured real providers and older HubSpot tool tests expect pre-schema-projection behavior without required `email` input. The focused regressions and adjacent lifecycle/parse tests above passed.
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "trusts AssemblyAI provider finals"` failed while the old local phrase deferral was still active, then passed after the runtime removed Zara-side phrase deferral and trusted provider finals.
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "trusts AssemblyAI provider finals|trusts Cartesia|ignores duplicate streaming STT finals|emits STT lifecycle|publishes runtime failures|configures AssemblyAI"`
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/assemblyai-stt.provider.test.ts apps/api/src/sandbox-live-sessions/assemblyai-streaming.adapter.test.ts`
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/sandbox-live-sessions.websocket.test.ts -t "keeps one streaming STT session|emits STT lifecycle|publishes runtime failures|rejects unsupported structured agent commands"`
- Follow-up on 2026-06-12: `npm.cmd run typecheck --workspace @zara/api`
- Follow-up on 2026-06-12: `npm.cmd run lint`
- Follow-up on 2026-06-12: `npm.cmd run test:run -- apps/api/src/sandbox-live-sessions/cartesia-stt.adapter.test.ts apps/api/src/sandbox-live-sessions/cartesia-stt.provider.test.ts apps/api/src/sandbox-live-sessions/assemblyai-streaming.adapter.test.ts apps/api/src/sandbox-live-sessions/assemblyai-stt.provider.test.ts`

## Pending Work

- None for ISSUE-171 acceptance criteria.

## Risks And Edge Cases

- Browser clients must remain behind Zara-owned transport and never receive provider credentials.
- Forced turn boundaries must not close a billable STT session unless the live session itself is ending.
- Runtime failures after a transcript must be surfaced as system-visible events rather than silent stalled calls.
- The sandbox runtime intentionally emits `quality.flagged` plus fallback speech for recoverable model failures; it does not convert every model failure into a terminal `call.failed`.
- A selected text-model provider can now block sandbox startup when credentials are missing; provider availability probes must stay accurate as new text providers are added.
- Diagnostics now intentionally keep audio-buffer noise out of the visible evidence list; raw event counts still include those events, so operators should use the Diagnostics panel for milestone sequence/timing rather than the normal recent-event feed.
- Live sandbox creation still trusts a browser-supplied `actorUserId`; the current fix prevents the observed race, but the stronger long-term security improvement is to derive the actor from the authenticated API session and run workspace repair server-side before access checks.
- Draft sandbox connector-tool grants can now match either stable workflow ids or published version ids. Exact workspace, provider, tool, connection, scopes, and role scope still apply.
- A degraded model turn can still synthesize and play the fallback apology quickly, so latency events alone are not proof of a healthy model response. Operators should use the retained `quality.flagged`, degraded model telemetry, and degraded completion labels together.
- Runtime tool permission denials with `durationMs: 0` indicate a grant/scope/connection decision before provider execution. They should be debugged through grant identity, workspace availability, role scope, and connection scopes before provider API endpoints.
- Long spelling or correction turns can emit enough STT milestones to evict earlier context. Failure events are now pinned in Diagnostics, but raw event history remains the authoritative full timeline.
- Provider tool failures with `durationMs` greater than zero now need the structured `error.message` checked first. A non-2xx provider response should show HTTP status plus a redacted provider excerpt; if it still shows only generic copy, the provider adapter likely threw an unstructured error before the HTTP response was available.
- Catalog-backed connector tools depend on the connector service for server-owned URLs, auth headers, and payload construction. A `missing request metadata` error on a connector such as Zendesk/HubSpot means the runtime used the webhook executor path by mistake; a validation or provider HTTP error means the connector executor was reached.
- Live sandbox tool assignments now project connector input schemas from the provider catalog into `availableTools`. Real PSTN paths should use the same server-owned schema projection before provider-backed tools are enabled there, so browser and phone calls do not drift on required inputs.
- The live sandbox does not yet implement true caller barge-in/cancel while the agent is thinking or speaking. Extra STT finals during an in-flight turn are intentionally ignored and diagnosed rather than queued, because queueing caused duplicate tool/model/TTS responses for email fragments and other split finals.
- Closing-turn fallback is intentionally narrow. It only converts invalid action JSON into a natural goodbye when the caller transcript is a clear closing phrase; unsupported structured commands still produce the existing safe apology and runtime warning.
- Zara no longer keeps a local phrase-list endpointing gate in the live sandbox runtime. If AssemblyAI punctuation-based finals are still too eager in real calls, the scalable fixes are provider tuning, switching the sandbox to Cartesia Ink 2 for English workflows, or premium realtime interruption semantics, not adding more phrase cases.

## Decisions

- AssemblyAI streaming STT remains the production default.
- Manual commit / forced boundary should call `ForceEndpoint`; only session end should call `Terminate`.
- Recent live events hide repeated `input.audio.buffered` rows once meaningful runtime events exist, while event history and counts remain intact.
- STT diagnosis should use milestone telemetry (`session_opened`, `audio_first_frame`, `final`, `forced_endpoint`, `provider_close`, `termination`) plus `turn.transcribed` and `turn.completed` before changing endpointing or turn scheduling behavior.
- Degraded runtime responses should be surfaced through provider-agnostic `degraded`/`failureStage` metadata instead of provider-specific special cases.
- The backend membership guard should remain strict; the frontend may wait for auth/workspace readiness, but it should not bypass sandbox access by falling back to seeded actor IDs.
- Connector grant matching must remain provider-agnostic: the workflow identifier fallback is shared, while individual providers still require exact tool IDs, connection IDs, scopes, workspace availability, and optional role scope.
- Draft sandbox manifests should not synthesize alternate workflow ids. Permission grants are user-facing workflow configuration, so runtime identity must stay stable across draft tests and published releases.
- Diagnostics should preserve failure evidence before routine recency. Operators need the earliest tool/model failure reason more than another routine STT milestone when a call runs long.
- Tool failure visibility must remain provider-agnostic. Zendesk, HubSpot, custom webhook tools, and future providers should all surface structured safe error messages through the same `tool.failed.error` path.
- Built-in provider tools should execute through Zara-owned connector services, not through workflow-supplied request metadata. User-configurable HTTP requests remain limited to webhook/custom tools.
- Connector tool schemas are server-owned runtime contract, not user-editable workflow metadata. Empty compiled assignment schemas should be enriched from the catalog before they are shown to models or runtime validation.
- While true barge-in is out of this slice, duplicate STT finals must not produce multiple agent responses. Ignoring in-flight finals is the safe v1 behavior until the runtime has explicit interruption/cancel semantics.
- Browser voice sandbox endpointing should be provider-driven. AssemblyAI finals are trusted as provider end-of-turn events after server-owned tuning, and Cartesia `turn.end` is trusted as the final user turn while `turn.eager_end` and `turn.resume` stay diagnostic/prewarm signals only.

## Next Recommended Step

Retry the browser voice sandbox with Cartesia Ink 2 selected for English workflows if you want provider-native turn lifecycle behavior. Expected behavior: `turn.eager_end` does not trigger a reply, `turn.resume` keeps the agent from responding, and only `turn.end` starts model/tool/TTS work. If AssemblyAI still ends turns too early, tune its provider parameters or benchmark Cartesia as the default rather than adding local phrase rules.
