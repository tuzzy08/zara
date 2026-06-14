# Zara

Zara is a voice agent automation platform for building, publishing, testing, monitoring, and improving automated phone agents. Operators use it to design phone workflows for receptionist coverage, support, billing, onboarding, scheduling, sales, and other repeatable call flows. Zara staff use a separate admin console to manage provider health, tenant operations, billing support, audit, impersonation, and abuse/compliance review.

The repository is a TypeScript monorepo with a NestJS API, two Vite React apps, and shared packages for domain contracts, auth boundaries, API helpers, and UI primitives. It is built as a real product surface rather than a starter scaffold: the tenant app includes workflow building, sandbox testing, phone testing, integrations, memory, billing, monitoring, and settings; the platform-admin app serves internal operations.

## How It Works

Tenants create workflows in the visual builder. A workflow is made of agent roles, tools, handoffs, intent routes, human escalation paths, and terminal exits. When a workflow is published, Zara stores an immutable version and compiles a runtime manifest so active calls stay pinned to the behavior they started with.

Browser sandbox calls and real PSTN calls both run through Zara-owned session transports. The browser never receives long-lived provider credentials. The API resolves the tenant, workspace, workflow version, runtime profile, memory policy, integration grants, telephony route, and escalation policy before a session begins.

The default voice runtime is a cost-optimized sandwich pipeline:

1. Caller audio is streamed to STT.
2. Transcripts are routed through workflow policy and model-backed intent handling.
3. Text responses and tool decisions are produced by the selected model provider.
4. TTS streams audio back to the caller.
5. Runtime events, costs, latency, handoffs, tool results, and trace metadata are emitted for monitoring and evals.

Premium runtime paths support low-latency realtime providers when the workflow and tenant policy allow it. PSTN support includes provider-neutral live call sessions, Twilio bidirectional Media Streams, protected phone tests, live-route activation gates, and separate runtime paths for sandwich and premium realtime calls.

Integrations are executed server side through scoped tenant credentials and capability grants. Memory and knowledge are tenant/workspace scoped, opt-in, reviewable, auditable, editable, and deletable.

## Repository Layout

- `apps/api`: NestJS backend for auth context, tenant/workspace state, workflows, live sessions, telephony, integrations, memory, billing, platform admin, observability, and runtime contracts.
- `apps/web`: tenant-facing Vite React app for marketing, auth, dashboard, workflow builder, sandbox, calls, integrations, memory, billing, monitoring, and settings.
- `apps/platform-admin`: Zara staff Vite React app for internal operations.
- `packages/core`: shared domain types, workflow contracts, runtime packet contracts, validation, and provider catalog metadata.
- `packages/auth-client`: Zara-owned auth client boundary around the server-owned auth context and auth mutations.
- `packages/api-client`: typed API client helpers.
- `packages/ui`: shared UI primitives and design tokens.
- `docs`: product, architecture, runtime, telephony, integration, memory, security, deployment, testing, roadmap, issue, and handover documentation.
- `deploy`: deployment examples and infrastructure support files.
- `scripts`: repository maintenance and build helper scripts.

## Run Locally

Install dependencies from the repository root:

```bash
npm install
```

Start the API and tenant app together:

```bash
npm run dev
```

Run individual services:

```bash
npm run dev:api
npm run dev:web
npm run dev --workspace @zara/platform-admin
```

Local app URLs:

- Tenant app: `http://localhost:4173`
- Platform admin app: `http://127.0.0.1:4174`
- API: configured by the API environment, with the local default documented in `docs/Frontend-Architecture.md`

Build and preview:

```bash
npm run build
npm run preview:web
npm run start:api
```

Apply database migrations:

```bash
npm run db:migrate
```

## Test And Verify

Run the main checks from the repository root:

```bash
npm run lint
npm run typecheck
npm run test:run
```

Run runtime and PSTN eval suites:

```bash
npm run eval:runtime
npm run eval:pstn
```

Check generated migrations are committed:

```bash
npm run db:check
```

During implementation, use focused Vitest commands for the package or behavior you are changing, then run the relevant broader checks before finishing the pass. Zara is a strict TDD project, so production-code changes should follow RED/GREEN/REFACTOR and update the issue-specific handover.

## Configuration

The API startup scripts are configured to load a root `.env.example` before root `.env`; this checkout currently carries the local override file plus deployment/admin examples. Provider credentials, auth secrets, database URLs, webhook secrets, and encryption keys must stay out of committed files.

The platform-admin app has its own example environment file at `apps/platform-admin/.env.example`. Deployment examples live under `deploy`, including `deploy/coolify.env.example`.

Provider-backed local development may require credentials for services such as STT, TTS, model providers, telephony, billing, OAuth connectors, LangSmith, and Postgres. Missing provider credentials should be handled by the relevant tests or runtime paths rather than exposed to browser clients.

## Useful Documentation

- Product requirements: `docs/PRD.md`
- System architecture: `docs/Architecture.md`
- Frontend architecture: `docs/Frontend-Architecture.md`
- API notes: `docs/API.md`
- Runtime manifests: `docs/Runtime-Manifests.md`
- PSTN runtime: `docs/PSTN-Live-Call-Runtime-Standard.md`
- Integrations: `docs/Integrations.md`
- Memory: `docs/Memory.md`
- Security and compliance: `docs/Security-Compliance.md`
- Testing strategy: `docs/Testing-Strategy.md`
- TDD workflow: `docs/TDD.md`
