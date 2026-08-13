import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

describe("billing release evidence integrity migration", () => {
  it("adds durable provider evidence and typed drill execution evidence", async () => {
    const migration = await readFile(resolve(
      root,
      "apps/api/src/database/migrations/0030_billing_release_evidence_integrity.sql",
    ), "utf8");

    expect(migration).toContain('CREATE TABLE "billing_provider_evidence_reports"');
    expect(migration).toContain('CREATE TABLE "billing_release_drill_execution_records"');
    expect(migration).toContain("Migration 0030 blocked");
    expect(migration.indexOf("Migration 0030 blocked")).toBeLessThan(
      migration.indexOf('CREATE TABLE "billing_provider_evidence_reports"'),
    );
    expect(migration).toContain('ADD COLUMN "source_type" text NOT NULL');
    expect(migration).toContain('ADD COLUMN "source_record_id" text NOT NULL');
    expect(migration).toContain("billing_release_drill_operation_evidence_source_integrity_check");
    expect(migration).toContain("billing_release_drill_operation_evidence_execution_record_fk");
    expect(migration.match(/prevent_billing_immutable_mutation/g)).toHaveLength(2);
  });

  it("ships a guarded rollback and applies it before 0029", async () => {
    const rollback = await readFile(resolve(
      root,
      "docs/Runbooks/rollback-0030-billing-release-evidence-integrity.sql",
    ), "utf8");
    const workflow = await readFile(resolve(root, ".github/workflows/migration-check.yml"), "utf8");

    expect(rollback.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(rollback).toContain("Rollback 0030 blocked");
    expect(rollback.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(workflow.indexOf("rollback-0030-billing-release-evidence-integrity.sql"))
      .toBeLessThan(workflow.indexOf("rollback-0029-billing-charge-promotion.sql"));
  });
});
