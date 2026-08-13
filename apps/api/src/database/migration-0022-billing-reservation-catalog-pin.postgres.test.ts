import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.ZARA_TEST_POSTGRES_URL;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

describe.skipIf(connectionString === undefined)(
  "billing reservation catalog pin migration",
  () => {
    let pool: Pool;

    beforeAll(async () => {
      const { Pool: PostgresPool } = await import("pg");
      pool = new PostgresPool({ connectionString, max: 1 });
    });

    afterAll(async () => {
      if (pool !== undefined) await pool.end();
    });

    it("keeps legacy rows explicit and requires immutable pins on new rows", async () => {
      const migration = await readFile(
        resolve(
          repositoryRoot,
          "apps/api/src/database/migrations/0022_billing_reservation_catalog_pin.sql",
        ),
        "utf8",
      );
      const suffix = randomUUID().replaceAll("-", "");
      const schema = `migration_0022_${suffix}`;
      const catalogOne = `migration-0022-catalog-one-${suffix}`;
      const catalogTwo = `migration-0022-catalog-two-${suffix}`;

      await pool.query("begin");
      try {
        await pool.query("select pg_advisory_xact_lock(2460022)");
        const versionResult = await pool.query(
          "select coalesce(max(version), 0) + 1 as next_version from public.billing_price_catalogs",
        );
        const firstVersion = Number(versionResult.rows[0]?.next_version);
        await pool.query(`create schema "${schema}"`);
        await pool.query(`set local search_path to "${schema}", public`);
        await pool.query(
          `create table billing_charge_reservations (
             tenant_id text not null,
             id text not null,
             status text not null,
             primary key (tenant_id, id)
           )`,
        );
        await pool.query(
          `insert into billing_charge_reservations (tenant_id, id, status)
           values ('tenant-legacy', 'reservation-legacy', 'active')`,
        );
        for (const [id, version] of [
          [catalogOne, firstVersion],
          [catalogTwo, firstVersion + 1],
        ] as const) {
          await pool.query(
            `insert into public.billing_price_catalogs (
               id, version, status, currency, effective_from, checksum,
               catalog_document, approved_by, approved_at, created_at
             ) values (
               $1, $2, 'active', 'usd', current_timestamp, $3,
               '{}'::jsonb, 'migration-test', current_timestamp, current_timestamp
             )`,
            [id, version, "a".repeat(64)],
          );
        }

        await pool.query(migration);

        await pool.query(
          `update billing_charge_reservations
           set status = 'expired'
           where tenant_id = 'tenant-legacy' and id = 'reservation-legacy'`,
        );
        await expectQueryFailure(
          pool,
          "legacy_pin",
          `update billing_charge_reservations
           set catalog_id = $1
           where tenant_id = 'tenant-legacy' and id = 'reservation-legacy'`,
          [catalogOne],
          "Billing reservation catalog pins are immutable",
        );
        await expectQueryFailure(
          pool,
          "missing_pin",
          `insert into billing_charge_reservations (tenant_id, id, status)
           values ('tenant-new', 'reservation-without-pin', 'active')`,
          [],
          "New billing reservations require a catalog pin",
        );
        await pool.query(
          `insert into billing_charge_reservations (tenant_id, id, status, catalog_id)
           values ('tenant-new', 'reservation-pinned', 'active', $1)`,
          [catalogOne],
        );
        await expectQueryFailure(
          pool,
          "changed_pin",
          `update billing_charge_reservations
           set catalog_id = $1
           where tenant_id = 'tenant-new' and id = 'reservation-pinned'`,
          [catalogTwo],
          "Billing reservation catalog pins are immutable",
        );

        await expect(pool.query(
          `select tenant_id, id, catalog_id
           from billing_charge_reservations
           order by tenant_id`,
        )).resolves.toMatchObject({
          rows: [
            {
              tenant_id: "tenant-legacy",
              id: "reservation-legacy",
              catalog_id: null,
            },
            {
              tenant_id: "tenant-new",
              id: "reservation-pinned",
              catalog_id: catalogOne,
            },
          ],
        });
      } finally {
        await pool.query("rollback");
      }
    });
  },
);

async function expectQueryFailure(
  pool: Pool,
  savepoint: string,
  sql: string,
  parameters: unknown[],
  message: string,
) {
  await pool.query(`savepoint ${savepoint}`);
  let error: unknown;
  try {
    await pool.query(sql, parameters);
  } catch (caught) {
    error = caught;
  }
  await pool.query(`rollback to savepoint ${savepoint}`);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain(message);
}
