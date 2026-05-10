# Document Comparison And Stack Decision

The original Cloudflare, LangChain, and OpenAI notes support a hybrid design.

## Current Decision

- Default runtime: cost-optimized STT -> text model/router -> TTS.
- Premium runtime: OpenAI Realtime speech-to-speech.
- Edge/session fabric: Cloudflare Durable Objects where useful for live state and fanout.
- Orchestration and evaluation: workflow engine plus LangSmith-style tracing where useful.
- Control plane: NestJS, not Hono, because the platform is a modular SaaS backend.

See [Architecture](Architecture.md), [Runtime Manifests](Runtime-Manifests.md), and [Telephony](Telephony.md).
