# Zara

Zara is a vertical-agnostic voice agent automation platform for automated phone calls. Businesses and individuals can create specialized voice agents for customer support, receptionist workflows, billing, onboarding, scheduling, sales, and other repeatable phone workflows.

## Architecture Direction

- Main control plane: NestJS + Postgres.
- Frontend: two Vite React apps: `apps/web` for tenants and `apps/platform-admin` for Zara staff.
- Frontend UI stack: Tailwind CSS v4, shadcn/ui primitives, Lucide icons, and React Flow for the builder canvas.
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
- [Frontend Architecture](docs/Frontend-Architecture.md)
- [Platform Admin](docs/Platform-Admin.md)
- [Roadmap](docs/Roadmap.md)
- [Issue Backlog](docs/Issue-Backlog.md)
- [Handovers](docs/Handovers/README.md)

The original research notes live in `docs/`:

- [Cloudflare voice pipeline notes](docs/cloudflare-voice-pipeline.md)
- [LangChain voice agent notes](docs/langchain-voice-agent.md)
- [OpenAI voice pipeline notes](docs/openAI-voice-pipeline.md)

## Quality Gates

Every push and pull request is expected to stay green on these commands:

- `npm run lint`
- `npm run typecheck`
- `npm run test:run`
- `npm run db:check`
