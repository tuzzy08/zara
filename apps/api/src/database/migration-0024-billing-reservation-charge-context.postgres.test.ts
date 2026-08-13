import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.ZARA_TEST_POSTGRES_URL;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

describe.skipIf(connectionString === undefined)(
  "billing reservation charge context migration",
  () => {
    let pool: Pool;

    beforeAll(async () => {
      const { Pool: PostgresPool } = await import("pg");
      pool = new PostgresPool({ connectionString, max: 1 });
    });

    afterAll(async () => {
      if (pool !== undefined) await pool.end();
    });

    it("requires immutable context pins and runs the guarded rollback when unused", async () => {
      const [migration, rollback] = await Promise.all([
        readFile(resolve(
          repositoryRoot,
          "apps/api/src/database/migrations/0024_billing_reservation_charge_context.sql",
        ), "utf8"),
        readFile(resolve(
          repositoryRoot,
          "docs/Runbooks/rollback-0024-billing-reservation-charge-context.sql",
        ), "utf8"),
      ]);
      const schema = `migration_0024_${randomUUID().replaceAll("-", "")}`;

      await pool.query(`create schema "${schema}"`);
      try {
        await pool.query(`set search_path to "${schema}", public`);
        await pool.query(`
          create table billing_charge_reservations (
            tenant_id text not null,
            id text not null,
            catalog_id text,
            status text not null,
            primary key (tenant_id, id)
          );
          create function billing_enforce_reservation_catalog_pin()
          returns trigger language plpgsql as $$
          begin
            if TG_OP = 'INSERT' and NEW.catalog_id is null then
              raise exception 'New billing reservations require a catalog pin';
            end if;
            if TG_OP = 'UPDATE' and NEW.catalog_id is distinct from OLD.catalog_id then
              raise exception 'Billing reservation catalog pins are immutable';
            end if;
            return NEW;
          end;
          $$;
          create trigger billing_charge_reservations_catalog_pin_trigger
          before insert or update on billing_charge_reservations
          for each row execute function billing_enforce_reservation_catalog_pin();
          insert into billing_charge_reservations (tenant_id, id, catalog_id, status)
          values ('tenant-legacy', 'reservation-legacy', 'catalog-v1', 'active');
        `);

        await pool.query(migration);
        await pool.query(
          "update billing_charge_reservations set status = 'expired' where id = 'reservation-legacy'",
        );
        await expectFailure(
          pool,
          `insert into billing_charge_reservations (tenant_id, id, catalog_id, status)
           values ('tenant-new', 'reservation-missing-context', 'catalog-v1', 'active')`,
          "New billing reservations require a charge context pin",
        );
        await pool.query(
          `insert into billing_charge_reservations (
             tenant_id, id, catalog_id, charge_context, status
           ) values (
             'tenant-new', 'reservation-pinned', 'catalog-v1',
             '{"runtimePath":"pstn-sandwich","ownershipMode":"byo","provider":"twilio","direction":"outbound"}'::jsonb,
             'active'
           )`,
        );
        await expectFailure(
          pool,
          `update billing_charge_reservations
           set charge_context = '{"runtimePath":"pstn-premium-realtime"}'::jsonb
           where id = 'reservation-pinned'`,
          "Billing reservation charge context pins are immutable",
        );
        await expectFailure(
          pool,
          rollback,
          "Rollback 0024 blocked",
        );

        await pool.query("delete from billing_charge_reservations");
        await pool.query(rollback);
        const column = await pool.query(
          `select 1 from information_schema.columns
           where table_schema = $1 and table_name = 'billing_charge_reservations'
             and column_name = 'charge_context'`,
          [schema],
        );
        expect(column.rowCount).toBe(0);
      } finally {
        await pool.query("set search_path to public");
        await pool.query(`drop schema if exists "${schema}" cascade`);
      }
    });
  },
);

async function expectFailure(pool: Pool, sql: string, message: string) {
  await pool.query("begin");
  let error: unknown;
  try {
    await pool.query(sql);
  } catch (caught) {
    error = caught;
  }
  await pool.query("rollback");
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain(message);
}
