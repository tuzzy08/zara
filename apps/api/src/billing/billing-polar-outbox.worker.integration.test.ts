import { newDb } from "pg-mem";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditLogService } from "../compliance/audit-log.service";
import { FileAuditLogRepository } from "../compliance/audit-log.repository";
import { BillingOutboxOperationsService } from "./billing-outbox-operations.service";
import { BillingPolarOutboxWorker } from "./billing-polar-outbox.worker";
import { BillingOutboxObservability } from "./billing-outbox-observability";
import { PostgresBillingLedgerRepository } from "./postgres-billing-ledger.repository";

describe("BillingPolarOutboxWorker", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;

  beforeEach(() => {
    const database = newDb();
    database.public.none(`
      create table billing_ledger_entries (
        id text not null, tenant_id text not null, idempotency_key text not null,
        entry_type text not null, catalog_id text, currency text not null,
        customer_amount_minor bigint, supplier_cost_minor bigint, quantity bigint not null,
        unit text not null, occurred_at timestamptz not null, metadata jsonb not null,
        created_at timestamptz not null, primary key (tenant_id, id),
        unique (tenant_id, idempotency_key)
      );
      create table billing_outbox (
        tenant_id text not null, id text not null, aggregate_type text not null,
        aggregate_id text not null, event_type text not null, payload jsonb not null,
        status text not null, attempt_count integer not null default 0,
        next_attempt_at timestamptz not null, last_error text,
        created_at timestamptz not null, delivered_at timestamptz,
        charge_release_id text, charge_promoted_at timestamptz,
        primary key (tenant_id, id)
      );
      create table billing_payg_credit_entries (
        tenant_id text not null, id text not null, order_id text,
        session_id text, entry_type text not null, amount_minor bigint not null,
        idempotency_key text not null, expires_at timestamptz, created_at timestamptz not null,
        primary key (tenant_id, id), unique (tenant_id, idempotency_key)
      )
    `);
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool();
  });

  afterEach(async () => {
    await pool.end();
  });

  it("delivers one due event with its stable external ID and marks it delivered", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await seedUsage(repository, pool);
    const ingestUsageEvent = vi.fn(async () => ({ providerEventId: "polar_usage_entry-1" }));
    const worker = new BillingPolarOutboxWorker(
      repository,
      { ingestUsageEvent },
      {
      deliveryEnabled: true,
      releaseId: "release-248",
        batchSize: 10,
        maxAttempts: 3,
        retryDelayMs: 1_000,
      },
      undefined,
      allowDelivery,
    );

    await expect(worker.runOnce("2026-08-10T00:00:02.000Z")).resolves.toEqual({
      claimed: 1,
      delivered: 1,
      retried: 0,
      deadLettered: 0,
      disabled: false,
    });
    expect(ingestUsageEvent).toHaveBeenCalledWith({
      externalCustomerId: "tenant-a",
      externalId: "polar_usage_entry-1",
      name: "standard_runtime_seconds",
      units: 60,
      timestamp: "2026-08-10T00:00:00.000Z",
      metadata: {
        ledgerEntryId: "entry-1",
        deliveryMode: "charge",
      },
    });
    await expect(repository.listOutboxEntries("tenant-a")).resolves.toEqual([
      expect.objectContaining({
        id: "polar_usage_entry-1",
        status: "delivered",
        attemptCount: 1,
        deliveredAt: "2026-08-10T00:00:02.000Z",
      }),
    ]);
  });

  it("keeps a failed Polar delivery for retry without losing the ledger fact", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await seedUsage(repository, pool);
    const worker = new BillingPolarOutboxWorker(
      repository,
      { ingestUsageEvent: vi.fn(async () => { throw new Error("Polar unavailable"); }) },
      { deliveryEnabled: true, releaseId: "release-248", batchSize: 10, maxAttempts: 3, retryDelayMs: 1_000 },
      undefined,
      allowDelivery,
    );

    await expect(worker.runOnce("2026-08-10T00:00:02.000Z")).resolves.toEqual({
      claimed: 1,
      delivered: 0,
      retried: 1,
      deadLettered: 0,
      disabled: false,
    });
    await expect(repository.listLedgerEntries("tenant-a")).resolves.toHaveLength(1);
    await expect(repository.listOutboxEntries("tenant-a")).resolves.toEqual([
      expect.objectContaining({
        status: "pending",
        attemptCount: 1,
        nextAttemptAt: "2026-08-10T00:00:03.000Z",
        lastError: "Polar unavailable",
      }),
    ]);
  });

  it("does not deliver a historical shadow event when delivery is enabled", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await seedUsage(repository, pool, "shadow");
    const ingestUsageEvent = vi.fn(async () => ({ providerEventId: "unexpected" }));
    const worker = new BillingPolarOutboxWorker(
      repository,
      { ingestUsageEvent },
      { deliveryEnabled: true, releaseId: "release-248", batchSize: 10, maxAttempts: 3, retryDelayMs: 1_000 },
      undefined,
      allowDelivery,
    );

    await expect(worker.runOnce("2026-08-12T12:00:00.000Z")).resolves.toMatchObject({
      claimed: 0,
      delivered: 0,
    });
    expect(ingestUsageEvent).not.toHaveBeenCalled();
    await expect(repository.listOutboxEntries("tenant-a")).resolves.toEqual([
      expect.objectContaining({ status: "pending", attemptCount: 0 }),
    ]);
  });

  it("stops new delivery without changing ledger or outbox facts", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await seedUsage(repository, pool);
    const ingestUsageEvent = vi.fn(async () => ({ providerEventId: "unexpected" }));
    const worker = new BillingPolarOutboxWorker(
      repository,
      { ingestUsageEvent },
      { deliveryEnabled: true, releaseId: "release-248", batchSize: 10, maxAttempts: 3, retryDelayMs: 1_000 },
      undefined,
      {
        assertDeliveryAllowed: async () => {
          throw new Error("Charge delivery is stopped: Reconciliation mismatch.");
        },
      },
    );

    await expect(worker.runOnce("2026-08-12T12:00:00.000Z")).rejects.toThrow(
      "Charge delivery is stopped: Reconciliation mismatch.",
    );
    expect(ingestUsageEvent).not.toHaveBeenCalled();
    await expect(repository.listLedgerEntries("tenant-a")).resolves.toHaveLength(1);
    await expect(repository.listOutboxEntries("tenant-a")).resolves.toEqual([
      expect.objectContaining({ status: "pending", attemptCount: 0 }),
    ]);
  });

  it("rechecks the charge stop immediately before the provider call", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await seedUsage(repository, pool);
    const ingestUsageEvent = vi.fn(async () => ({ providerEventId: "unexpected" }));
    let checks = 0;
    const worker = new BillingPolarOutboxWorker(
      repository,
      { ingestUsageEvent },
      { deliveryEnabled: true, releaseId: "release-248", batchSize: 10, maxAttempts: 3, retryDelayMs: 1_000 },
      undefined,
      {
        assertDeliveryAllowed: async () => {
          checks += 1;
          if (checks === 2) throw new Error("Charge delivery is stopped: Incident stop.");
        },
      },
    );

    await expect(worker.runOnce("2026-08-12T12:00:00.000Z")).rejects.toThrow(
      "Charge delivery is stopped: Incident stop.",
    );
    expect(ingestUsageEvent).not.toHaveBeenCalled();
    await expect(repository.listLedgerEntries("tenant-a")).resolves.toHaveLength(1);
    await expect(repository.listOutboxEntries("tenant-a")).resolves.toEqual([
      expect.objectContaining({ status: "processing", attemptCount: 1 }),
    ]);
  });

  it("uses a fresh clock value for the provider-call release check", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await seedUsage(repository, pool);
    const checkedAt: string[] = [];
    const worker = new BillingPolarOutboxWorker(
      repository,
      { ingestUsageEvent: vi.fn(async () => ({ providerEventId: "polar_usage_entry-1" })) },
      { deliveryEnabled: true, releaseId: "release-248", batchSize: 1, maxAttempts: 3, retryDelayMs: 1_000 },
      undefined,
      { assertDeliveryAllowed: async (now) => { checkedAt.push(now); } },
      { now: () => "2026-08-12T12:00:05.000Z" },
    );

    await worker.runOnce("2026-08-12T12:00:00.000Z");

    expect(checkedAt).toEqual([
      "2026-08-12T12:00:00.000Z",
      "2026-08-12T12:00:05.000Z",
    ]);
  });

  it("recovers a stale processing claim after a worker crash", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await seedUsage(repository, pool);
    await repository.claimDueOutbox(
      "2026-08-10T00:00:02.000Z",
      1,
      "2026-08-10T00:01:02.000Z",
      "release-248",
    );
    const ingestUsageEvent = vi.fn(async () => ({ providerEventId: "polar_usage_entry-1" }));
    const worker = new BillingPolarOutboxWorker(
      repository,
      { ingestUsageEvent },
      {
        deliveryEnabled: true,
        releaseId: "release-248",
        batchSize: 10,
        maxAttempts: 3,
        retryDelayMs: 1_000,
        processingTimeoutMs: 60_000,
      },
      undefined,
      allowDelivery,
    );

    const result = await worker.runOnce("2026-08-10T00:01:03.000Z");

    expect(result.delivered).toBe(1);
    expect(ingestUsageEvent).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "polar_usage_entry-1",
    }));
    await expect(repository.listOutboxEntries("tenant-a")).resolves.toEqual([
      expect.objectContaining({ status: "delivered", attemptCount: 2 }),
    ]);
  });

  it("moves exhausted delivery to dead letter and audits a tenant-safe replay", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await seedUsage(repository, pool);
    const observability = new BillingOutboxObservability();
    const worker = new BillingPolarOutboxWorker(
      repository,
      { ingestUsageEvent: vi.fn(async () => { throw new Error("Polar unavailable"); }) },
      { deliveryEnabled: true, releaseId: "release-248", batchSize: 1, maxAttempts: 3, retryDelayMs: 1_000 },
      observability,
      allowDelivery,
    );
    await worker.runOnce("2026-08-10T00:00:02.000Z");
    await worker.runOnce("2026-08-10T00:00:03.000Z");
    await worker.runOnce("2026-08-10T00:00:05.000Z");
    await expect(repository.listOutboxEntries("tenant-a")).resolves.toEqual([
      expect.objectContaining({ status: "dead_letter", attemptCount: 3 }),
    ]);
    expect(observability.getSnapshot().deliveries).toEqual({
      delivered: 0,
      retried: 2,
      deadLettered: 1,
    });
    expect(observability.getSnapshot().alerts.deadLetter).toBe(1);
    const audit = new AuditLogService(
      new FileAuditLogRepository(join(tmpdir(), "zara-billing-outbox-audit", randomUUID())),
    );
    const operations = new BillingOutboxOperationsService(repository, audit);

    await operations.replayDeadLetter({
      organizationId: "tenant-a",
      outboxId: "polar_usage_entry-1",
      actorUserId: "billing-operator",
      reason: "Polar outage is resolved.",
      occurredAt: "2026-08-10T00:00:06.000Z",
    });

    await expect(repository.listOutboxEntries("tenant-a")).resolves.toEqual([
      expect.objectContaining({
        status: "pending",
        nextAttemptAt: "2026-08-10T00:00:06.000Z",
        lastError: "Operator replay: Polar outage is resolved.",
      }),
    ]);
    await expect(audit.list("tenant-a")).resolves.toEqual([
      expect.objectContaining({
        action: "billing.outbox_replayed",
        actor: { type: "user", id: "billing-operator" },
        target: { type: "billing_outbox", id: "polar_usage_entry-1" },
        outcome: "succeeded",
      }),
    ]);
  });

  it("rejects and audits a cross-tenant dead-letter replay", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await seedUsage(repository, pool);
    const worker = new BillingPolarOutboxWorker(
      repository,
      { ingestUsageEvent: vi.fn(async () => { throw new Error("Polar unavailable"); }) },
      { deliveryEnabled: true, releaseId: "release-248", batchSize: 1, maxAttempts: 1, retryDelayMs: 1_000 },
      undefined,
      allowDelivery,
    );
    await worker.runOnce("2026-08-10T00:00:02.000Z");
    const audit = new AuditLogService(
      new FileAuditLogRepository(join(tmpdir(), "zara-billing-outbox-audit", randomUUID())),
    );
    const operations = new BillingOutboxOperationsService(repository, audit);

    await expect(operations.replayDeadLetter({
      organizationId: "tenant-b",
      outboxId: "polar_usage_entry-1",
      actorUserId: "tenant-b-operator",
      reason: "Try another tenant event.",
      occurredAt: "2026-08-10T00:00:03.000Z",
    })).rejects.toThrow(
      "Dead-letter outbox event polar_usage_entry-1 was not found for this tenant.",
    );
    await expect(repository.listOutboxEntries("tenant-a")).resolves.toEqual([
      expect.objectContaining({ status: "dead_letter" }),
    ]);
    await expect(audit.list("tenant-b")).resolves.toEqual([
      expect.objectContaining({
        action: "billing.outbox_replay_rejected",
        outcome: "failed",
        target: { type: "billing_outbox", id: "polar_usage_entry-1" },
      }),
    ]);
  });

  it("delivers one PAYG session debit through the credits-only meter", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await repository.appendPaygSessionDebitWithOutbox({
      debit: {
        id: "payg-debit-call-1",
        organizationId: "tenant-payg",
        sessionId: "call-1",
        amountMinor: 89,
        idempotencyKey: "payg-session:call-1",
        createdAt: "2026-08-10T01:00:00.000Z",
      },
      outboxEntry: {
        id: "polar_payg_debit_call-1",
        organizationId: "tenant-payg",
        aggregateType: "payg_credit_entry",
        aggregateId: "payg-debit-call-1",
        eventType: "polar.usage.report",
        payload: {
          externalEventId: "polar_payg_debit_call-1",
          externalCustomerId: "tenant-payg",
          creditEntryId: "payg-debit-call-1",
          sessionId: "call-1",
          meterKey: "payg_charge_minor",
          quantity: 89,
          occurredAt: "2026-08-10T01:00:00.000Z",
          deliveryMode: "charge",
        },
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: "2026-08-10T01:00:00.000Z",
        createdAt: "2026-08-10T01:00:00.000Z",
      },
    });
    await pool.query(`update billing_outbox set
      charge_release_id = 'release-248',
      charge_promoted_at = '2026-08-10T01:00:00.500Z'
      where tenant_id = 'tenant-payg' and id = 'polar_payg_debit_call-1'`);
    const ingestUsageEvent = vi.fn(async () => ({
      providerEventId: "polar_payg_debit_call-1",
    }));
    const worker = new BillingPolarOutboxWorker(
      repository,
      { ingestUsageEvent },
      { deliveryEnabled: true, releaseId: "release-248", batchSize: 1, maxAttempts: 3, retryDelayMs: 1_000 },
      undefined,
      allowDelivery,
    );

    expect(await worker.runOnce("2026-08-10T01:00:01.000Z")).toEqual(
      expect.objectContaining({ delivered: 1 }),
    );
    expect(ingestUsageEvent).toHaveBeenCalledWith({
      externalCustomerId: "tenant-payg",
      externalId: "polar_payg_debit_call-1",
      name: "payg_charge_minor",
      units: 89,
      timestamp: "2026-08-10T01:00:00.000Z",
      metadata: {
        creditEntryId: "payg-debit-call-1",
        sessionId: "call-1",
        deliveryMode: "charge",
      },
    });
  });
});

