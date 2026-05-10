# Runtime Manifests

Runtime manifests are compiled from published workflow versions and tenant configuration. They are immutable for a call.

## Manifest Contents

- organization ID and environment
- published workflow version
- entry role
- role instructions and handoff descriptions
- runtime profile: cost_optimized, balanced, premium_realtime
- model routing policy
- telephony connection ID and ownership mode
- tool definitions and integration connection IDs
- memory policy and retrieval scopes
- escalation policy
- telemetry and retention policy
- budget limits

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
