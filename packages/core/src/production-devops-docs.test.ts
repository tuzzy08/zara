import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../..");

describe("production DevOps documentation contracts", () => {
  it("documents observability dashboards, alert thresholds, and trace correlation", () => {
    const documentPath = resolve(repoRoot, "docs/Observability-Dashboards.md");

    expect(existsSync(documentPath)).toBe(true);

    const document = readFileSync(documentPath, "utf8");

    expect(document).toContain("# Observability Dashboards");
    expect(document).toContain("## Dashboard Coverage");
    expect(document).toContain("calls");
    expect(document).toContain("latency");
    expect(document).toContain("errors");
    expect(document).toContain("cost");
    expect(document).toContain("integrations");
    expect(document).toContain("telephony");
    expect(document).toContain("## Alert Thresholds");
    expect(document).toContain("## Trace ID Correlation");
    expect(document).toContain("traceId");
    expect(document).toContain("alert noise");
    expect(document).toContain("missing correlation ID");
  });

  it("documents backup coverage, tested restore procedure, and RPO/RTO targets", () => {
    const documentPath = resolve(repoRoot, "docs/Backup-Disaster-Recovery.md");

    expect(existsSync(documentPath)).toBe(true);

    const document = readFileSync(documentPath, "utf8");

    expect(document).toContain("# Backup And Disaster Recovery");
    expect(document).toContain("## Backup Coverage");
    expect(document).toContain("Postgres");
    expect(document).toContain("critical object storage");
    expect(document).toContain("recordings");
    expect(document).toContain("exports");
    expect(document).toContain("## Restore Procedure");
    expect(document).toContain("restore test");
    expect(document).toContain("## RPO/RTO Targets");
    expect(document).toContain("RPO");
    expect(document).toContain("RTO");
    expect(document).toContain("partial restore");
    expect(document).toContain("corrupt backup");
  });

  it("documents the final production readiness release gate and open-risk tracking", () => {
    const documentPath = resolve(repoRoot, "docs/Production-Readiness-Checklist.md");

    expect(existsSync(documentPath)).toBe(true);

    const document = readFileSync(documentPath, "utf8");

    expect(document).toContain("# Production Readiness Checklist");
    expect(document).toContain("## Release Gate");
    expect(document).toContain("blocks release");
    expect(document).toContain("## Checklist");
    expect(document).toContain("tests");
    expect(document).toContain("docs");
    expect(document).toContain("security");
    expect(document).toContain("compliance");
    expect(document).toContain("billing");
    expect(document).toContain("observability");
    expect(document).toContain("rollback");
    expect(document).toContain("## Open Risks");
    expect(document).toContain("risk owner");
    expect(document).toContain("stale checklist");
    expect(document).toContain("unchecked critical item");
  });
});
