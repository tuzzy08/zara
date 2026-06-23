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
    const compose = await readFile(resolve(process.cwd(), "compose.coolify.yml"), "utf8");
    const migrateService = compose.match(/ {2}migrate:\n(?<block>[\s\S]*?)\n {2}api:/);
    const apiService = compose.match(/ {2}api:\n(?<block>[\s\S]*?)\n {2}web:/);

    expect(migrateService?.groups?.block).toContain("target: api");
    expect(migrateService?.groups?.block).toContain('command: ["npm", "run", "db:migrate"]');
    expect(apiService?.groups?.block).toContain("migrate:");
    expect(apiService?.groups?.block).toContain("condition: service_completed_successfully");
  });

  it("gives the Coolify API service a healthcheck grace period for production boot", async () => {
    const compose = await readFile(resolve(process.cwd(), "compose.coolify.yml"), "utf8");
    const apiService = compose.match(/ {2}api:\n(?<block>[\s\S]*?)\n {2}web:/);

    expect(apiService?.groups?.block).toContain("healthcheck:");
    expect(apiService?.groups?.block).toContain("start_period: 60s");
  });

  it("keeps API runtime state writable for the unprivileged production user", async () => {
    const compose = await readFile(resolve(process.cwd(), "compose.coolify.yml"), "utf8");
    const dockerfile = await readFile(resolve(process.cwd(), "Dockerfile"), "utf8");
    const apiService = compose.match(/ {2}api:\n(?<block>[\s\S]*?)\n {2}web:/);

    expect(dockerfile).toContain("RUN mkdir -p /app/.zara && chown -R node:node /app/.zara");
    expect(apiService?.groups?.block).toContain("api-state:/app/.zara");
    expect(compose).toContain("api-state:");
  });
});
