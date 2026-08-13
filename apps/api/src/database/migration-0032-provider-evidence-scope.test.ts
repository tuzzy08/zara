import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

describe("provider evidence scope migration", () => {
  it("replaces global source identity with tenant catalog cycle identity", async () => {
    const migration = await readFile(resolve(
      root,
      "apps/api/src/database/migrations/0032_provider_evidence_scope.sql",
    ), "utf8");

    expect(migration).toContain("Migration 0032 blocked");
    expect(migration).toContain('ADD COLUMN "catalog_id" text NOT NULL');
    expect(migration).toContain('DROP INDEX "billing_provider_evidence_reports_provider_source_unique_idx"');
    expect(migration).toContain(
      "billing_provider_evidence_reports_tenant_catalog_cycle_provider_source_unique_idx",
    );
    expect(migration).toContain(
      '("tenant_id","catalog_id","cycle_starts_at","cycle_ends_at","provider","source_report_id")',
    );
    expect(migration).toContain("billing_provider_evidence_reports_catalog_id_billing_price_catalogs_id_fk");
  });

  it("ships a guarded rollback before 0031", async () => {
    const rollback = await readFile(resolve(
      root,
      "docs/Runbooks/rollback-0032-provider-evidence-scope.sql",
    ), "utf8");
    const workflow = await readFile(resolve(root, ".github/workflows/migration-check.yml"), "utf8");

    expect(rollback.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(rollback).toContain("Rollback 0032 blocked");
    expect(rollback.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(workflow.indexOf("rollback-0032-provider-evidence-scope.sql"))
      .toBeLessThan(workflow.indexOf("rollback-0031-billing-adjustment-evidence-integrity.sql"));
  });
});
