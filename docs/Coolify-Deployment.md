# Coolify Deployment

Zara deploys to Coolify as one Docker Compose resource from the repository root. The root build context is required because the apps depend on npm workspace packages under `packages/*`.

## Services

- `api`: NestJS control plane on port `4010`.
- `realtime-worker`: dedicated premium PSTN media and provider-socket worker on port `4020`.
- `web`: tenant workflow builder and sandbox, served by nginx on port `80`.
- `platform-admin`: Zara staff console, served by nginx on port `80`.
- `postgres`: pgvector Postgres with a named volume for durable data.
- `minio`: S3-compatible object storage for recordings and generated/user-uploaded assets.
- `minio-init`: one-shot bucket initializer for private `recordings` and `assets` buckets.

In Coolify, attach public domains to the service ports:

- `api`: `https://api.example.com` -> service `api`, port `4010`
- `realtime-worker`: `wss://realtime.example.com` -> service `realtime-worker`, port `4020`
- `web`: `https://app.example.com` -> service `web`, port `80`
- `platform-admin`: `https://admin.example.com` -> service `platform-admin`, port `80`

## Environment Model

Use Coolify's environment variable UI or secret store as the source of truth. Do not commit real `.env` files.

Control-plane runtime secrets live on the `api` service:

- `DATABASE_URL`
- `OBJECT_STORAGE_ACCESS_KEY_ID`
- `OBJECT_STORAGE_SECRET_ACCESS_KEY`
- `BETTER_AUTH_SECRET`
- `ZARA_AUTH_EMAIL_WEBHOOK_URL`
- `ZARA_PLATFORM_STAFF_ROLES`
- `SANDBOX_TRANSPORT_TOKEN_SECRET`
- `POLAR_ACCESS_TOKEN`
- `POLAR_WEBHOOK_SECRET`
- provider API keys as they are introduced
- `LANGSMITH_API_KEY` and OTLP headers when observability is enabled

Premium realtime provider credentials live on the `realtime-worker` service. A live worker must have at least one supported provider credential; the default production configuration requires `OPENAI_API_KEY`, while `GEMINI_API_KEY` enables Gemini Live capacity. The worker also requires:

- the same `DATABASE_URL`, `PSTN_ADMISSION_REDIS_URL`, and `BETTER_AUTH_SECRET` values as the API
- a unique `PSTN_WORKER_ID` per running replica and the deployed artifact identifier in `PSTN_WORKER_RELEASE_ID`
- a queryless public `wss` media endpoint in `REALTIME_WORKER_PUBLIC_URL`; Compose passes it to the worker as `PSTN_WORKER_PUBLIC_MEDIA_URL`
- explicit heartbeat, drain, call, CPU, memory, event-loop, file-descriptor, and WebSocket limits from `deploy/coolify.env.example`
- the shared `api-state` volume mounted read-only in operational intent for current file-backed integration grants and connector credentials; the API remains the only configuration writer

Browser app values are build-time public values, not secrets:

- `API_PUBLIC_URL`
- `APP_PUBLIC_URL`
- `ADMIN_PUBLIC_URL`
- Vite build args derived from those values, such as `VITE_API_BASE_URL`

Shared cross-app settings:

- `BETTER_AUTH_URL` is set from `API_PUBLIC_URL` in Compose.
- `ZARA_TRUSTED_ORIGINS` is a comma-separated list of browser origins allowed by API CORS and Better Auth, for example `https://app.example.com,https://admin.example.com`.
- `API_PUBLIC_URL` must be same-site with the browser origins that use cookie auth. For example, if the tenant app is `https://zharaai.com`, use an API domain such as `https://api.zharaai.com`; do not bake a Coolify `sslip.io` helper domain into `VITE_API_BASE_URL` or `VITE_AUTH_BASE_URL` for a custom-domain tenant app. Better Auth session cookies use `SameSite=Lax` by default, so a cross-site API URL can make sign-in succeed while the next `/api/auth/context` request is signed out.
- Twilio Voice webhooks remain on the API origin. Premium Media Streams use the endpoint advertised by the selected worker heartbeat through `REALTIME_WORKER_PUBLIC_URL`, including `/telephony/twilio/media-streams`; the API signs that worker ID into the one-time stream token and TwiML. Cost-optimized media remains on the API stream endpoint.
- The provided Compose topology runs one realtime worker. Do not scale that service behind an unkeyed random load balancer: each advertised worker must have its own routable `wss` endpoint, or ingress must route by the signed worker target. A stream delivered to any other worker is rejected before token consumption.
- `ZARA_AUTH_EMAIL_WEBHOOK_URL` is the server-owned transactional email delivery endpoint used for password reset and email verification messages. Production API startup fails without it.
- Optional auth hardening knobs: `ZARA_AUTH_RATE_LIMIT_WINDOW_SECONDS` defaults to `60`, `ZARA_AUTH_RATE_LIMIT_MAX` defaults to `300`, `ZARA_AUTH_RESET_TOKEN_TTL_SECONDS`, and `ZARA_AUTH_VERIFICATION_TOKEN_TTL_SECONDS`. Keep the global auth bucket high enough for normal session/org reads; Better Auth still applies stricter built-in limits to sign-in, sign-up, password-reset, and verification-email paths.
- `ZARA_PLATFORM_STAFF_ROLES` maps signed-in staff emails to platform roles as comma-separated `email=platform_role` entries, for example `admin@example.com=platform_owner,support@example.com=platform_support`. Tenant organization roles never grant staff authority.
- Vite public values are baked into static assets. Rebuild the `web` and `platform-admin` services after changing them.

