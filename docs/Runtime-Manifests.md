# Runtime Manifests

Runtime manifests are compiled from published workflow versions and tenant configuration. They are immutable for a call.

The current shared compiler lives in `@zara/core` and compiles from the published version snapshot, not the mutable draft graph. Compiled manifest IDs are deterministic and derived from a stable hash of the published version plus runtime configuration. Workspace ID participates in that hash, so the same workflow published into a different workspace produces a distinct runtime manifest.

## Manifest Contents

- organization ID and environment
- workspace ID when the workflow is workspace-scoped
- published workflow version
- entry role
- role instructions and handoff descriptions
- condition routes and fallback targets
- terminal exit nodes
- runtime profile: cost_optimized, balanced, premium_realtime
- model routing policy
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
- handoff routes: target specialist role and handoff reason
- return routes: tool or intermediary-agent response edges back to the caller node
- condition routes: branch labels, expressions, route targets, and required fallback
- exit nodes: terminal status and caller-facing outcome
- escalation policy: queue binding, fallback mode, fallback message

This preview is not a published runtime manifest yet, but it stays structurally compatible with the later compiler so tenants see real publish blockers early. The publish flow snapshots this preview into an immutable version payload, and active calls pin to that published snapshot.

## Runtime Profiles

- cost_optimized: default sandwich runtime using STT, text model/router, and TTS.
- balanced: sandwich runtime with stronger model/TTS defaults.
- premium_realtime: OpenAI Realtime speech-to-speech, selected only by explicit policy.

For live sandbox execution, the default provider mapping for sandwich profiles is:

- STT: AssemblyAI streaming STT
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

If multiple rules match, the runtime resolves them deterministically by priority, then specificity, then rule ID. If no rule matches, the runtime falls back to the active role default tier, with a safety override for low-confidence high-risk turns.

## Sandbox Runtime Events And Cost

The shared runtime package now includes an in-memory call event stream for sandbox use. Published events are idempotent by event ID, assigned monotonic sequence numbers, replayable by cursor, and pushed to live subscribers.

## Sandbox Selection

The tenant web app keeps a browser-local published workflow registry until API-backed workflow version storage is available. Publishing from the builder writes the immutable workspace-scoped workflow version into that registry. `Run in sandbox` pins the selected version, switches to the version workspace, and opens the sandbox route with the version id in the URL. The sandbox can also refresh and select from available published versions in the active workspace, then compiles the chosen version into a runtime manifest before starting a test session.

Sandbox cost estimates are componentized by telephony, STT, model input, model output, TTS, and storage. Missing provider pricing makes the estimate incomplete and can block publish or call start when tenant budgets enforce blocking limits.

Runtime `turn.cost.delta` events now feed billing through `POST /organizations/:orgId/billing/runtime-cost-events`. Billing records the event ID, session, workspace, usage metrics, cost components, and rate version so pricing changes are auditable. Unknown model/STT/TTS rates are flagged as incomplete billing events instead of silently charging zero.

Draft-mode sandbox runs on `/workflows` use an ephemeral manifest built from the current validated graph without publishing it first. This draft manifest must remain structurally compatible with the published compiler output so the same live audio executor can run both paths.

Persisted tenant budget controls now live in billing state through the budget policy and budget-check APIs. Builder draft and pre-route publish metadata should use those controls when it needs authoritative call or premium runtime gating; the old temporary browser-sandbox budget policy is no longer the source of truth.

## Prompt Injection Defenses

The runtime treats tool outputs, session memory, retrieved tenant knowledge, CRM notes, and website content as untrusted data. These items travel through structured `untrustedContext` and are rendered into the model request as a separate user message, not as role or system instructions.

The system prompt tells the model to ignore any instruction inside untrusted content that attempts to reveal prompts, bypass policy or consent, change roles, or force tool execution. Future retrieval and connector flows should attach external content through this same untrusted-context lane.

## Redaction

When `telemetry.redactSensitiveData` is enabled, live-session payloads are redacted before they are written to event history or session memory. The same redaction pipeline covers transcripts, responses, tool summaries, provider diagnostics, post-call summaries, and nested payload strings.

The v1 redaction pass masks email addresses, E.164 phone numbers, payment-card-like digit sequences, secret references, and obvious password/token/API-key assignments. Non-sensitive business references such as invoice IDs remain available for operators and post-call action items.
