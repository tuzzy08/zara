import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("migration 0036 billing cycle UTC days", () => {
  it("blocks existing partial days before it adds the UTC-midnight constraint", () => {
    const sql = readFileSync(resolve(process.cwd(),
      "apps/api/src/database/migrations/0036_billing_cycles_utc_days.sql"), "utf8");

    expect(sql).toContain("existing billing cycle has a partial UTC day");
    expect(sql).toContain("date_trunc('day', starts_at AT TIME ZONE 'UTC')");
    expect(sql).toContain("date_trunc('day', ends_at AT TIME ZONE 'UTC')");
    expect(sql).toContain("ADD CONSTRAINT \"billing_cycles_utc_day_boundaries_check\"");
    expect(sql).not.toContain("UPDATE billing_cycles");
  });

  it("has a rollback that removes only the UTC-day constraint", () => {
    const sql = readFileSync(resolve(process.cwd(),
      "docs/Runbooks/rollback-0036-billing-cycles-utc-days.sql"), "utf8");

    expect(sql).toContain("DROP CONSTRAINT \"billing_cycles_utc_day_boundaries_check\"");
    expect(sql).not.toContain("DROP TABLE");
  });
});
