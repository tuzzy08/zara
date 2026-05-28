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

  it("documents platform-admin AI observability, eval thresholds, and override runbooks", () => {
    const observabilityPath = resolve(repoRoot, "docs/Observability-Dashboards.md");
    const evalStandardPath = resolve(repoRoot, "docs/Observability-And-Evals-Standard.md");
    const stagingRunbookPath = resolve(repoRoot, "docs/Staging-Deployment.md");
    const productionRunbookPath = resolve(repoRoot, "docs/Production-Deployment.md");

    const observability = readFileSync(observabilityPath, "utf8");
    const evalStandard = readFileSync(evalStandardPath, "utf8");
    const stagingRunbook = readFileSync(stagingRunbookPath, "utf8");
    const productionRunbook = readFileSync(productionRunbookPath, "utf8");

    expect(observability).toContain("Platform-admin-only AI runtime observability");
    expect(observability).toContain("intent fallback rate");
    expect(observability).toContain("LangSmith export health");
    expect(observability).toContain("eval regression status");
    expect(evalStandard).toContain("Deterministic runtime eval suites require a 100% pass rate");
    expect(evalStandard).toContain("LLM-as-judge runtime evals require a minimum score of 0.8");
    expect(evalStandard).toContain("manual review fallback");
    expect(evalStandard).toContain("LangSmith outage override");
    expect(stagingRunbook).toContain("npm run eval:runtime");
    expect(stagingRunbook).toContain("LangSmith trace check");
    expect(productionRunbook).toContain("npm run eval:runtime");
    expect(productionRunbook).toContain("LangSmith trace check");
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
