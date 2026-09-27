import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresBillingLedgerRepository, type BillingLedgerEntry, type BillingOutboxEntry } from "./postgres-billing-ledger.repository";

describe.skipIf(!process.env.ZARA_TEST_POSTGRES_URL)("new-usage delivery on PostgreSQL", () => {
  const schema = `billing_delivery_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool;
  let pool: Pool;
  let repository: PostgresBillingLedgerRepository;

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.ZARA_TEST_POSTGRES_URL });
    await admin.query(`create schema "${schema}"`);
    pool = new Pool({ connectionString: process.env.ZARA_TEST_POSTGRES_URL, options: `-c search_path=${schema}` });
    await pool.query(`
      create table billing_delivery_decisions (id text primary key, sequence bigserial, enabled boolean,
        catalog_id text, release_id text, effective_at timestamptz);
      create table billing_ledger_entries (tenant_id text, id text, idempotency_key text,
        entry_type text, catalog_id text, currency text, customer_amount_minor bigint,
        supplier_cost_minor bigint, quantity bigint, unit text, occurred_at timestamptz,
        metadata jsonb, created_at timestamptz, primary key(tenant_id,id), unique(tenant_id,idempotency_key));
      create table billing_outbox (tenant_id text, id text, aggregate_type text, aggregate_id text,
        event_type text, payload jsonb, status text, attempt_count integer, next_attempt_at timestamptz,
        last_error text, created_at timestamptz, delivered_at timestamptz, delivery_decision_id text,
        charge_release_id text, charge_promoted_at timestamptz, primary key(tenant_id,id));
      insert into billing_delivery_decisions values
        ('enable-1',1,true,'catalog-1','release-1','2026-09-27T00:00:00.000500Z');
    `);
    repository = new PostgresBillingLedgerRepository(pool);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  });

  it("preserves the exact database cutoff and never revives earlier decisions", async () => {
    await append("before-cutoff", "2026-09-27T00:00:00.000Z");
    await append("after-cutoff", "2026-09-27T00:00:00.001Z");
    const claimed = await repository.claimDueOutbox("2026-09-27T00:03:00Z", 10, "2026-09-27T00:04:00Z", "release-1");
    expect(claimed.map((entry) => entry.id)).toEqual(["after-cutoff"]);
    await repository.markOutboxDelivered("tenant-1", "after-cutoff", "2026-09-27T00:03:01Z");
    await append("after-cutoff", "2026-09-27T00:00:00.001Z");
    await append("unsent-old-decision", "2026-09-27T00:00:01Z");
    await pool.query(`insert into billing_delivery_decisions values ('stop',2,false,null,null,'2026-09-27T00:05:00Z')`);
    expect(await repository.claimDueOutbox("2026-09-27T00:06:00Z", 10, "2026-09-27T00:07:00Z", "release-1")).toEqual([]);
    await pool.query(`insert into billing_delivery_decisions values ('enable-2',3,true,'catalog-1','release-1','2026-09-27T00:08:00Z')`);
    await append("delayed-historical", "2026-09-27T00:00:01Z");
    expect(await repository.claimDueOutbox("2026-09-27T00:09:00Z", 10, "2026-09-27T00:10:00Z", "release-1")).toEqual([]);
    expect((await repository.listLedgerEntries("tenant-1")).filter((entry) => entry.id === "after-cutoff")).toHaveLength(1);
  });

  async function append(id: string, usageStartedAt: string) {
    const ledgerEntry: BillingLedgerEntry = {
      id, organizationId: "tenant-1", idempotencyKey: id, entryType: "runtime_charge",
      catalogId: "catalog-1", currency: "usd", customerAmountMinor: 18, quantity: 60, unit: "second",
      occurredAt: "2026-09-27T00:02:00.000Z", createdAt: "2026-09-27T00:02:00.000Z",
      metadata: { usageStartedAt, billingDisposition: "shadow", commercialMode: "subscription" },
    };
    const outboxEntry: BillingOutboxEntry = {
      id, organizationId: "tenant-1", aggregateType: "billing_ledger_entry", aggregateId: id,
      eventType: "polar.usage.report", payload: { deliveryMode: "shadow", quantity: 60 }, status: "pending",
      attemptCount: 0, nextAttemptAt: ledgerEntry.createdAt, createdAt: ledgerEntry.createdAt,
    };
    return repository.appendLedgerEntryWithOutbox({ ledgerEntry, outboxEntry });
  }
});