## Object Storage

Coolify's bundled VPS deployment uses MinIO as the S3-compatible object store. The Compose file creates two private versioned buckets:

- `RECORDINGS_BUCKET`: call recordings and recording-derived media.
- `ASSETS_BUCKET`: tenant assets, generated assets, support attachments, and export artifacts.

The API reads object storage through S3-compatible variables:

- `OBJECT_STORAGE_ENDPOINT`
- `OBJECT_STORAGE_REGION`
- `OBJECT_STORAGE_ACCESS_KEY_ID`
- `OBJECT_STORAGE_SECRET_ACCESS_KEY`
- `OBJECT_STORAGE_FORCE_PATH_STYLE`
- `RECORDINGS_BUCKET`
- `ASSETS_BUCKET`

For bundled MinIO, keep `OBJECT_STORAGE_ENDPOINT=http://minio:9000` and `OBJECT_STORAGE_FORCE_PATH_STYLE=true`. In Coolify, do not expose MinIO API port `9000` publicly unless an operator needs direct S3 API access. If you expose the MinIO console on port `9001`, protect it with Coolify access controls or keep it private to the VPS network.

To use an external S3-compatible provider instead, point the object storage variables at that provider, set `OBJECT_STORAGE_FORCE_PATH_STYLE` according to the provider, pre-create the `recordings` and `assets` buckets with private access and versioning, and remove or disable the bundled `minio` and `minio-init` services from the deployed Compose resource.

## Shared Packages

Do not configure Coolify to build from `apps/web`, `apps/platform-admin`, or `apps/api` directly. The Dockerfile installs from the root `package-lock.json`, then builds the workspace packages each app needs:

- API builds `@zara/core`.
- Web builds `@zara/core` and `@zara/auth-client`.
- Platform admin builds `@zara/auth-client`.

This keeps local imports such as `@zara/core` and `@zara/auth-client` consistent with development and CI.

The Dockerfile keeps dependency installation deterministic with `npm ci --no-audit --fund=false`. Do not use a BuildKit npm cache mount or `--prefer-offline` for the shared dependency stage; on constrained Coolify VPS deployments those cache-backed installs can leave helper deployments marked in progress after the underlying build process has stopped.

The frontend Nginx config serves hashed assets with immutable long-lived caching, but SPA document routes are served with `Cache-Control: no-store, max-age=0`. Keep that split: cached hashed assets are safe, while cached `index.html` can leave an already-open browser on an old auth/runtime bundle after a Coolify deploy.

The API runtime image runs as the unprivileged `node` user. The Dockerfile pre-creates `/app/.zara` with `node` ownership, and Compose mounts the `api-state` volume there so file-backed runtime policy, audit, billing, integration, memory, and voice-library state stays writable and survives container recreation. API startup healthcheck uses a 60 second start period because production boot includes Nest module initialization and may run on constrained VPS hosts while Docker is still settling Postgres, MinIO, and migration work.

For small VPS deployments, set `COMPOSE_PARALLEL_LIMIT=1` in Coolify with build-time availability enabled. A 2 GB VPS should also have at least a 2 GiB swap file enabled before the first full Docker build; without swap, `npm ci` can starve or restart the running API while Docker builds the shared dependency layer.

## First Deploy

1. Create a Coolify Docker Compose resource from this repository.
2. Set the compose file path to `compose.coolify.yml`.
3. Add environment variables using `deploy/coolify.env.example` as the template.
4. Generate strong random values for `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `BETTER_AUTH_SECRET`, and `SANDBOX_TRANSPORT_TOKEN_SECRET`.
5. On a 2 GB VPS, enable a 2 GiB swap file before the first full build.
6. Deploy Postgres, Redis, MinIO, migrations, and the realtime worker first. Confirm `GET /health/ready` returns `{"status":"ready"}` and the worker heartbeat is visible before deploying the API, then deploy the browser apps.
7. The `migrate` compose service runs `npm run db:migrate` against `DATABASE_URL` before the API service starts. For an already-running deployment that predates this service, redeploy the stack or run the same command once from the API image to repair schema drift before importing phone numbers.
8. If Coolify reports that `postgres-data` or `minio-data` already exists from an older project name, treat that as a data-volume adoption warning, not the API health failure. The failing API service logs remain the source of truth when Compose reports `container api ... is unhealthy`.

Coolify's reverse proxy must preserve WebSocket upgrades for both the API domain and the realtime-worker domain. Live sandbox and cost-optimized PSTN media use the API; premium PSTN media uses the worker. Do not point the premium worker domain at the API service as a fallback.
