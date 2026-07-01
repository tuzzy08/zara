# Runtime Manifests

Runtime manifests are compiled from published workflow versions and tenant configuration. They are immutable for a call.

The current shared compiler lives in `@zara/core` and compiles from the published version snapshot, not the mutable draft graph. Compiled manifest IDs are deterministic and derived from a stable hash of the published version plus runtime configuration. Workspace ID participates in that hash, so the same workflow published into a different workspace produces a distinct runtime manifest.

## Manifest Contents

- organization ID and environment
- workspace ID when the workflow is workspace-scoped
- published workflow version
- entry agent
- concrete agent instructions and agent-attached route policy metadata
- condition/intent routes, classifier options, branch intent metadata, and fallback targets
- agent-attached route policies, including concrete handoff targets, branch labels for operator readability, announcements, and fallback targets
- terminal exit nodes
- runtime profile: cost_optimized, balanced, premium_realtime
- model routing policy
- concrete agent text model provider and optional exact model ID from platform-admin/runtime policy
- telephony connection ID and ownership mode
- tool definitions, integration connection IDs, and request metadata for webhook-style actions
- memory policy and retrieval scopes
- escalation policy
- telemetry and retention policy
- budget limits

## Draft Manifest Preview

Before publish, the builder derives an internal draft manifest preview from the same graph contract used by validation. The preview is no longer shown as a raw inspector panel because operators configure nodes and routes directly in the builder, while publish and sandbox flows still use the compiled preview contract under the hood. The current preview distinguishes:

- tool bindings: connector, permitted tool ID, integration connection, risk posture, approval posture
- tool request details: HTTP method, request URL, auth token requirement, headers, and body template
- return routes: tool or intermediary-agent response edges back to the caller node
- condition routes: branch labels, intent keys, descriptions, examples, compatibility expressions, route targets, classifier threshold/input-window options, and required fallback
- agent-attached route policies: existing named target agents, editable branch labels, announcement text, and fallback target
- exit nodes: terminal status and caller-facing outcome
- escalation policy: queue binding, fallback mode, fallback message

This preview is not a published runtime manifest yet, but it stays structurally compatible with the later compiler so tenants see real publish blockers early. The publish flow snapshots this preview into an immutable version payload, and active calls pin to that published snapshot.

## Runtime Profiles

- cost_optimized: default sandwich runtime using STT, text model/router, and TTS.
- balanced: sandwich runtime with stronger model/TTS defaults.
- premium_realtime: provider-owned speech-to-speech selected only by explicit policy. OpenAI Realtime is the default provider, and Google Gemini Live can be selected per concrete agent while provider credentials and WebSocket URLs stay server-side.

For live sandbox execution, the default provider mapping for sandwich profiles is:

- STT: AssemblyAI streaming STT
- Text: OpenAI by default, or Google Gemini when platform-admin/runtime policy selects `google-gemini` for the concrete active agent; exact model IDs override the tier map
- TTS: Cartesia Sonic 3 streaming TTS

Provider selection is runtime-owned configuration, not browser-owned state. Draft and published sandbox sessions may use the same manifest semantics while resolving provider credentials and transport through NestJS.

Builder draft and pre-route publish metadata use `browser-webrtc` as the telephony provider because no live phone route has been selected yet. Once operators route a published workflow to a phone number, telephony execution resolves the real provider from the routed number and connection state instead of from the builder draft metadata.

## Compile-Time Validation

- Entry node exists.
- All referenced roles, tools, telephony connections, and integrations exist.
- Memory scopes are allowed by tenant policy.
- Escalation fallback exists.
- Budget policy allows selected runtime.
- No unsafe cycles or unreachable required nodes.

## Routing Policy

Compiled manifests carry normalized model routing rules. Rules currently support:

- explicit priority
- intent match
- call phase match
- language match
- minimum and maximum confidence
- minimum and maximum tool risk

If multiple rules match, the runtime resolves them deterministically by priority, then specificity, then rule ID. If no rule matches, the runtime falls back to the active agent default tier, with a safety override for low-confidence high-risk turns.

