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
});
