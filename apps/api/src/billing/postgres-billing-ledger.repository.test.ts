import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PostgresBillingLedgerRepository } from "./postgres-billing-ledger.repository";

describe("PostgresBillingLedgerRepository", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;

  beforeEach(() => {
    const database = newDb();
    database.public.none(`
      create table billing_customers (
        tenant_id text primary key,
        provider text not null,
        provider_customer_id text,
        created_at timestamptz not null,
        updated_at timestamptz not null
      )
    `);
    database.public.none(`
      create table billing_price_catalogs (
        id text primary key,
        version integer not null unique,
        status text not null,
        currency text not null,
        effective_from timestamptz not null,
        checksum text not null,
        catalog_document jsonb not null,
        approved_by text not null,
        approved_at timestamptz not null,
        created_at timestamptz not null
      )
    `);
    database.public.none(`
      create table billing_ledger_entries (
        id text not null,
        tenant_id text not null,
        idempotency_key text not null,
        entry_type text not null,
        catalog_id text,
        currency text not null,
        customer_amount_minor bigint,
        supplier_cost_minor bigint,
        quantity bigint not null,
        unit text not null,
        occurred_at timestamptz not null,
        metadata jsonb not null,
        created_at timestamptz not null,
        primary key (tenant_id, id),
        unique (tenant_id, idempotency_key)
      )
    `);
    database.public.none(`
      create table billing_adjustments (
        tenant_id text not null,
        id text not null,
        ledger_entry_id text not null,
        kind text not null,
        amount_minor bigint not null,
        currency text not null,
        reason text not null,
        created_by text not null,
        created_at timestamptz not null,
        primary key (tenant_id, id)
      )
    `);
    database.public.none(`
      create table audit_logs (
        id text primary key,
        tenant_id text,
        actor_type text not null,
        actor_id text not null,
        action text not null,
        target_type text not null,
        target_id text,
        metadata jsonb not null,
        occurred_at timestamptz not null
      )
    `);
    database.public.none(`
      create table billing_outbox (
        tenant_id text not null,
        id text not null,
        aggregate_type text not null,
        aggregate_id text not null,
        event_type text not null,
        payload jsonb not null,
        status text not null,
        attempt_count integer not null default 0,
        next_attempt_at timestamptz not null,
        last_error text,
        created_at timestamptz not null,
        delivered_at timestamptz,
        primary key (tenant_id, id)
      )
    `);
    database.public.none(`
      create table billing_payg_orders (
        tenant_id text not null,
        id text not null,
        provider_order_id text not null unique,
        currency text not null,
        paid_amount_minor bigint not null,
        granted_credit_minor bigint not null,
        status text not null,
        created_at timestamptz not null,
        primary key (tenant_id, id)
      )
    `);
    database.public.none(`
      create table billing_payg_credit_entries (
        tenant_id text not null,
        id text not null,
        order_id text,
        entry_type text not null,
        amount_minor bigint not null,
        idempotency_key text not null,
        session_id text,
        expires_at timestamptz,
        created_at timestamptz not null,
        primary key (tenant_id, id),
        unique (tenant_id, idempotency_key)
      )
    `);
    database.public.none(`
      create table billing_webhook_receipts (
        tenant_id text not null,
        provider text not null,
        event_id text not null,
        event_type text not null,
        payload_hash text not null,
        received_at timestamptz not null,
        processed_at timestamptz,
        status text not null,
        error text,
        primary key (tenant_id, provider, event_id)
      )
    `);
    database.public.none(`
      create table billing_invoices (
        tenant_id text not null,
        id text not null,
        provider_order_id text not null unique,
        invoice_number text not null,
        currency text not null,
        amount_minor bigint not null,
        status text not null,
        issued_at timestamptz not null,
        metadata jsonb not null,
        created_at timestamptz not null,
        primary key (tenant_id, id)
      )
    `);
    database.public.none(`
      create table billing_subscriptions (
        tenant_id text not null,
        id text not null,
        provider_subscription_id text not null unique,
        catalog_id text not null,
        plan_slug text,
        status text not null,
        current_period_end timestamptz,
        cancel_at_period_end boolean not null,
        version integer not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        primary key (tenant_id, id)
      )
    `);
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool();
  });

  afterEach(async () => {
    await pool.end();
  });

  it("returns no billing account for a tenant with no paid billing record", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);

    await expect(repository.getTenantAccount("tenant-new")).resolves.toBeNull();
  });

  it("records webhook replay once and rejects a changed replay payload", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    const receipt = {
      organizationId: "tenant-a",
      eventId: "evt-subscription-1",
      eventType: "customer.state_changed",
      payloadHash: "a".repeat(64),
      receivedAt: "2026-08-10T03:00:00.000Z",
    };

    await expect(repository.recordPolarWebhookReceipt(receipt)).resolves.toEqual({
      duplicate: false,
    });
    await repository.markPolarWebhookProcessed({
      organizationId: receipt.organizationId,
      eventId: receipt.eventId,
      processedAt: "2026-08-10T03:00:01.000Z",
    });
    await expect(repository.getPolarWebhookReceipt(receipt.organizationId, receipt.eventId)).resolves.toEqual(
      expect.objectContaining({
        status: "processed",
        processedAt: "2026-08-10T03:00:01.000Z",
      }),
    );
    await expect(repository.recordPolarWebhookReceipt(receipt)).resolves.toEqual({
      duplicate: true,
    });
    await expect(
      repository.recordPolarWebhookReceipt({
        ...receipt,
        payloadHash: "b".repeat(64),
      }),
    ).rejects.toThrow("Webhook replay payload does not match the original event.");
  });

  it("reopens a failed webhook receipt so Polar can retry it", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    const receipt = {
      organizationId: "tenant-a",
      eventId: "evt-refund-retry",
      eventType: "order.refunded",
      payloadHash: "c".repeat(64),
      receivedAt: "2026-08-10T04:00:00.000Z",
    };

    await expect(repository.recordPolarWebhookReceipt(receipt)).resolves.toEqual({
      duplicate: false,
    });
    await repository.markPolarWebhookFailed({
      organizationId: receipt.organizationId,
      eventId: receipt.eventId,
      error: "Polar webhook processing failed.",
    });
    await expect(repository.getPolarWebhookReceipt(receipt.organizationId, receipt.eventId)).resolves.toEqual(
      expect.objectContaining({
        status: "failed",
        error: "Polar webhook processing failed.",
      }),
    );

    await expect(
      repository.recordPolarWebhookReceipt({
        ...receipt,
        receivedAt: "2026-08-10T04:01:00.000Z",
      }),
    ).resolves.toEqual({ duplicate: false });
    await expect(repository.getPolarWebhookReceipt(receipt.organizationId, receipt.eventId)).resolves.toEqual(
      expect.objectContaining({
        status: "received",
        receivedAt: "2026-08-10T04:01:00.000Z",
      }),
    );
  });

  it("projects one paid invoice and rejects changed order replay data", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    const invoice = {
      id: "polar-invoice:polar-order-1",
      organizationId: "tenant-a",
      providerOrderId: "polar-order-1",
      invoiceNumber: "INV-2026-001",
      currency: "usd" as const,
      amountMinor: 12900,
      status: "paid" as const,
      issuedAt: "2026-08-10T03:00:00.000Z",
      metadata: { productId: "polar-product-growth" },
      createdAt: "2026-08-10T03:00:00.000Z",
    };

    await expect(repository.applyPaidInvoiceProjection(invoice)).resolves.toEqual({
      duplicate: false,
    });
    await expect(repository.applyPaidInvoiceProjection(invoice)).resolves.toEqual({
      duplicate: true,
    });
    await expect(
      pool.query("select provider_order_id, amount_minor, status from billing_invoices"),
    ).resolves.toMatchObject({
      rows: [
        {
          provider_order_id: "polar-order-1",
          amount_minor: 12900,
          status: "paid",
        },
      ],
    });
    await expect(
      repository.applyPaidInvoiceProjection({
        ...invoice,
        amountMinor: 500,
      }),
    ).rejects.toThrow("Invoice replay payload does not match the original order.");
  });

  it("does not let an older webhook replace a newer subscription projection", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    const current = {
      id: "subscription-local-1",
      organizationId: "tenant-a",
      providerSubscriptionId: "polar-subscription-1",
      catalogId: "catalog-subscription-1",
      planSlug: "growth",
      status: "active",
      cancelAtPeriodEnd: false,
      version: 1,
      createdAt: "2026-08-10T03:00:00.000Z",
      updatedAt: "2026-08-10T03:00:00.000Z",
    };

    await repository.upsertSubscriptionProjection(current);
    await repository.upsertSubscriptionProjection({
      ...current,
      status: "canceled",
      updatedAt: "2026-08-09T03:00:00.000Z",
    });

    await expect(repository.listSubscriptionProjections("tenant-a")).resolves.toEqual([
      expect.objectContaining({
        planSlug: "growth",
        status: "active",
        updatedAt: current.updatedAt,
      }),
    ]);
  });

  it("grants exactly one $5 PAYG pack for one paid Polar order", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    const input = {
      order: {
        id: "payg-order-1",
        organizationId: "tenant-payg",
        providerOrderId: "polar-order-1",
        currency: "usd" as const,
        paidAmountMinor: 500,
        grantedCreditMinor: 500,
        status: "paid" as const,
        createdAt: "2026-08-10T04:00:00.000Z",
      },
      grant: {
        id: "payg-grant-1",
        organizationId: "tenant-payg",
        orderId: "payg-order-1",
        entryType: "grant" as const,
        amountMinor: 500,
        idempotencyKey: "polar-order:polar-order-1:grant",
        createdAt: "2026-08-10T04:00:00.000Z",
      },
    };

    await expect(repository.applyPaidPaygOrder(input)).resolves.toEqual({
      duplicate: false,
    });
    await expect(repository.applyPaidPaygOrder(input)).resolves.toEqual({
      duplicate: true,
    });
    await expect(repository.listPaygCreditEntries("tenant-payg")).resolves.toEqual([
      expect.objectContaining({ entryType: "grant", amountMinor: 500 }),
    ]);
    await expect(
      repository.applyPaidPaygOrder({
        ...input,
        order: { ...input.order, paidAmountMinor: 1000 },
      }),
    ).rejects.toThrow("The approved PAYG pack is exactly USD 5.00.");
  });

  it("reverses one unused $5 grant exactly once after a Polar refund", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    const paid = paygOrderInput();
    await repository.applyPaidPaygOrder(paid);
    const reversal = {
      id: "payg-reversal-1",
      organizationId: "tenant-payg",
      orderId: paid.order.id,
      entryType: "reversal" as const,
      amountMinor: 500,
      idempotencyKey: "polar-order:polar-order-1:refund-reversal",
      createdAt: "2026-08-10T05:00:00.000Z",
    };

    await expect(
      repository.applyPaygOrderRefund({
        organizationId: "tenant-payg",
        providerOrderId: "polar-order-1",
        reversal,
      }),
    ).resolves.toEqual({ duplicate: false });
    await expect(
      repository.applyPaygOrderRefund({
        organizationId: "tenant-payg",
        providerOrderId: "polar-order-1",
        reversal,
      }),
    ).resolves.toEqual({ duplicate: true });
    await expect(repository.listPaygCreditEntries("tenant-payg")).resolves.toEqual([
      expect.objectContaining({ entryType: "grant", amountMinor: 500 }),
      expect.objectContaining({ entryType: "reversal", amountMinor: 500 }),
    ]);
  });

  it("publishes and retrieves the approved price catalog with integer money", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    const catalog = {
      id: "catalog-2026-08-v3",
      version: 3,
      status: "active" as const,
      currency: "usd" as const,
      effectiveFrom: "2026-08-09T00:00:00.000Z",
      checksum: "a".repeat(64),
      document: {
        paygPackMinor: 500,
        paygStandardRuntimePerMinuteMinor: 18,
        paygPremiumRuntimePerMinuteMinor: 45,
      },
      approvedBy: "user",
      approvedAt: "2026-08-09T14:24:19.029Z",
      createdAt: "2026-08-09T14:24:19.029Z",
    };

    await repository.publishPriceCatalog(catalog);

    await expect(repository.getPriceCatalog(catalog.id)).resolves.toEqual(catalog);
  });

  it("fixes usage to the latest catalog effective at the event time", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    const first = {
      id: "catalog-effective-v1",
      version: 1,
      status: "active" as const,
      currency: "usd" as const,
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      checksum: "1".repeat(64),
      document: { paygPackMinor: 500 },
      approvedBy: "user",
      approvedAt: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    const second = {
      ...first,
      id: "catalog-effective-v2",
      version: 2,
      effectiveFrom: "2026-09-01T00:00:00.000Z",
      checksum: "2".repeat(64),
    };
    await repository.publishPriceCatalog(first);
    await repository.publishPriceCatalog(second);

    await expect(repository.getEffectivePriceCatalog("2026-08-09T10:00:00.000Z")).resolves.toEqual(first);
  });

  it("rejects a rewrite of a published price catalog", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    const catalog = {
      id: "catalog-immutable",
      version: 3,
      status: "active" as const,
      currency: "usd" as const,
      effectiveFrom: "2026-08-09T00:00:00.000Z",
      checksum: "b".repeat(64),
      document: { paygPackMinor: 500 },
      approvedBy: "user",
      approvedAt: "2026-08-09T14:24:19.029Z",
      createdAt: "2026-08-09T14:24:19.029Z",
    };
    await repository.publishPriceCatalog(catalog);

    await expect(
      repository.publishPriceCatalog({
        ...catalog,
        checksum: "c".repeat(64),
        document: { paygPackMinor: 2_000 },
      }),
    ).rejects.toThrow("Price catalog catalog-immutable is immutable.");
  });

  it("accepts an idempotent retry of the same price catalog", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    const catalog = {
      id: "catalog-retry",
      version: 3,
      status: "active" as const,
      currency: "usd" as const,
      effectiveFrom: "2026-08-09T00:00:00.000Z",
      checksum: "d".repeat(64),
      document: { paygPackMinor: 500 },
      approvedBy: "user",
      approvedAt: "2026-08-09T14:24:19.029Z",
      createdAt: "2026-08-09T14:24:19.029Z",
    };

    const first = await repository.publishPriceCatalog(catalog);
    const retry = await repository.publishPriceCatalog(catalog);

    expect({ first, retry }).toEqual({
      first: { catalog, duplicate: false },
      retry: { catalog, duplicate: true },
    });
  });

  it("rejects fractional values in a price catalog before persistence", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);

    await expect(
      repository.publishPriceCatalog({
        id: "catalog-corrupt",
        version: 4,
        status: "active",
        currency: "usd",
        effectiveFrom: "2026-08-09T00:00:00.000Z",
        checksum: "e".repeat(64),
        document: { paygPackMinor: 500.5 },
        approvedBy: "user",
        approvedAt: "2026-08-09T14:24:19.029Z",
        createdAt: "2026-08-09T14:24:19.029Z",
      }),
    ).rejects.toThrow("Price catalog value document.paygPackMinor must be a non-negative safe integer.");
  });

  it("rejects a corrupt stored price catalog", async () => {
    await pool.query(
      `insert into billing_price_catalogs (
         id, version, status, currency, effective_from, checksum,
         catalog_document, approved_by, approved_at, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
      [
        "catalog-stored-corrupt",
        5,
        "active",
        "usd",
        "2026-08-09T00:00:00.000Z",
        "f".repeat(64),
        JSON.stringify({ paygPackMinor: 500.5 }),
        "user",
        "2026-08-09T14:24:19.029Z",
        "2026-08-09T14:24:19.029Z",
      ],
    );
    const repository = new PostgresBillingLedgerRepository(pool);

    await expect(repository.getPriceCatalog("catalog-stored-corrupt")).rejects.toThrow(
      "Price catalog value document.paygPackMinor must be a non-negative safe integer.",
    );
  });

  it("stores one append-only ledger entry for an idempotent retry", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    const input = {
      id: "entry-1",
      organizationId: "tenant-a",
      idempotencyKey: "runtime-session-1",
      entryType: "runtime_charge" as const,
      catalogId: "catalog-2026-08-v3",
      currency: "usd" as const,
      customerAmountMinor: 18,
      supplierCostMinor: 5,
      quantity: 60,
      unit: "second",
      occurredAt: "2026-08-09T15:00:00.000Z",
      metadata: { sessionId: "session-1" },
      createdAt: "2026-08-09T15:00:01.000Z",
    };

    const first = await repository.appendLedgerEntry(input);
    const retry = await repository.appendLedgerEntry(input);

    expect({
      first,
      retry,
      entries: await repository.listLedgerEntries("tenant-a"),
    }).toEqual({
      first: { entry: input, duplicate: false },
      retry: { entry: input, duplicate: true },
      entries: [input],
    });
  });

  it("commits one trusted ledger fact and its Polar outbox event together", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    const ledgerEntry = {
      id: "entry-transaction-1",
      organizationId: "tenant-a",
      idempotencyKey: "trusted-call:call-1:standard-runtime",
      entryType: "runtime_charge" as const,
      currency: "usd" as const,
      customerAmountMinor: 18,
      quantity: 60,
      unit: "second",
      occurredAt: "2026-08-10T00:00:00.000Z",
      metadata: { callSessionId: "call-1", chargeDelivery: "shadow" },
      createdAt: "2026-08-10T00:00:01.000Z",
    };
    const outboxEntry = {
      id: "polar-usage-entry-transaction-1",
      organizationId: "tenant-a",
      aggregateType: "billing_ledger_entry" as const,
      aggregateId: ledgerEntry.id,
      eventType: "polar.usage.report" as const,
      payload: {
        externalEventId: "polar-usage-entry-transaction-1",
        meterKey: "standard_runtime_seconds",
        quantity: 60,
      },
      status: "pending" as const,
      attemptCount: 0,
      nextAttemptAt: "2026-08-10T00:00:01.000Z",
      createdAt: "2026-08-10T00:00:01.000Z",
    };

    await repository.appendLedgerEntryWithOutbox({ ledgerEntry, outboxEntry });

    await expect(
      Promise.all([repository.listLedgerEntries("tenant-a"), repository.listOutboxEntries("tenant-a")]),
    ).resolves.toEqual([[ledgerEntry], [outboxEntry]]);
  });

  it("commits one PAYG session debit and one credits-only outbox event exactly once", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    const input = {
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
        aggregateType: "payg_credit_entry" as const,
        aggregateId: "payg-debit-call-1",
        eventType: "polar.usage.report" as const,
        payload: {
          externalEventId: "polar_payg_debit_call-1",
          externalCustomerId: "tenant-payg",
          creditEntryId: "payg-debit-call-1",
          sessionId: "call-1",
          meterKey: "payg_charge_minor",
          quantity: 89,
          occurredAt: "2026-08-10T01:00:00.000Z",
          deliveryMode: "shadow",
        },
        status: "pending" as const,
        attemptCount: 0,
        nextAttemptAt: "2026-08-10T01:00:00.000Z",
        createdAt: "2026-08-10T01:00:00.000Z",
      },
    };

    const first = await repository.appendPaygSessionDebitWithOutbox(input);
    const retry = await repository.appendPaygSessionDebitWithOutbox(input);

    expect({ first: first.duplicate, retry: retry.duplicate }).toEqual({
      first: false,
      retry: true,
    });
    await expect(repository.listPaygCreditEntries("tenant-payg")).resolves.toEqual([
      expect.objectContaining({
        id: "payg-debit-call-1",
        sessionId: "call-1",
        entryType: "debit",
        amountMinor: 89,
      }),
    ]);
    await expect(repository.listOutboxEntries("tenant-payg")).resolves.toEqual([
      expect.objectContaining({
        aggregateType: "payg_credit_entry",
        payload: expect.objectContaining({
          meterKey: "payg_charge_minor",
          quantity: 89,
        }),
      }),
    ]);
  });

  it("keeps ledger reads and idempotency keys inside one tenant", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    const common = {
      id: "entry-shared",
      idempotencyKey: "runtime-session-shared",
      entryType: "runtime_charge" as const,
      currency: "usd" as const,
      customerAmountMinor: 18,
      supplierCostMinor: 5,
      quantity: 60,
      unit: "second",
      occurredAt: "2026-08-09T15:00:00.000Z",
      metadata: {},
      createdAt: "2026-08-09T15:00:01.000Z",
    };

    await repository.appendLedgerEntry({
      ...common,
      organizationId: "tenant-a",
    });
    await repository.appendLedgerEntry({
      ...common,
      organizationId: "tenant-b",
    });

    await expect(repository.listLedgerEntries("tenant-a")).resolves.toEqual([
      { ...common, organizationId: "tenant-a" },
    ]);
    await expect(repository.listLedgerEntries("tenant-b")).resolves.toEqual([
      { ...common, organizationId: "tenant-b" },
    ]);
  });

  it("rejects fractional customer money before persistence", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);

    await expect(
      repository.appendLedgerEntry({
        id: "entry-fractional",
        organizationId: "tenant-a",
        idempotencyKey: "runtime-session-fractional",
        entryType: "runtime_charge",
        currency: "usd",
        customerAmountMinor: 18.5,
        supplierCostMinor: 5,
        quantity: 60,
        unit: "second",
        occurredAt: "2026-08-09T15:00:00.000Z",
        metadata: {},
        createdAt: "2026-08-09T15:00:01.000Z",
      }),
    ).rejects.toThrow("customerAmountMinor must be a non-negative safe integer.");
  });

  it("settles concurrent idempotent writes as one ledger entry", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    const input = {
      id: "entry-concurrent",
      organizationId: "tenant-a",
      idempotencyKey: "runtime-session-concurrent",
      entryType: "runtime_charge" as const,
      currency: "usd" as const,
      customerAmountMinor: 18,
      supplierCostMinor: 5,
      quantity: 60,
      unit: "second",
      occurredAt: "2026-08-09T15:00:00.000Z",
      metadata: {},
      createdAt: "2026-08-09T15:00:01.000Z",
    };

    const results = await Promise.all([repository.appendLedgerEntry(input), repository.appendLedgerEntry(input)]);

    expect({
      duplicateFlags: results.map((result) => result.duplicate).sort(),
      entryCount: (await repository.listLedgerEntries("tenant-a")).length,
    }).toEqual({ duplicateFlags: [false, true], entryCount: 1 });
  });

  it("rejects an idempotency key reused for a different charge", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    const input = {
      id: "entry-conflict",
      organizationId: "tenant-a",
      idempotencyKey: "runtime-session-conflict",
      entryType: "runtime_charge" as const,
      currency: "usd" as const,
      customerAmountMinor: 18,
      supplierCostMinor: 5,
      quantity: 60,
      unit: "second",
      occurredAt: "2026-08-09T15:00:00.000Z",
      metadata: {},
      createdAt: "2026-08-09T15:00:01.000Z",
    };
    await repository.appendLedgerEntry(input);

    await expect(
      repository.appendLedgerEntry({
        ...input,
        id: "entry-conflict-retry",
        customerAmountMinor: 45,
      }),
    ).rejects.toThrow("Idempotency key runtime-session-conflict already belongs to a different ledger entry.");
  });

  it("applies one approved append-only adjustment to its original ledger entry", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await repository.appendLedgerEntry({
      id: "entry-original",
      organizationId: "tenant-a",
      idempotencyKey: "runtime-session-original",
      entryType: "runtime_charge",
      currency: "usd",
      customerAmountMinor: 80,
      supplierCostMinor: 20,
      quantity: 60,
      unit: "second",
      occurredAt: "2026-08-09T15:00:00.000Z",
      metadata: {},
      createdAt: "2026-08-09T15:00:01.000Z",
    });
    const adjustment = {
      id: "adjustment-1",
      organizationId: "tenant-a",
      ledgerEntryId: "entry-original",
      kind: "credit" as const,
      amountMinor: 30,
      currency: "usd" as const,
      reason: "Verified provider billing error.",
      createdBy: "platform-admin-1",
      createdAt: "2026-08-10T10:00:00.000Z",
    };

    const first = await repository.applyApprovedAdjustment(adjustment);
    const replay = await repository.applyApprovedAdjustment(adjustment);

    expect({
      first,
      replay,
      adjustments: await repository.listAdjustments("tenant-a"),
      entries: await repository.listLedgerEntries("tenant-a"),
    }).toEqual({
      first: { adjustment, duplicate: false },
      replay: { adjustment, duplicate: true },
      adjustments: [adjustment],
      entries: [
        expect.objectContaining({ id: "entry-original" }),
        {
          id: "adjustment-ledger:adjustment-1",
          organizationId: "tenant-a",
          idempotencyKey: "adjustment:adjustment-1",
          entryType: "adjustment",
          currency: "usd",
          customerAmountMinor: 30,
          quantity: 1,
          unit: "adjustment",
          occurredAt: "2026-08-10T10:00:00.000Z",
          metadata: {
            adjustmentId: "adjustment-1",
            originalLedgerEntryId: "entry-original",
            kind: "credit",
            reason: "Verified provider billing error.",
            createdBy: "platform-admin-1",
          },
          createdAt: "2026-08-10T10:00:00.000Z",
        },
      ],
    });
    await expect(
      pool.query("select tenant_id, actor_id, action, target_type, target_id, metadata from audit_logs"),
    ).resolves.toMatchObject({
      rows: [
        {
          tenant_id: "tenant-a",
          actor_id: "platform-admin-1",
          action: "billing.adjustment_applied",
          target_type: "billing_adjustment",
          target_id: "adjustment-1",
          metadata: {
            ledgerEntryId: "entry-original",
            kind: "credit",
            amountMinor: 30,
          },
        },
      ],
    });

    await expect(
      repository.applyApprovedAdjustment({
        ...adjustment,
        amountMinor: 31,
      }),
    ).rejects.toThrow("Adjustment adjustment-1 already has different data.");
    await pool.query(
      `update audit_logs set metadata = '{"ledgerEntryId":"forged","kind":"credit","amountMinor":30}'::jsonb
       where id = 'billing-adjustment:tenant-a:adjustment-1'`,
    );
    await expect(repository.applyApprovedAdjustment(adjustment)).rejects.toThrow(
      "Adjustment adjustment-1 audit record has different data.",
    );
    await expect(
      repository.applyApprovedAdjustment({
        ...adjustment,
        id: "adjustment-cross-tenant",
        organizationId: "tenant-b",
      }),
    ).rejects.toThrow("Original ledger entry entry-original was not found.");
  });
});

function paygOrderInput() {
  return {
    order: {
      id: "payg-order-1",
      organizationId: "tenant-payg",
      providerOrderId: "polar-order-1",
      currency: "usd" as const,
      paidAmountMinor: 500,
      grantedCreditMinor: 500,
      status: "paid" as const,
      createdAt: "2026-08-10T04:00:00.000Z",
    },
    grant: {
      id: "payg-grant-1",
      organizationId: "tenant-payg",
      orderId: "payg-order-1",
      entryType: "grant" as const,
      amountMinor: 500,
      idempotencyKey: "polar-order:polar-order-1:grant",
      createdAt: "2026-08-10T04:00:00.000Z",
    },
  };
}