Concrete runtime agents may carry `modelProvider` and optional `modelId` from platform-admin/runtime policy. Model routing still chooses the tier for the turn; when an active agent lacks provider fields, the sandbox text-model router fills provider, tier, and optional model IDs from the platform prompt policy's agent class defaults before selecting OpenAI or Google Gemini. Runtime `routing.model_selected` events include provider and exact model ID when configured so sandbox timelines show what backend was used. Tenant workflow builders select runtime profile only from the toolbox; agent inspectors do not expose runtime profile, provider, or model ID controls.

Concrete runtime agents may additionally carry `realtimeProvider` and optional `realtimeModelId` from platform-admin/runtime policy. Platform prompt policy agent class defaults also define the approved realtime provider/model values used when fresh concrete agents do not carry explicit runtime provider fields. `openai-realtime` remains the default; `gemini-live` selects the server-owned Gemini Live pattern. Premium realtime session responses expose the resolved provider/model and a Zara-owned transport URL, not provider credentials or Google/OpenAI WebSocket endpoints.

Premium realtime sessions preserve the Zara call/session envelope while the backend can create a fresh provider session for a handoff target whose voice or provider configuration cannot be changed in-place. Normal agents receive their assigned connector tools as provider-safe declarations when available. Router agents additionally receive Zara's internal `zara_handoff_to_agent` declaration in the same runtime tool list plus compact manifest-derived handoff targets. The active model decides whether to request a configured target agent; Zara validates the target, has the source agent speak the configured handoff announcement when needed, creates the target-agent provider session/config, and continues the caller-facing session. Internal handoff tools are not connector grants and must not expose graph target IDs, provider credentials, connector metadata, or arbitrary target-entry fields.

PSTN manifests remain pinned to immutable published workflow versions and should carry the route/runtime metadata needed by `docs/PSTN-Live-Call-Runtime-Standard.md`: route mode (`test_route` or `live_route`), number ID, provider connection ID, published version ID, runtime profile, runtime path (`pstn-sandwich` or `pstn-premium-realtime`), recording posture, subscription/budget gate result, and telephony audio defaults. The ISSUE-142 live call session core validates tenant, workspace, phone number, published version, and runtime profile scope before creating or rehydrating live session metadata. ISSUE-143 consumes those manifests in the provider-neutral `pstn-sandwich` harness with G.711 mu-law 8 kHz media defaults, telephony STT/TTS metadata, packet-backed turn creation, latency classifications, safe no-frame closeout, and barge-in/clear events. ISSUE-144's Twilio bridge resolves a verified webhook to a server-created execution session before opening media, and it passes only normalized `PstnAudioFrame` values and API-local provider metadata onward. ISSUE-145 adds the protected phone-test route source: phone numbers store `liveRoute`, `testRoute`, and `phoneTestResults`; dispatch records include route mode, runtime profile, runtime path, and test session ID; and phone-test checklist facts are stored as booleans plus sanitized reasons rather than raw provider payloads. ISSUE-149 adds the premium realtime PSTN path: premium routes must pass provider capability, provider availability, tenant entitlement, budget, and explicit fallback-policy gates before media connects, and provider-native interruption facts are normalized into the same packet/event contract. Draft manifests are never valid PSTN call inputs.

Runtime text prompts are assembled from a persisted platform prompt policy plus tenant-configured agent identity and instructions. The platform policy contains global guardrails and an open-ended specialist class template catalog, is edited through platform-admin prompt policy and specialist-agent APIs, and is read by OpenAI/Gemini text providers per turn so updates do not require rebuilding providers. Tenant workflow nodes carry the selected platform class key; if a class template is missing at runtime, `custom` remains the safe prompt-policy fallback.

Live sandbox turns consume the frozen manifest through the focused live sandbox router module. The router translates manifest graph state into the next runtime route, including model-backed intent route classification, guarded condition branches, structured transfer context, handoff pre-events, transfer-loop and language-mismatch guards, agent toolbelt availability, terminal exits, fallback behavior, and packet-backed route facts. Provider adapters and transports should consume the resulting route/events rather than duplicating graph traversal.

