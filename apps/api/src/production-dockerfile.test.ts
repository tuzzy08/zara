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

  it("uses cached npm installs without audit calls for constrained Coolify builds", async () => {
    const dockerfile = await readFile(resolve(process.cwd(), "Dockerfile"), "utf8");

    expect(dockerfile).toContain(
      "RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline --no-audit --fund=false",
    );
  });

  it("keeps the migration CLI available to the production API artifact", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "apps/api/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(packageJson.dependencies).toHaveProperty("drizzle-kit");
  });
});
