import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.ZARA_TEST_POSTGRES_URL;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const migrationPath = resolve(repositoryRoot,
  "apps/api/src/database/migrations/0025_subscription_payg_pins.sql");
const rollbackPath = resolve(repositoryRoot,
  "docs/Runbooks/rollback-0025-subscription-payg-pins.sql");

describe("subscription PAYG pin migration artifacts", () => {
  it("ships an append-only migration and guarded rollback", async () => {
    await expect(Promise.all([readFile(migrationPath, "utf8"), readFile(rollbackPath, "utf8")]))
      .resolves.toEqual([expect.any(String), expect.any(String)]);
  });
});

describe.skipIf(connectionString === undefined)("subscription PAYG pin migration", () => {
  let pool: Pool;

  beforeAll(async () => {
    const { Pool: PostgresPool } = await import("pg");
    pool = new PostgresPool({ connectionString, max: 1 });
  });
  afterAll(async () => { if (pool !== undefined) await pool.end(); });

  it("pins PAYG funding and commercial route facts and guards rollback", async () => {
    const [migration, rollback] = await Promise.all([
      readFile(migrationPath, "utf8"), readFile(rollbackPath, "utf8"),
    ]);
    const schema = `migration_0025_${randomUUID().replaceAll("-", "")}`;
    await pool.query(`create schema "${schema}"`);
    try {
      await pool.query(`set search_path to "${schema}", public`);
      await pool.query(`create table billing_subscription_call_reservations (
        tenant_id text not null, id text not null, subscription_id text not null, cycle_id text not null,
        catalog_id text not null, plan_slug text not null, meter_class text not null, status text not null,
        reserved_seconds bigint not null, reserved_included_seconds bigint not null,
        reserved_overage_minor bigint not null, billing_mode text not null, provider text not null,
        direction text not null, route_rate_id text, route_identity jsonb,
        route_rate_minor_per_minute bigint, reserved_telephony_minor bigint not null,
        primary key (tenant_id, id)
      )`);
      await pool.query(`create table billing_charge_reservations (
        tenant_id text not null, id text not null,
        primary key (tenant_id, id)
      )`);
      await pool.query(migration);
      await pool.query(`insert into billing_subscription_call_reservations values (
        'tenant-1','reservation-1','subscription-1','cycle-1','catalog-v1','growth','standard','active',
        120,60,12,'byo','twilio','outbound',null,null,null,0,12
      )`);
      await expectFailure(pool,
        `update billing_subscription_call_reservations set catalog_id = 'catalog-v2' where id = 'reservation-1'`,
        "Subscription reservation financial pins are immutable");
      await pool.query(`update billing_subscription_call_reservations
        set terminal_outcome = 'transferred' where id = 'reservation-1'`);
      await expectFailure(pool,
        `update billing_subscription_call_reservations set terminal_outcome = 'completed' where id = 'reservation-1'`,
        "Subscription reservation terminal outcome is immutable");
      await pool.query(`insert into billing_charge_reservations
        (tenant_id, id, terminal_outcome) values ('tenant-1', 'payg-1', null)`);
      await pool.query(`update billing_charge_reservations
        set terminal_outcome = 'transferred' where id = 'payg-1'`);
      await expectFailure(pool,
        `update billing_charge_reservations set terminal_outcome = 'completed' where id = 'payg-1'`,
        "PAYG reservation terminal outcome is immutable");
      await expectFailure(pool,
        `update billing_charge_reservations set terminal_outcome = null where id = 'payg-1'`,
        "PAYG reservation terminal outcome is immutable");
      await expectFailure(pool, rollback, "Rollback 0025 blocked");
      await pool.query(`delete from billing_subscription_call_reservations`);
      await pool.query(`delete from billing_charge_reservations`);
      await pool.query(rollback);
      const column = await pool.query(`select 1 from information_schema.columns
        where table_schema = $1 and table_name = 'billing_subscription_call_reservations'
          and column_name = 'reserved_payg_minor'`, [schema]);
      expect(column.rowCount).toBe(0);
    } finally {
      await pool.query("set search_path to public");
      await pool.query(`drop schema if exists "${schema}" cascade`);
    }
  });
});

async function expectFailure(pool: Pool, sql: string, message: string) {
  await pool.query("begin");
  let error: unknown;
  try { await pool.query(sql); } catch (caught) { error = caught; }
  await pool.query("rollback");
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain(message);
}
