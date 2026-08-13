import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const migrationPath = resolve(
  repositoryRoot,
  "apps/api/src/database/migrations/0028_living_the_enforcers.sql",
);
const rollbackPath = resolve(
  repositoryRoot,
  "docs/Runbooks/rollback-0028-billing-release-evidence.sql",
);

describe("billing release evidence migration", () => {
  it("adds immutable scoped evidence and explicit outbox promotion without data promotion", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE "billing_charge_release_approvals"');
    expect(migration).toContain('CREATE TABLE "billing_release_canary_reports"');
    expect(migration).toContain('CREATE TABLE "billing_reconciliation_reports"');
    expect(migration).toContain('CREATE TABLE "billing_release_drill_reports"');
    expect(migration.match(/prevent_billing_immutable_mutation/g)).toHaveLength(4);
    expect(migration).toContain('ADD COLUMN "charge_release_id" text');
    expect(migration).toContain('ADD COLUMN "charge_promoted_at" timestamp with time zone');
    expect(migration.toLowerCase()).not.toContain("update billing_outbox");
  });

  it("ships a guarded rollback that preserves evidence and promoted outbox facts", async () => {
    const rollback = await readFile(rollbackPath, "utf8");

    expect(rollback.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(rollback).toContain("Rollback 0028 blocked");
    expect(rollback).toContain("charge_release_id is not null");
    expect(rollback.trimEnd().endsWith("COMMIT;")).toBe(true);
  });
});
