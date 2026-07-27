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

  it("documents Coolify API startup health and runtime state persistence", () => {
    const coolifyPlanPath = resolve(repositoryRoot, "docs/Coolify-Deployment.md");
    const composePath = resolve(repositoryRoot, "compose.coolify.yml");
    const dockerfilePath = resolve(repositoryRoot, "Dockerfile");

    const coolifyPlan = readFileSync(coolifyPlanPath, "utf8");
    const compose = readFileSync(composePath, "utf8");
    const dockerfile = readFileSync(dockerfilePath, "utf8");

    expect(compose).toContain("start_period: 60s");
    expect(compose).toContain("api-state:/app/.zara");
    expect(compose).toContain("api-state:");
    expect(dockerfile).toContain("chown -R node:node /app/.zara");
    expect(coolifyPlan).toContain("API startup healthcheck uses a 60 second start period");
    expect(coolifyPlan).toContain("api-state");
  });

  it("documents the external Coolify application contract for multi-worker PSTN", () => {
    const coolifyPlan = readFileSync(
      resolve(repositoryRoot, "docs/Coolify-Deployment.md"),
      "utf8",
    );
    const stagingPlan = readFileSync(
      resolve(repositoryRoot, "docs/Staging-Deployment.md"),
      "utf8",
    );
    const productionPlan = readFileSync(
      resolve(repositoryRoot, "docs/Production-Deployment.md"),
      "utf8",
    );
    const readinessChecklist = readFileSync(
      resolve(repositoryRoot, "docs/Production-Readiness-Checklist.md"),
      "utf8",
    );
    const compose = readFileSync(
      resolve(repositoryRoot, "compose.coolify.yml"),
      "utf8",
    ).replace(/\r\n/gu, "\n");

    expect(compose.match(/^ {2}realtime-worker:\n/gmu)).toHaveLength(1);
    expect(compose).not.toContain("realtime-worker-1:");
    expect(compose).not.toContain("realtime-worker-2:");
    expect(compose).not.toContain("zara.deployment.");
    expect(coolifyPlan).toContain(
      "Coolify Docker Compose deployments do not support rolling updates",
    );
    expect(coolifyPlan).toContain(
      "two separate Coolify Dockerfile Application resources",
    );
    expect(coolifyPlan).toContain("Dockerfile target `realtime-worker`");
    expect(coolifyPlan).toContain(
      "`https://realtime-worker-1.example.com:4020`",
    );
    expect(coolifyPlan).toContain(
      "`wss://realtime-worker-1.example.com/telephony/twilio/media-streams`",
    );
    expect(coolifyPlan).toContain(
      "Disable Coolify rolling updates on each worker application",
    );
    expect(coolifyPlan).not.toContain(
      "Enable Coolify rolling updates on each worker application",
    );
    expect(coolifyPlan).toContain("Zara serial drain-and-replace procedure");
    expect(coolifyPlan).toContain(
      "wait for its active calls to finish or reach the forced drain deadline",
    );
    expect(coolifyPlan).toContain(
      "Verify its exact endpoint, heartbeat, and new release",
    );
    expect(stagingPlan).toContain(
      "Local tests do not prove Coolify routing, proxy timeout, deployment replacement, or drain behavior",
    );
    expect(stagingPlan).toContain(
      "repeat the serial drain-and-replace procedure for the sibling",
    );
    expect(productionPlan).toContain(
      "The checked-in Docker Compose resource is the single-worker baseline and does not provide rolling updates or the two-worker HA topology",
    );
    expect(productionPlan).toContain(
      "Coolify's overlapping rolling update must remain disabled",
    );
    expect(productionPlan).toContain(
      "PSTN_WORKER_PUBLIC_MEDIA_URL=wss://host/telephony/twilio/media-streams",
    );
    expect(productionPlan).not.toContain(
      "REALTIME_WORKER_PUBLIC_URL=wss://host/telephony/twilio/media-streams",
    );
    expect(readinessChecklist).toContain(
      "Deployed staging evidence records the effective container `nofile` limits",
    );
    expect(readinessChecklist).toContain(
      "Each worker was replaced without old/new process overlap",
    );
    expect(readinessChecklist).toContain(
      "`zara.pstn.worker.forced_drain_terminations` increases",
    );
    expect(readinessChecklist).toContain(
      "`zara.pstn.admission.pending_releases` remains above zero",
    );
    expect(readinessChecklist).toContain(
      "`zara.pstn.admission.duplicate_claim_attempts` exceeds",
    );
    expect(readinessChecklist).toContain(
      "`zara.pstn.finalization.operations` reports `exhausted` or `failed`",
    );
    expect(readinessChecklist).toContain(
      "`zara.pstn.admission.backend_ready` remains zero",
    );
  });

  it("keeps the migration CI database fixture credential-free", () => {
    const migrationWorkflow = readFileSync(
      resolve(repositoryRoot, ".github/workflows/migration-check.yml"),
      "utf8",
    );

    expect(migrationWorkflow).toContain("POSTGRES_HOST_AUTH_METHOD: trust");
    expect(migrationWorkflow).not.toContain("POSTGRES_PASSWORD:");
    expect(migrationWorkflow).not.toContain(
      ["postgres", "postgres@"].join(":"),
    );
  });

  it("keeps production Redis fail-closed without placeholder credential copy", () => {
    const compose = readFileSync(
      resolve(repositoryRoot, "compose.coolify.yml"),
      "utf8",
    );

    expect(compose).toContain(
      "REDIS_PASSWORD: ${REDIS_PASSWORD:?required}",
    );
    expect(compose).not.toContain(
      ["Set REDIS", "PASSWORD in Coolify"].join("_"),
    );
  });
});
