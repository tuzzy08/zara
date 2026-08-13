import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { newDb } from "pg-mem";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BillingChargeReservationRepository } from "../billing/billing-charge-reservation.repository";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const migrationPath = resolve(
  repositoryRoot,
  "apps/api/src/database/migrations/0026_terminal_billing_recovery.sql",
);
const rollbackPath = resolve(
  repositoryRoot,
  "docs/Runbooks/rollback-0026-terminal-billing-recovery.sql",
);
const migration0025Path = resolve(
  repositoryRoot,
  "apps/api/src/database/migrations/0025_subscription_payg_pins.sql",
);
const connectionString = process.env.ZARA_TEST_POSTGRES_URL;

describe("terminal billing recovery migration", () => {
  it("ships a guarded rollback", async () => {
    const rollback = await readFile(rollbackPath, "utf8");
    expect(rollback.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(rollback.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("creates tenant-qualified durable recovery and global subscription overage accounts", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const database = newDb();
    database.public.none(`
      create table tenants (id text primary key);
      create table billing_cycles (
        tenant_id text not null,
        id text not null,
        primary key (tenant_id, id)
      );
      create table billing_subscription_call_reservations (
        tenant_id text not null,
        id text not null,
        cycle_id text not null,
        status text not null,
        reserved_overage_minor bigint not null,
        updated_at timestamptz not null,
        primary key (tenant_id, id)
      );
      insert into tenants (id) values ('tenant-1');
      insert into billing_cycles (tenant_id, id) values ('tenant-1', 'cycle-1');
      insert into billing_subscription_call_reservations values
        ('tenant-1', 'active-1', 'cycle-1', 'active', 12, '2026-08-11T09:59:00.000Z'),
        ('tenant-1', 'finalized-1', 'cycle-1', 'finalized', 99, '2026-08-11T09:58:00.000Z')
    `);

    database.public.none(migration.replaceAll("--> statement-breakpoint", ""));
    database.public.none(`
      insert into billing_terminal_recovery_jobs (
        tenant_id, id, idempotency_key, call_session_id, reservation_id,
        commercial_mode, usage_fact, settlement_fact, status, attempt_count,
        next_attempt_at, created_at, updated_at
      ) values (
        'tenant-1', 'job-1', 'terminal:call-1', 'call-1', 'reservation-1',
        'payg', '{}', '{}', 'pending', 0,
        '2026-08-11T10:00:00.000Z', '2026-08-11T10:00:00.000Z',
        '2026-08-11T10:00:00.000Z'
      )
    `);
    expect(database.public.one(`
      select reserved_overage_minor from billing_subscription_overage_accounts
      where tenant_id = 'tenant-1' and cycle_id = 'cycle-1'
    `)).toMatchObject({ reserved_overage_minor: 12 });
    expect(database.public.many(`
      select column_name from information_schema.columns
      where table_name = 'billing_terminal_recovery_jobs'
        and column_name in ('lease_token', 'dead_lettered_at', 'payg_applied_minor')
      order by column_name
    `)).toEqual([
      { column_name: "dead_lettered_at" },
      { column_name: "lease_token" },
      { column_name: "payg_applied_minor" },
    ]);

    expect(() => database.public.none(`
      insert into billing_terminal_recovery_jobs (
        tenant_id, id, idempotency_key, call_session_id, reservation_id,
        commercial_mode, usage_fact, settlement_fact, status, attempt_count,
        next_attempt_at, created_at, updated_at
      ) values (
        'tenant-1', 'job-2', 'terminal:call-1', 'call-2', 'reservation-2',
        'payg', '{}', '{}', 'pending', 0,
        '2026-08-11T10:00:00.000Z', '2026-08-11T10:00:00.000Z',
        '2026-08-11T10:00:00.000Z'
      )
    `)).toThrow();
    expect(() => database.public.none(`
      update billing_subscription_overage_accounts
      set reserved_overage_minor = -1
      where tenant_id = 'tenant-1' and cycle_id = 'cycle-1'
    `)).toThrow();
    database.public.none(`delete from tenants where id = 'tenant-1'`);
    expect(database.public.many(`select * from billing_terminal_recovery_jobs`)).toEqual([]);
  });
});

describe.skipIf(connectionString === undefined)("terminal billing recovery PostgreSQL chain", () => {
  let pool: Pool;

  beforeAll(async () => {
    const { Pool: PostgresPool } = await import("pg");
    pool = new PostgresPool({ connectionString, max: 2 });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("applies 0025 then 0026, protects pending PAYG expiry, and guards rollback", async () => {
    const [migration0025, migration0026, rollback] = await Promise.all([
      readFile(migration0025Path, "utf8"),
      readFile(migrationPath, "utf8"),
      readFile(rollbackPath, "utf8"),
    ]);
    const schema = `migration_0026_${randomUUID().replaceAll("-", "")}`;
    const client = await pool.connect();
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}", public`);
      await client.query(`
        create table tenants (id text primary key);
        create table billing_cycles (
          tenant_id text not null, id text not null,
          primary key (tenant_id, id)
        );
        create table billing_subscription_call_reservations (
          tenant_id text not null, id text not null, reservation_key text not null,
          subscription_id text not null, cycle_id text not null, catalog_id text not null,
          plan_slug text not null, meter_class text not null, status text not null,
          reserved_seconds bigint not null, reserved_included_seconds bigint not null,
          reserved_overage_minor bigint not null, billing_mode text not null,
          provider text not null, direction text not null, route_rate_id text,
          route_identity jsonb, route_rate_minor_per_minute bigint,
          reserved_telephony_minor bigint not null, expires_at timestamptz not null,
          actual_seconds bigint, actual_provider_connected_seconds bigint,
          session_id text, finalized_at timestamptz, created_at timestamptz not null,
          updated_at timestamptz not null,
          primary key (tenant_id, id),
          constraint billing_subscription_call_reservations_values_check
            check (reserved_seconds > 0 and reserved_included_seconds >= 0
              and reserved_included_seconds <= reserved_seconds and reserved_overage_minor >= 0)
        );
        create table billing_charge_reservations (
          tenant_id text not null, id text not null, reservation_key text not null,
          catalog_id text, charge_context jsonb, funding_source text not null,
          status text not null, reserved_amount_minor bigint not null,
          actual_amount_minor bigint, session_id text, currency text not null,
          expires_at timestamptz not null, finalized_at timestamptz,
          released_at timestamptz, created_at timestamptz not null,
          updated_at timestamptz not null, primary key (tenant_id, id),
          unique (tenant_id, reservation_key)
        );
        create table billing_payg_credit_entries (
          tenant_id text not null, id text not null, order_id text, session_id text,
          entry_type text not null, amount_minor bigint not null,
          idempotency_key text not null, expires_at timestamptz,
          created_at timestamptz not null, primary key (tenant_id, id),
          unique (tenant_id, idempotency_key)
        );
        create table billing_reservation_accounts (
          tenant_id text primary key, reserved_amount_minor bigint not null,
          updated_at timestamptz not null
        );
      `);
      await client.query(migration0025);
      await client.query(`
        insert into tenants values ('tenant-1');
        insert into billing_cycles values ('tenant-1', 'cycle-1');
        insert into billing_subscription_call_reservations (
          tenant_id,id,reservation_key,subscription_id,cycle_id,catalog_id,plan_slug,
          meter_class,status,reserved_seconds,reserved_included_seconds,reserved_payg_minor,
          reserved_overage_minor,billing_mode,provider,direction,reserved_telephony_minor,
          expires_at,created_at,updated_at
        ) values (
          'tenant-1','subscription-reservation','subscription-call:call-1','subscription-1',
          'cycle-1','catalog-v1','growth','standard','active',120,60,0,12,
          'byo','twilio','inbound',0,'2026-08-11T10:05:00Z',
          '2026-08-11T10:00:00Z','2026-08-11T10:00:00Z'
        );
      `);
      await client.query(migration0026);
      await client.query(`
        insert into billing_payg_credit_entries values (
          'tenant-1','grant-1',null,null,'grant',500,'grant-1',null,'2026-08-11T09:00:00Z'
        );
        insert into billing_reservation_accounts values (
          'tenant-1',400,'2026-08-11T10:00:00Z'
        );
        insert into billing_charge_reservations (
          tenant_id,id,reservation_key,catalog_id,charge_context,funding_source,status,
          reserved_amount_minor,currency,expires_at,created_at,updated_at
        ) values (
          'tenant-1','payg-reservation','payg-call:call-1','catalog-v1',
          '{"runtimePath":"pstn-sandwich","ownershipMode":"byo","provider":"twilio","direction":"inbound"}',
          'payg_credit','active',400,'usd','2026-08-11T10:05:00Z',
          '2026-08-11T10:00:00Z','2026-08-11T10:00:00Z'
        );
        insert into billing_terminal_recovery_jobs (
          tenant_id,id,idempotency_key,call_session_id,reservation_id,commercial_mode,
          usage_fact,settlement_fact,status,attempt_count,next_attempt_at,created_at,updated_at
        ) values (
          'tenant-1','job-1','terminal:call-1','call-1','payg-reservation','payg',
          '{}','{}','pending',1,'2026-08-11T10:05:30Z',
          '2026-08-11T10:04:59Z','2026-08-11T10:04:59Z'
        );
      `);

      const repository = new BillingChargeReservationRepository(
        fixedClientDatabase(client),
      );
      await expect(repository.reservePaygCredit({
        id: "replacement",
        organizationId: "tenant-1",
        reservationKey: "payg-call:replacement",
        catalogId: "catalog-v1",
        chargeContext: {
          runtimePath: "pstn-sandwich",
          ownershipMode: "byo",
          provider: "twilio",
          direction: "inbound",
        },
        amountMinor: 400,
        currency: "usd",
        expiresAt: "2026-08-11T10:10:00.000Z",
        now: "2026-08-11T10:05:00.000Z",
      })).resolves.toMatchObject({ outcome: "denied", availableMinor: 100 });
      await expectFailure(client, rollback, "Rollback 0026 blocked");
      const retained = await client.query(`select
        to_regclass('billing_terminal_recovery_jobs') job,
        to_regclass('billing_subscription_overage_accounts') account`);
      expect(retained.rows[0]?.job).not.toBeNull();
      expect(retained.rows[0]?.account).not.toBeNull();

      await client.query(`update billing_terminal_recovery_jobs
        set status='completed', completed_at='2026-08-11T10:06:00Z'
        where id='job-1'`);
      await client.query(`update billing_subscription_call_reservations
        set status='finalized' where id='subscription-reservation'`);
      await client.query(rollback);
      const tables = await client.query(`select to_regclass('billing_terminal_recovery_jobs') job,
        to_regclass('billing_subscription_overage_accounts') account`);
      expect(tables.rows[0]).toEqual({ job: null, account: null });
    } finally {
      await client.query("set search_path to public");
      await client.query(`drop schema if exists "${schema}" cascade`);
      client.release();
    }
  }, 30_000);
});

function fixedClientDatabase(client: PoolClient) {
  return {
    connect: async () => ({
      query: client.query.bind(client),
      release: () => undefined,
    } as unknown as PoolClient),
    query: client.query.bind(client),
  } as unknown as Pool;
}

async function expectFailure(client: PoolClient, sql: string, message: string) {
  await client.query("begin");
  let error: unknown;
  try {
    await client.query(sql);
  } catch (caught) {
    error = caught;
  }
  await client.query("rollback");
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain(message);
}
