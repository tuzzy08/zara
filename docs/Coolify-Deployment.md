# Coolify Deployment

Zara deploys to Coolify as one Docker Compose resource from the repository root. The root build context is required because the apps depend on npm workspace packages under `packages/*`.

## Services

- `api`: NestJS control plane on port `4010`.
- `web`: tenant workflow builder and sandbox, served by nginx on port `80`.
- `platform-admin`: Zara staff console, served by nginx on port `80`.
- `postgres`: pgvector Postgres with a named volume for durable data.

In Coolify, attach public domains to the service ports:

- `api`: `https://api.example.com` -> service `api`, port `4010`
- `web`: `https://app.example.com` -> service `web`, port `80`
- `platform-admin`: `https://admin.example.com` -> service `platform-admin`, port `80`

## Environment Model

Use Coolify's environment variable UI or secret store as the source of truth. Do not commit real `.env` files.

API runtime secrets live only on the `api` service:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `SANDBOX_TRANSPORT_TOKEN_SECRET`
- `POLAR_ACCESS_TOKEN`
- `POLAR_WEBHOOK_SECRET`
- provider API keys as they are introduced
- `LANGSMITH_API_KEY` and OTLP headers when observability is enabled

Browser app values are build-time public values, not secrets:

- `API_PUBLIC_URL`
- `APP_PUBLIC_URL`
- `ADMIN_PUBLIC_URL`
- Vite build args derived from those values, such as `VITE_API_BASE_URL`

Shared cross-app settings:

- `BETTER_AUTH_URL` is set from `API_PUBLIC_URL` in Compose.
- `ZARA_TRUSTED_ORIGINS` is a comma-separated list of browser origins allowed by API CORS and Better Auth, for example `https://app.example.com,https://admin.example.com`.
- Vite public values are baked into static assets. Rebuild the `web` and `platform-admin` services after changing them.

## Shared Packages

Do not configure Coolify to build from `apps/web`, `apps/platform-admin`, or `apps/api` directly. The Dockerfile installs from the root `package-lock.json`, then builds the workspace packages each app needs:

- API builds `@zara/core`.
- Web builds `@zara/core` and `@zara/auth-client`.
- Platform admin builds `@zara/auth-client`.

This keeps local imports such as `@zara/core` and `@zara/auth-client` consistent with development and CI.

## First Deploy

1. Create a Coolify Docker Compose resource from this repository.
2. Set the compose file path to `compose.coolify.yml`.
3. Add environment variables using `deploy/coolify.env.example` as the template.
4. Generate strong random values for `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, and `SANDBOX_TRANSPORT_TOKEN_SECRET`.
5. Deploy Postgres and API first, then the browser apps.
6. Run database migrations as a one-off command before serving production traffic: `npm run db:migrate`.

Coolify's reverse proxy must preserve WebSocket upgrades for the API domain because live sandbox and PSTN media streams use WebSocket endpoints.
