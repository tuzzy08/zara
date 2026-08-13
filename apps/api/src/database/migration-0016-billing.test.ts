import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const migrationPath = "apps/api/src/database/migrations/0016_panoramic_hobgoblin.sql";
const rollbackPath = "docs/Runbooks/rollback-0016-production-billing.sql";

describe("production billing migration 0016", () => {
  it("creates immutable financial tables and a guarded rollback", () => {
    const migration = readFileSync(resolve(repositoryRoot, migrationPath), "utf8");
    const rollback = readFileSync(resolve(repositoryRoot, rollbackPath), "utf8");
    const workflow = readFileSync(
      resolve(repositoryRoot, ".github/workflows/migration-check.yml"),
      "utf8",
    );

    expect(migration).toContain('CREATE TABLE "billing_price_catalogs"');
    expect(migration).toContain('CREATE TABLE "billing_ledger_entries"');
    expect(migration).toContain('CREATE TABLE "billing_payg_credit_entries"');
    expect(migration).toContain("CREATE FUNCTION prevent_billing_immutable_mutation");
    expect(migration).toContain("billing_price_catalogs_immutable_trigger");
    expect(migration).toContain("billing_ledger_entries_immutable_trigger");
    expect(rollback).toContain("Rollback blocked: production billing data exists");
    for (const table of [
      "billing_adjustments",
      "billing_budget_policies",
      "billing_customers",
      "billing_cycles",
      "billing_entitlements",
      "billing_invoices",
      "billing_ledger_entries",
      "billing_outbox",
      "billing_payg_credit_entries",
      "billing_payg_orders",
      "billing_polar_mappings",
      "billing_price_catalogs",
      "billing_subscriptions",
      "billing_tenant_states",
      "billing_webhook_receipts",
    ]) {
      expect(rollback).toContain(`SELECT 1 FROM ${table}`);
    }
    expect(rollback).toContain('DROP TABLE IF EXISTS "billing_price_catalogs"');
    expect(workflow).toContain(rollbackPath);
    expect(workflow.indexOf("await pool.query(billingRollback);")).toBeLessThan(
      workflow.indexOf("await pool.query(premiumOwnerLeaseRollback);"),
    );
    expect(workflow).toContain("billing_tables_removed");
  });
});
