import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

describe("billing adjustment evidence integrity migration", () => {
  it("binds adjustment evidence to tenant-qualified ledger and audit facts", async () => {
    const migration = await readFile(resolve(
      root,
      "apps/api/src/database/migrations/0031_billing_adjustment_evidence_integrity.sql",
    ), "utf8");

    expect(migration).toContain("Migration 0031 blocked");
    expect(migration).toContain('ADD COLUMN "ledger_entry_id" text');
    expect(migration).toContain('ADD COLUMN "audit_log_id" text');
    expect(migration).toContain("audit_logs_tenant_id_id_unique_idx");
    expect(migration).toContain("billing_release_drill_operation_evidence_ledger_entry_fk");
    expect(migration).toContain("billing_release_drill_operation_evidence_audit_log_fk");
    expect(migration).toContain(
      "billing_release_drill_operation_evidence_adjustment_source_integrity_check",
    );
    expect(migration.indexOf("audit_logs_tenant_id_id_unique_idx")).toBeLessThan(
      migration.indexOf("billing_release_drill_operation_evidence_audit_log_fk"),
    );
  });

  it("ships a guarded rollback before 0030", async () => {
    const rollback = await readFile(resolve(
      root,
      "docs/Runbooks/rollback-0031-billing-adjustment-evidence-integrity.sql",
    ), "utf8");
    const workflow = await readFile(resolve(root, ".github/workflows/migration-check.yml"), "utf8");

    expect(rollback.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(rollback).toContain("Rollback 0031 blocked");
    expect(rollback.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(workflow.indexOf("rollback-0031-billing-adjustment-evidence-integrity.sql"))
      .toBeLessThan(workflow.indexOf("rollback-0030-billing-release-evidence-integrity.sql"));
  });
});
