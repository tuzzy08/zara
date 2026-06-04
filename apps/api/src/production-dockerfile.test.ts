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
    const appLocation = nginxConfig.match(/location \/ \{(?<block>[\s\S]*?)\n  \}/);
    const assetLocation = nginxConfig.match(/location ~\* \\\.\(\?:js\|css[\s\S]*?\n  \}/);

    expect(appLocation?.groups?.block).toContain('add_header Cache-Control "no-store, max-age=0" always;');
    expect(assetLocation?.[0]).toContain('add_header Cache-Control "public, immutable" always;');
  });

  it("keeps the migration CLI available to the production API artifact", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "apps/api/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(packageJson.dependencies).toHaveProperty("drizzle-kit");
  });
});