async function seedUsage(
  repository: PostgresBillingLedgerRepository,
  pool: { query(sql: string): Promise<unknown> },
  deliveryMode: "shadow" | "charge" = "charge",
) {
  await repository.appendLedgerEntryWithOutbox({
    ledgerEntry: {
      id: "entry-1",
      organizationId: "tenant-a",
      idempotencyKey: "trusted-call:call-1:standard-runtime",
      entryType: "runtime_charge",
      currency: "usd",
      customerAmountMinor: 18,
      quantity: 60,
      unit: "second",
      occurredAt: "2026-08-10T00:00:00.000Z",
      metadata: { billingClass: "standard_runtime_seconds" },
      createdAt: "2026-08-10T00:00:01.000Z",
    },
    outboxEntry: {
      id: "polar_usage_entry-1",
      organizationId: "tenant-a",
      aggregateType: "billing_ledger_entry",
      aggregateId: "entry-1",
      eventType: "polar.usage.report",
      payload: {
        externalEventId: "polar_usage_entry-1",
        externalCustomerId: "tenant-a",
        ledgerEntryId: "entry-1",
        meterKey: "standard_runtime_seconds",
        quantity: 60,
        occurredAt: "2026-08-10T00:00:00.000Z",
      deliveryMode,
      },
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: "2026-08-10T00:00:01.000Z",
      createdAt: "2026-08-10T00:00:01.000Z",
    },
  });
  if (deliveryMode === "charge") {
    await pool.query(`update billing_outbox set
      charge_release_id = 'release-248',
      charge_promoted_at = '2026-08-10T00:00:01.500Z'
      where tenant_id = 'tenant-a' and id = 'polar_usage_entry-1'`);
  }
}

const allowDelivery = { assertDeliveryAllowed: async () => undefined };