The runtime standard introduces a turn-scoped packet as the source of decision state for intent classification, discretionary tool calls, transfer context, and model-facing agent projections. See `docs/Turn-Runtime-Packet-v1.md`, `docs/Intent-Routing-Standard.md`, `docs/Agent-Tool-And-Transfer-Standard.md`, and `docs/Runtime-Orchestration-Edge-Cases-And-Policies.md`. Intent route metadata is preserved into compiled manifests for standalone intent routes, agent toolbelt assignments compile into agent tool assignments that behave as capabilities rather than mandatory graph steps, and handoff/direct agent routes write transfer context that the receiving agent can see. Agent model action JSON is limited to `respond`, assigned `call_tool`, and `handoff_to_agent` only when the active agent has configured handoff targets; unsupported graph-command-shaped output is ignored, warned, and replaced with caller-safe fallback speech. Tool failure states remain structured (`skipped`, `approval_required`, timeout, rate limit, and `partial`), and transfer targets are blocked when the known caller language is unsupported.

## Sandbox Runtime Events And Cost

The shared runtime package now includes an in-memory call event stream for sandbox use. Published events are idempotent by event ID, assigned monotonic sequence numbers, replayable by cursor, and pushed to live subscribers.

## Sandbox Selection

The tenant web app keeps a browser-local published workflow registry until API-backed workflow version storage is available. Publishing from the builder writes the immutable workspace-scoped workflow version into that registry and adopts the returned published graph on the canvas. The workflow builder opens blank by default; operators explicitly load saved versions from the toolbar, and `Run in sandbox` uses the matching unchanged published version or opens the publish flow for unpublished/dirty drafts. The sandbox can also refresh and select from available published versions in the active workspace, then compiles the chosen version into a runtime manifest before starting a test session.

Sandbox cost estimates are componentized by telephony, STT, model input, model output, TTS, and storage. Missing provider pricing makes the estimate incomplete and can block publish or call start when tenant budgets enforce blocking limits.

Runtime `turn.cost.delta` events now feed billing through `POST /organizations/:orgId/billing/runtime-cost-events`. Billing records the event ID, session, workspace, usage metrics, cost components, and rate version so pricing changes are auditable. Unknown model/STT/TTS rates are flagged as incomplete billing events instead of silently charging zero.

Workflow-page sandbox runs use compiled published workflow versions. Unpublished or dirty builder graphs must publish first; the browser no longer compiles an ephemeral draft runtime manifest for sandbox execution.

Persisted tenant budget controls now live in billing state through the budget policy and budget-check APIs. Builder draft and pre-route publish metadata should use those controls when it needs authoritative call or premium runtime gating; the old temporary browser-sandbox budget policy is no longer the source of truth.

The implemented observability baseline uses OpenTelemetry spans derived from packet facts and exports redacted AI traces to LangSmith when enabled by environment and telemetry policy. LangSmith export does not change routing behavior, billing state, audit logs, tenant replay, or live-call availability; exporter failures become internal warning/metrics events. Runtime eval fixtures use packet and manifest projections so regression scorecards can replay intent, tool, transfer, policy, and end-to-end turn behavior without production data. See `docs/Observability-And-Evals-Standard.md`.

## Prompt Injection Defenses

The runtime treats tool outputs, session memory, retrieved tenant knowledge, CRM notes, and website content as untrusted data. These items travel through structured `untrustedContext` and are rendered into the model request as a separate user message, not as role or system instructions.

The system prompt tells the model to ignore any instruction inside untrusted content that attempts to reveal prompts, bypass policy or consent, change roles, or force tool execution. Future retrieval and connector flows should attach external content through this same untrusted-context lane.

## Redaction

When `telemetry.redactSensitiveData` is enabled, live-session payloads are redacted before they are written to event history or session memory. The same redaction pipeline covers transcripts, responses, tool summaries, provider diagnostics, post-call summaries, and nested payload strings.

The v1 redaction pass masks email addresses, E.164 phone numbers, payment-card-like digit sequences, secret references, and obvious password/token/API-key assignments. Non-sensitive business references such as invoice IDs remain available for operators and post-call action items.
