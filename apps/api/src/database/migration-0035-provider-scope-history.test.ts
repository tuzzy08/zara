import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("migration 0035 provider scope history", () => {
  it("allows one tenant to keep scope history and blocks another tenant", () => {
    const sql = readFileSync(resolve(process.cwd(),
      "apps/api/src/database/migrations/0035_provider_scope_history.sql"), "utf8");
    expect(sql).toContain("DROP INDEX");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("existing.tenant_id <> NEW.tenant_id");
    expect(sql).not.toContain("ADD CONSTRAINT \"billing_provider_tenant_scopes_external_scope_check\"");
  });
});
