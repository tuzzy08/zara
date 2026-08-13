import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

describe("billing charge promotion migration", () => {
  it("adds immutable promotion and drill operation evidence", async () => {
    const migration = await readFile(resolve(
      root,
      "apps/api/src/database/migrations/0029_short_hulk.sql",
    ), "utf8");

    expect(migration).toContain('CREATE TABLE "billing_charge_promotion_records"');
    expect(migration).toContain('CREATE TABLE "billing_release_drill_operation_evidence"');
    expect(migration.match(/prevent_billing_immutable_mutation/g)).toHaveLength(2);
  });

  it("ships a guarded rollback that refuses to remove evidence", async () => {
    const rollback = await readFile(resolve(
      root,
      "docs/Runbooks/rollback-0029-billing-charge-promotion.sql",
    ), "utf8");

    expect(rollback.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(rollback).toContain("Rollback 0029 blocked");
    expect(rollback.trimEnd().endsWith("COMMIT;")).toBe(true);
  });
});
