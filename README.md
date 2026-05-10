# Zara

Zara is a vertical-agnostic voice agent automation platform for automated phone calls. Businesses and individuals can create specialized voice agents for customer support, receptionist workflows, billing, onboarding, scheduling, sales, and other repeatable phone workflows.

## Architecture Direction

- Main control plane: NestJS + Postgres.
- Platform auth: Better Auth + organization/RBAC model.
- Voice default: cost-first sandwich runtime, STT -> text model/router -> TTS.
- Premium runtime: OpenAI Realtime speech-to-speech for low-latency or high-value calls.
- Telephony: platform-managed telephony, BYO SIP trunks, and BYO provider accounts starting with Twilio.
- Integrations: platform-owned OAuth apps with encrypted tenant-scoped tokens.
- Memory: scoped opt-in session, caller/account, and tenant knowledge memory using Postgres + pgvector.
- Delivery: strict TDD for production code, RED/GREEN/REFACTOR.

## Start Here

- [AGENTS.md](AGENTS.md)
- [PRD](docs/PRD.md)
- [Architecture](docs/Architecture.md)
- [Roadmap](docs/Roadmap.md)
- [Issue Backlog](docs/Issue-Backlog.md)
- [Handovers](docs/Handovers/README.md)

The original research notes are still in the repo root:

- [Cloudflare voice pipeline notes](cloudflare-voice-pipeline.md)
- [LangChain voice agent notes](langchain-voice-agent.md)
- [OpenAI voice pipeline notes](openAI-voice-pipeline.md)
