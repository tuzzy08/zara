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

## Local Development

- `npm run dev` starts the Nest API and tenant app together.
- `npm run dev:api` starts the Nest API on the local API port.
- `npm run dev:web` starts the tenant Vite app at `http://127.0.0.1:4173`.
- `npm run start:api` runs the API without watch mode.
- `npm run preview:web` serves the built tenant app locally.
- `npm run db:migrate` applies the generated Drizzle migrations to the configured Postgres database.
- The API scripts load defaults from `.env.example` and override them with root `.env` values when that file exists.

The platform-admin app is still under issue `#85`, so it currently has typecheck/build scripts but not a full Vite startup flow yet.

## Quality Gates

Every push and pull request is expected to stay green on these commands:

- `npm run lint`
- `npm run typecheck`
- `npm run test:run`
- `npm run eval:runtime`
- `npm run eval:pstn`
- `npm run db:check`
