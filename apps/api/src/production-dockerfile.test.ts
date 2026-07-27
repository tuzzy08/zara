import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("production Dockerfile", () => {
  it("does not prune workspace runtime dependencies from the API image", async () => {
    const dockerfile = await readFile(resolve(process.cwd(), "Dockerfile"), "utf8");
    const apiBuildStage = dockerfile.match(/FROM source AS api-build(?<stage>[\s\S]*?)FROM node:22-alpine AS api/);

    expect(apiBuildStage?.groups?.stage).toBeDefined();
    expect(apiBuildStage?.groups?.stage).not.toContain("npm prune --omit=dev");
  });

  it("copies API workspace-scoped dependencies into the runtime image", async () => {
    const dockerfile = await readFile(resolve(process.cwd(), "Dockerfile"), "utf8");

    expect(dockerfile).toContain(
      "COPY --from=api-build /app/apps/api/node_modules ./apps/api/node_modules",
    );
  });

  it("copies database migration assets into the API runtime image", async () => {
    const dockerfile = await readFile(resolve(process.cwd(), "Dockerfile"), "utf8");

    expect(dockerfile).toContain("COPY --from=api-build /app/drizzle.config.ts ./drizzle.config.ts");
    expect(dockerfile).toContain(
      "COPY --from=api-build /app/apps/api/src/database ./apps/api/src/database",
    );
  });

  it("uses deterministic npm installs without BuildKit cache mounts for Coolify builds", async () => {
    const dockerfile = await readFile(resolve(process.cwd(), "Dockerfile"), "utf8");

    expect(dockerfile).toContain("RUN npm ci --no-audit --fund=false");
    expect(dockerfile).not.toContain("--mount=type=cache");
    expect(dockerfile).not.toContain("--prefer-offline");
  });

  it("excludes incremental compiler state from clean Docker builds", async () => {
    const dockerignore = await readFile(
      resolve(process.cwd(), ".dockerignore"),
      "utf8",
    );

    expect(dockerignore).toContain("**/*.tsbuildinfo");
  });

  it("serves SPA documents without caching while keeping hashed assets immutable", async () => {
    const nginxConfig = await readFile(resolve(process.cwd(), "deploy/nginx/spa.conf"), "utf8");
    const appLocation = nginxConfig.match(/location \/ \{(?<block>[\s\S]*?)\n {2}\}/);
    const assetLocation = nginxConfig.match(/location ~\* \\\.\(\?:js\|css[\s\S]*?\n {2}\}/);

    expect(appLocation?.groups?.block).toContain('add_header Cache-Control "no-store, max-age=0" always;');
    expect(assetLocation?.[0]).toContain('add_header Cache-Control "public, immutable" always;');
  });

  it("keeps the migration CLI available to the production API artifact", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "apps/api/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(packageJson.dependencies).toHaveProperty("drizzle-kit");
  });

  it("runs database migrations before the Coolify API service starts", async () => {
    const compose = normalizeLineEndings(await readFile(resolve(process.cwd(), "compose.coolify.yml"), "utf8"));
    const migrateService = compose.match(/ {2}migrate:\n(?<block>[\s\S]*?)\n {2}api:/);
    const apiService = compose.match(/ {2}api:\n(?<block>[\s\S]*?)\n {2}web:/);

    expect(migrateService?.groups?.block).toContain("target: api");
    expect(migrateService?.groups?.block).toContain('command: ["npm", "run", "db:migrate"]');
    expect(apiService?.groups?.block).toContain("migrate:");
    expect(apiService?.groups?.block).toContain("condition: service_completed_successfully");
  });

  it("runs a persistent authenticated Redis admission dependency before the API", async () => {
    const compose = normalizeLineEndings(
      await readFile(resolve(process.cwd(), "compose.coolify.yml"), "utf8"),
    );
    const redisService = compose.match(/ {2}redis:\n(?<block>[\s\S]*?)\n {2}minio:/);
    const apiService = compose.match(
      / {2}api:\n(?<block>[\s\S]*?)\n {2}realtime-worker:/,
    );
    const environment = await readFile(
      resolve(process.cwd(), "deploy/coolify.env.example"),
      "utf8",
    );

    expect(redisService?.groups?.block).toContain("image: redis:7.2.14-alpine");
    expect(redisService?.groups?.block).toContain("--appendonly yes");
    expect(redisService?.groups?.block).toContain("--appendfsync everysec");
    expect(redisService?.groups?.block).toContain("--maxmemory-policy noeviction");
    expect(redisService?.groups?.block).toContain("redis-data:/data");
    expect(redisService?.groups?.block).toContain("healthcheck:");
    expect(apiService?.groups?.block).toContain("redis:");
    expect(apiService?.groups?.block).toContain("condition: service_healthy");
    expect(apiService?.groups?.block).toContain(
      "PSTN_ADMISSION_REDIS_URL: ${PSTN_ADMISSION_REDIS_URL:?Set PSTN_ADMISSION_REDIS_URL in Coolify}",
    );
    expect(apiService?.groups?.block).not.toContain("PSTN_WORKER_ID:");
    expect(apiService?.groups?.block).toContain(
      "http://127.0.0.1:4010/health/ready",
    );
    expect(compose).toContain("redis-data:");
    expect(environment).toContain("REDIS_PASSWORD=");
    expect(environment).toContain("PSTN_ADMISSION_REDIS_URL=");
    expect(environment).toContain("PSTN_ADMISSION_GLOBAL_MAX_CONCURRENT_CALLS=20");
    expect(environment).toContain("PSTN_ADMISSION_GLOBAL_CPS_RATE=");
    expect(environment).toContain("PSTN_ADMISSION_PROVIDER_CPS_RATE=");
  });

  it("qualifies distributed admission against real Redis in CI", async () => {
    const workflow = normalizeLineEndings(
      await readFile(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8"),
    );

    expect(workflow).toContain("image: redis:7.2.14-alpine");
    expect(workflow).toContain("ZARA_TEST_REDIS_URL: redis://localhost:6379");
    expect(workflow).toContain(
      "apps/api/src/telephony/redis-pstn-call-admission.redis.test.ts",
    );
  });

  it("gives the Coolify API service a healthcheck grace period for production boot", async () => {
    const compose = normalizeLineEndings(await readFile(resolve(process.cwd(), "compose.coolify.yml"), "utf8"));
    const apiService = compose.match(
      / {2}api:\n(?<block>[\s\S]*?)\n {2}realtime-worker:/,
    );

    expect(apiService?.groups?.block).toContain("healthcheck:");
    expect(apiService?.groups?.block).toContain("start_period: 60s");
  });

  it("deploys premium PSTN media as a separate health-gated realtime worker", async () => {
    const compose = normalizeLineEndings(
      await readFile(resolve(process.cwd(), "compose.coolify.yml"), "utf8"),
    );
    const dockerfile = await readFile(
      resolve(process.cwd(), "Dockerfile"),
      "utf8",
    );
    const apiPackage = JSON.parse(
      await readFile(
        resolve(process.cwd(), "apps/api/package.json"),
        "utf8",
      ),
    ) as { scripts?: Record<string, string> };
    const apiService = compose.match(
      / {2}api:\n(?<block>[\s\S]*?)\n {2}realtime-worker:/,
    );
    const workerService = compose.match(
      / {2}realtime-worker:\n(?<block>[\s\S]*?)\n {2}web:/,
    );

    expect(dockerfile).toContain("FROM api AS realtime-worker");
    expect(dockerfile).toContain(
      'CMD ["node", "apps/api/dist-js/realtime-worker/realtime-worker.main.js"]',
    );
    expect(apiPackage.scripts).toHaveProperty(
      "start:realtime-worker:raw",
      "node dist-js/realtime-worker/realtime-worker.main.js",
    );
    expect(apiService?.groups?.block).not.toContain(
      "ZARA_PREMIUM_TWILIO_MEDIA_STREAM_BASE_URL:",
    );
    expect(apiService?.groups?.block).not.toContain(
      "ZARA_PROCESS_ROLE: pstn-realtime-worker",
    );
    expect(workerService?.groups?.block).toContain("target: realtime-worker");
    expect(workerService?.groups?.block).toContain(
      "ZARA_PROCESS_ROLE: pstn-realtime-worker",
    );
    expect(workerService?.groups?.block).toContain("PSTN_WORKER_ID:");
    expect(workerService?.groups?.block).toContain(
      "PSTN_WORKER_PUBLIC_MEDIA_URL: ${REALTIME_WORKER_PUBLIC_URL:?Set REALTIME_WORKER_PUBLIC_URL in Coolify}",
    );
    expect(workerService?.groups?.block).toContain(
      "PSTN_ADMISSION_REDIS_URL:",
    );
    expect(workerService?.groups?.block).toContain(
      "PSTN_ADMISSION_GLOBAL_CPS_BURST:",
    );
    expect(workerService?.groups?.block).toContain(
      "PSTN_ADMISSION_GLOBAL_CPS_RATE:",
    );
    expect(workerService?.groups?.block).toContain(
      "PSTN_ADMISSION_PROVIDER_CPS_BURST:",
    );
    expect(workerService?.groups?.block).toContain(
      "PSTN_ADMISSION_PROVIDER_CPS_RATE:",
    );
    expect(workerService?.groups?.block).toContain(
      "PSTN_CAPACITY_MAX_CONCURRENT_CALLS: ${PSTN_WORKER_MAX_CALLS:-20}",
    );
    expect(workerService?.groups?.block).toContain(
      "PSTN_INSTANCE_CPU_LIMIT_MILLICORES:",
    );
    expect(workerService?.groups?.block).toContain(
      "PSTN_INSTANCE_MEMORY_LIMIT_BYTES:",
    );
    expect(workerService?.groups?.block).toContain(
      "PSTN_INSTANCE_FILE_DESCRIPTOR_LIMIT:",
    );
    expect(workerService?.groups?.block).toContain("PGPOOL_MAX:");
    expect(workerService?.groups?.block).toContain(
      "PSTN_EVENT_LOOP_DELAY_LIMIT_MS: ${PSTN_WORKER_MAX_EVENT_LOOP_LAG_MS:-50}",
    );
    expect(workerService?.groups?.block).toContain("DATABASE_URL:");
    expect(workerService?.groups?.block).toContain(
      "http://127.0.0.1:4020/health/ready",
    );
    expect(workerService?.groups?.block).toContain("stop_grace_period: 31m");
    expect(workerService?.groups?.block).toContain(
      "api-state:/app/.zara:ro",
    );
    expect(workerService?.groups?.block).not.toMatch(
      /^\s*-\s+api-state:\/app\/\.zara\s*$/m,
    );
  });

  it("keeps API runtime state writable for the unprivileged production user", async () => {
    const compose = normalizeLineEndings(await readFile(resolve(process.cwd(), "compose.coolify.yml"), "utf8"));
    const dockerfile = await readFile(resolve(process.cwd(), "Dockerfile"), "utf8");
    const apiService = compose.match(
      / {2}api:\n(?<block>[\s\S]*?)\n {2}realtime-worker:/,
    );

    expect(dockerfile).toContain("RUN mkdir -p /app/.zara && chown -R node:node /app/.zara");
    expect(apiService?.groups?.block).toContain("api-state:/app/.zara");
    expect(compose).toContain("api-state:");
  });
});

function normalizeLineEndings(source: string) {
  return source.replace(/\r\n/g, "\n");
}
