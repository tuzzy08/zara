# Runtime Manifests

Runtime manifests are compiled from published workflow versions and tenant configuration. They are immutable for a call.

The current shared compiler lives in `@zara/core` and compiles from the published version snapshot, not the mutable draft graph. Compiled manifest IDs are deterministic and derived from a stable hash of the published version plus runtime configuration.

## Manifest Contents

- organization ID and environment
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

Before publish, the builder exposes a draft manifest preview derived from the same graph contract used by validation. The current preview distinguishes:

- tool bindings: connector, permitted tool ID, integration connection, risk posture, approval posture
- tool request details: HTTP method, request URL, auth token requirement, headers, and body template
- handoff routes: target specialist role and handoff reason
- condition routes: branch labels, expressions, route targets, and required fallback
- exit nodes: terminal status and caller-facing outcome
- escalation policy: queue binding, fallback mode, fallback message

This preview is not a published runtime manifest yet, but it stays structurally compatible with the later compiler so tenants see real publish blockers early. The publish flow snapshots this preview into an immutable version payload, and active calls pin to that published snapshot.

## Runtime Profiles

- cost_optimized: default sandwich runtime using STT, text model/router, and TTS.
- balanced: sandwich runtime with stronger model/TTS defaults.
- premium_realtime: OpenAI Realtime speech-to-speech, selected only by explicit policy.

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
