import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("migration 0033 provider billing scopes", () => {
  it("creates an immutable tenant-qualified provider scope table", () => {
    const sql = readFileSync(resolve(
      process.cwd(),
      "apps/api/src/database/migrations/0033_provider_billing_scopes.sql",
    ), "utf8");
    expect(sql).toContain("CREATE TABLE \"billing_provider_tenant_scopes\"");
    expect(sql).toContain("billing_provider_tenant_scopes_provider_check");
    expect(sql).toContain("billing_provider_tenant_scopes_immutable");
    expect(sql).toContain("OLD.effective_until IS NULL");
    expect(sql).toContain("NEW.effective_until IS NOT NULL");
  });
});
