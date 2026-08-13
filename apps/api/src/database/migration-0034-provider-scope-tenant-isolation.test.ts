import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("migration 0034 provider scope tenant isolation", () => {
  it("prevents one provider scope from belonging to two tenants", () => {
    const sql = readFileSync(resolve(
      process.cwd(),
      "apps/api/src/database/migrations/0034_provider_scope_tenant_isolation.sql",
    ), "utf8");
    expect(sql).toContain("billing_provider_tenant_scopes_provider_external_scope_unique_idx");
    expect(sql).toContain('("provider","external_scope_id")');
    const rollback = readFileSync(resolve(
      process.cwd(),
      "docs/Runbooks/rollback-0034-provider-scope-tenant-isolation.sql",
    ), "utf8");
    expect(rollback).toContain("rollback 0034 blocked: provider billing scopes exist");
  });
});
