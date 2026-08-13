import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.ZARA_TEST_POSTGRES_URL;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

describe.skipIf(connectionString === undefined)(
  "billing release evidence integrity PostgreSQL upgrade",
  () => {
    let pool: Pool;

    beforeAll(async () => {
      const { Pool: PostgresPool } = await import("pg");
      pool = new PostgresPool({ connectionString, max: 1 });
    });

    afterAll(async () => pool?.end());

    it("aborts clearly before ALTER when pre-0030 drill evidence exists", async () => {
      const schema = `migration_0030_guard_${randomUUID().replaceAll("-", "")}`;
      const migration = await scopedMigration(schema);
      await pool.query(`create schema "${schema}"`);
      try {
        await bootstrap0029(pool, schema);
        await pool.query(`insert into "${schema}".billing_release_drill_operation_evidence (
          tenant_id,id,run_id,release_id,catalog_id,drill_id,evidence_hash,
          operation_record_ids,observed_result,executed_at,created_at
        ) values (
          'tenant-1','evidence-1','run-1','release-1','catalog-1','top_up',
          repeat('a',64),'["order-1"]','{}',now(),now()
        )`);

        await expectMigrationFailure(pool, migration, "Migration 0030 blocked");
        const columns = await pool.query(`select column_name from information_schema.columns
          where table_schema = $1 and table_name = 'billing_release_drill_operation_evidence'
            and column_name in ('source_type', 'source_record_id')`, [schema]);
        expect(columns.rowCount).toBe(0);
      } finally {
        await pool.query(`drop schema if exists "${schema}" cascade`);
      }
    });

    it("upgrades an empty pre-0030 evidence table", async () => {
      const schema = `migration_0030_empty_${randomUUID().replaceAll("-", "")}`;
      const migration = await scopedMigration(schema);
      await pool.query(`create schema "${schema}"`);
      try {
        await bootstrap0029(pool, schema);
        await pool.query(migration);
        const columns = await pool.query(`select column_name from information_schema.columns
          where table_schema = $1 and table_name = 'billing_release_drill_operation_evidence'
            and column_name in ('source_type', 'source_record_id')
          order by column_name`, [schema]);
        expect(columns.rows).toEqual([
          { column_name: "source_record_id" },
          { column_name: "source_type" },
        ]);
        const tables = await pool.query(`select table_name from information_schema.tables
          where table_schema = $1 and table_name in (
            'billing_provider_evidence_reports', 'billing_release_drill_execution_records'
          ) order by table_name`, [schema]);
        expect(tables.rows).toEqual([
          { table_name: "billing_provider_evidence_reports" },
          { table_name: "billing_release_drill_execution_records" },
        ]);
      } finally {
        await pool.query(`drop schema if exists "${schema}" cascade`);
      }
    });
  },
);

async function scopedMigration(schema: string) {
  const migration = await readFile(resolve(
    repositoryRoot,
    "apps/api/src/database/migrations/0030_billing_release_evidence_integrity.sql",
  ), "utf8");
  return `set search_path to "${schema}";\n${migration.replaceAll('"public".', `"${schema}".`)}`;
}

async function bootstrap0029(pool: Pool, schema: string) {
  await pool.query(`set search_path to "${schema}"`);
  await pool.query(`
    create function prevent_billing_immutable_mutation() returns trigger language plpgsql as $$
    begin raise exception 'immutable'; end $$;
    create table tenants (id text primary key);
    create table billing_price_catalogs (id text primary key);
    create table billing_payg_orders (tenant_id text, id text, primary key (tenant_id,id));
    create table billing_payg_credit_entries (tenant_id text, id text, primary key (tenant_id,id));
    create table billing_charge_reservations (tenant_id text, id text, primary key (tenant_id,id));
    create table billing_outbox (tenant_id text, id text, primary key (tenant_id,id));
    create table billing_adjustments (tenant_id text, id text, primary key (tenant_id,id));
    create table billing_reconciliation_reports (tenant_id text, id text, primary key (tenant_id,id));
    create table billing_charge_release_controls (environment text primary key);
    create table billing_release_drill_operation_evidence (
      tenant_id text not null, id text not null, run_id text not null,
      release_id text not null, catalog_id text not null, drill_id text not null,
      evidence_hash text not null, operation_record_ids jsonb not null,
      observed_result jsonb not null, executed_at timestamptz not null,
      created_at timestamptz not null, primary key (tenant_id,id)
    );
    insert into tenants values ('tenant-1');
    insert into billing_price_catalogs values ('catalog-1');
  `);
}

async function expectMigrationFailure(pool: Pool, migration: string, message: string) {
  await pool.query("begin");
  let error: unknown;
  try {
    await pool.query(migration);
  } catch (caught) {
    error = caught;
  }
  await pool.query("rollback");
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain(message);
}
