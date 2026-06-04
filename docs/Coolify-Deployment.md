# Coolify Deployment

Zara deploys to Coolify as one Docker Compose resource from the repository root. The root build context is required because the apps depend on npm workspace packages under `packages/*`.

## Services

- `api`: NestJS control plane on port `4010`.
- `web`: tenant workflow builder and sandbox, served by nginx on port `80`.
- `platform-admin`: Zara staff console, served by nginx on port `80`.
- `postgres`: pgvector Postgres with a named volume for durable data.
- `minio`: S3-compatible object storage for recordings and generated/user-uploaded assets.
- `minio-init`: one-shot bucket initializer for private `recordings` and `assets` buckets.

In Coolify, attach public domains to the service ports:

- `api`: `https://api.example.com` -> service `api`, port `4010`
- `web`: `https://app.example.com` -> service `web`, port `80`
- `platform-admin`: `https://admin.example.com` -> service `platform-admin`, port `80`

## Environment Model

Use Coolify's environment variable UI or secret store as the source of truth. Do not commit real `.env` files.

API runtime secrets live only on the `api` service:

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

Browser app values are build-time public values, not secrets:

- `API_PUBLIC_URL`
- `APP_PUBLIC_URL`
- `ADMIN_PUBLIC_URL`
- Vite build args derived from those values, such as `VITE_API_BASE_URL`

Shared cross-app settings:

- `BETTER_AUTH_URL` is set from `API_PUBLIC_URL` in Compose.
- `ZARA_TRUSTED_ORIGINS` is a comma-separated list of browser origins allowed by API CORS and Better Auth, for example `https://app.example.com,https://admin.example.com`.
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

For small VPS deployments, set `COMPOSE_PARALLEL_LIMIT=1` in Coolify with build-time availability enabled. A 2 GB VPS should also have at least a 2 GiB swap file enabled before the first full Docker build; without swap, `npm ci` can starve or restart the running API while Docker builds the shared dependency layer.

## First Deploy

1. Create a Coolify Docker Compose resource from this repository.
2. Set the compose file path to `compose.coolify.yml`.
3. Add environment variables using `deploy/coolify.env.example` as the template.
4. Generate strong random values for `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `BETTER_AUTH_SECRET`, and `SANDBOX_TRANSPORT_TOKEN_SECRET`.
5. On a 2 GB VPS, enable a 2 GiB swap file before the first full build.
6. Deploy Postgres, MinIO, and API first, then the browser apps.
7. The `migrate` compose service runs `npm run db:migrate` against `DATABASE_URL` before the API service starts. For an already-running deployment that predates this service, redeploy the stack or run the same command once from the API image to repair schema drift before importing phone numbers.

Coolify's reverse proxy must preserve WebSocket upgrades for the API domain because live sandbox and PSTN media streams use WebSocket endpoints.
