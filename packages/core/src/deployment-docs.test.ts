import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const thisDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(thisDirectory, "../../../");

describe("deployment documentation", () => {
  it("documents the production environment, release process, secrets, migrations, rollback, checklist, and smoke tests", () => {
    const deploymentPlanPath = resolve(repositoryRoot, "docs/Production-Deployment.md");

    expect(existsSync(deploymentPlanPath)).toBe(true);

    const deploymentPlan = readFileSync(deploymentPlanPath, "utf8");

    expect(deploymentPlan).toContain("# Production Deployment");
    expect(deploymentPlan).toContain("## Production Environment");
    expect(deploymentPlan).toContain("## Release Process");
    expect(deploymentPlan).toContain("## Secrets");
    expect(deploymentPlan).toContain("## Migrations");
    expect(deploymentPlan).toContain("## Rollback");
    expect(deploymentPlan).toContain("## Deployment Checklist");
    expect(deploymentPlan).toContain("## Smoke Tests");
    expect(deploymentPlan).toContain("failed migration");
    expect(deploymentPlan).toContain("active calls");
  });

  it("documents staging parity, safe seed data, and staging validation", () => {
    const stagingPlanPath = resolve(repositoryRoot, "docs/Staging-Deployment.md");

    expect(existsSync(stagingPlanPath)).toBe(true);

    const stagingPlan = readFileSync(stagingPlanPath, "utf8");

    expect(stagingPlan).toContain("# Staging Deployment");
    expect(stagingPlan).toContain("## Production-Critical Parity");
    expect(stagingPlan).toContain("## Safe Seed Data");
    expect(stagingPlan).toContain("## Staging Validation");
    expect(stagingPlan).toContain("## Drift Controls");
    expect(stagingPlan).toContain("must never use production secrets");
    expect(stagingPlan).toContain("production-critical services");
  });

  it("documents the Coolify compose deployment path and workspace package handling", () => {
    const coolifyPlanPath = resolve(repositoryRoot, "docs/Coolify-Deployment.md");
    const composePath = resolve(repositoryRoot, "compose.coolify.yml");
    const dockerfilePath = resolve(repositoryRoot, "Dockerfile");

    expect(existsSync(coolifyPlanPath)).toBe(true);
    expect(existsSync(composePath)).toBe(true);
    expect(existsSync(dockerfilePath)).toBe(true);

    const coolifyPlan = readFileSync(coolifyPlanPath, "utf8");
    const compose = readFileSync(composePath, "utf8");
    const dockerfile = readFileSync(dockerfilePath, "utf8");

    expect(coolifyPlan).toContain("# Coolify Deployment");
    expect(coolifyPlan).toContain("repository root");
    expect(coolifyPlan).toContain("ZARA_TRUSTED_ORIGINS");
    expect(coolifyPlan).toContain("Vite public values are baked into static assets");
    expect(compose).toContain("target: api");
    expect(compose).toContain("target: web");
    expect(compose).toContain("target: platform-admin");
    expect(compose).toContain("POLAR_WEBHOOK_SECRET: ${POLAR_WEBHOOK_SECRET:?Set POLAR_WEBHOOK_SECRET in Coolify}");
    expect(dockerfile).toContain("npm ci");
    expect(dockerfile).toContain("npm run build --workspace @zara/core");
  });

  it("documents and provisions S3-compatible object storage for recordings and assets", () => {
    const coolifyPlanPath = resolve(repositoryRoot, "docs/Coolify-Deployment.md");
    const productionPlanPath = resolve(repositoryRoot, "docs/Production-Deployment.md");
    const composePath = resolve(repositoryRoot, "compose.coolify.yml");
    const envExamplePath = resolve(repositoryRoot, "deploy/coolify.env.example");

    const coolifyPlan = readFileSync(coolifyPlanPath, "utf8");
    const productionPlan = readFileSync(productionPlanPath, "utf8");
    const compose = readFileSync(composePath, "utf8");
    const envExample = readFileSync(envExamplePath, "utf8");

    expect(compose).toContain("minio:");
    expect(compose).toContain("minio-init:");
    expect(compose).toContain("OBJECT_STORAGE_ENDPOINT");
    expect(compose).toContain("RECORDINGS_BUCKET");
    expect(compose).toContain("ASSETS_BUCKET");
    expect(compose).toContain("minio-data:");
    expect(envExample).toContain("MINIO_ROOT_USER=");
    expect(envExample).toContain("OBJECT_STORAGE_ACCESS_KEY_ID=");
    expect(envExample).toContain("RECORDINGS_BUCKET=");
    expect(envExample).toContain("ASSETS_BUCKET=");
    expect(coolifyPlan).toContain("## Object Storage");
    expect(coolifyPlan).toContain("recordings");
    expect(coolifyPlan).toContain("assets");
    expect(coolifyPlan).toContain("external S3-compatible provider");
    expect(productionPlan).toContain("OBJECT_STORAGE_ENDPOINT");
  });

  it("documents constrained Coolify VPS build safeguards", () => {
    const coolifyPlanPath = resolve(repositoryRoot, "docs/Coolify-Deployment.md");
    const envExamplePath = resolve(repositoryRoot, "deploy/coolify.env.example");

    const coolifyPlan = readFileSync(coolifyPlanPath, "utf8");
    const envExample = readFileSync(envExamplePath, "utf8");

    expect(coolifyPlan).toContain("COMPOSE_PARALLEL_LIMIT=1");
    expect(coolifyPlan).toContain("2 GiB swap");
    expect(envExample).toContain("COMPOSE_PARALLEL_LIMIT=1");
  });
});
