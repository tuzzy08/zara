import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.ZARA_TEST_POSTGRES_URL;

describe.skipIf(connectionString === undefined)("subscription reservation schema", () => {
  let pool: Pool;

  beforeAll(async () => {
    const { Pool: PostgresPool } = await import("pg");
    pool = new PostgresPool({ connectionString, max: 1 });
  });
  afterAll(async () => { if (pool !== undefined) await pool.end(); });

  it("enforces the production reservation keys and non-negative claims", async () => {
    await expect(pool.query(`select plan_slug from billing_subscriptions limit 0`)).resolves.toBeDefined();
    await expect(pool.query(`select * from billing_platform_risk_limits limit 0`)).resolves.toBeDefined();
    await expect(pool.query(`select * from billing_subscription_reservation_accounts limit 0`)).resolves.toBeDefined();
    await expect(pool.query(`select * from billing_subscription_call_reservations limit 0`)).resolves.toBeDefined();

    await pool.query("begin");
    try {
      await expect(pool.query(
        `insert into billing_subscription_reservation_accounts
           (tenant_id, cycle_id, meter_class, reserved_included_seconds, reserved_overage_minor, updated_at)
         values ('missing-tenant', 'missing-cycle', 'standard', -1, 0, now())`,
      )).rejects.toThrow();
    } finally {
      await pool.query("rollback");
    }
  });
});
