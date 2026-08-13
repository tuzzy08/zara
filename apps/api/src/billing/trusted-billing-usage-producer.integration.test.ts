import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PostgresBillingLedgerRepository } from "./postgres-billing-ledger.repository";
import { TrustedBillingUsageProducer } from "./trusted-billing-usage-producer";

describe("TrustedBillingUsageProducer call finalization", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;

  beforeEach(() => {
    const database = newDb();
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
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool();
  });

  afterEach(async () => {
    await pool.end();
  });

  it("records one runtime fact and one platform carrier fact for a completed call", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await repository.publishPriceCatalog({
      id: "catalog-2026-08-v1",
      version: 1,
      status: "active",
      currency: "usd",
      effectiveFrom: "2026-08-09T00:00:00.000Z",
      checksum: "a".repeat(64),
      document: {
        payg: {
          standardRuntimePerMinuteMinor: 18,
          premiumRuntimePerMinuteMinor: 45,
        },
        plans: {
          starter: {
            standardRuntimePerMinuteMinor: 18,
            premiumRuntimePerMinuteMinor: 45,
          },
        },
        telephonyRoutes: {
          "twilio-ng-outbound": {
            provider: "twilio",
            direction: "outbound",
            customerRateMinorPerMinute: 35,
            rounding: "next_full_minute",
          },
        },
      },
      approvedBy: "billing-approver",
      approvedAt: "2026-08-09T00:00:00.000Z",
      createdAt: "2026-08-09T00:00:00.000Z",
    });
    const producer = new TrustedBillingUsageProducer(repository);
    const terminalFact = {
      organizationId: "tenant-a",
      workspaceId: "workspace-a",
      callSessionId: "call-a",
      providerConnectionId: "connection-a",
      provider: "twilio" as const,
      direction: "outbound" as const,
      ownershipMode: "platform-managed" as const,
      routeMode: "live_route" as const,
      runtimePath: "pstn-sandwich" as const,
      outcome: "completed" as const,
      catalogId: "catalog-2026-08-v1",
      commercialMode: "subscription" as const,
      planSlug: "starter",
      routeRateId: "twilio-ng-outbound",
      runtimeSeconds: 61,
      providerConnectedSeconds: 61,
      supplierRuntimeCostMinor: 6,
      supplierTelephonyCostMinor: 24,
      occurredAt: "2026-08-09T15:01:01.000Z",
    };

    const first = await producer.recordTerminalCall(terminalFact);
    const retry = await producer.recordTerminalCall(terminalFact);
    const entries = await repository.listLedgerEntries("tenant-a");
    const outboxEntries = await repository.listOutboxEntries("tenant-a");

    expect(first).toEqual({ recorded: 2, duplicates: 0, incomplete: 0 });
    expect(retry).toEqual({ recorded: 0, duplicates: 2, incomplete: 0 });
    expect(entries).toEqual([
      expect.objectContaining({
        organizationId: "tenant-a",
        idempotencyKey: "trusted-call:call-a:standard-runtime",
        entryType: "runtime_charge",
        catalogId: "catalog-2026-08-v1",
        customerAmountMinor: 19,
        supplierCostMinor: 6,
        quantity: 61,
        unit: "second",
        metadata: expect.objectContaining({
          billingClass: "standard_runtime_seconds",
          commercialMode: "subscription",
          runtimePath: "pstn-sandwich",
          chargeDelivery: "shadow",
        }),
      }),
      expect.objectContaining({
        organizationId: "tenant-a",
        idempotencyKey: "trusted-call:call-a:platform-telephony",
        entryType: "telephony_charge",
        catalogId: "catalog-2026-08-v1",
        customerAmountMinor: 70,
        supplierCostMinor: 24,
        quantity: 61,
        unit: "connected_second",
        metadata: expect.objectContaining({
          billingClass: "platform_telephony_charge_minor",
          connectionOwnership: "platform-managed",
          routeRateId: "twilio-ng-outbound",
          roundedCustomerMinutes: 2,
          chargeDelivery: "shadow",
        }),
      }),
    ]);
    expect(outboxEntries).toEqual([
      expect.objectContaining({
        aggregateId: entries[0]?.id,
        eventType: "polar.usage.report",
        status: "pending",
        attemptCount: 0,
        payload: expect.objectContaining({
          externalEventId: expect.any(String),
          meterKey: "standard_runtime_seconds",
          quantity: 61,
          deliveryMode: "shadow",
        }),
      }),
      expect.objectContaining({
        aggregateId: entries[1]?.id,
        eventType: "polar.usage.report",
        status: "pending",
        attemptCount: 0,
        payload: expect.objectContaining({
          externalEventId: expect.any(String),
          meterKey: "platform_telephony_charge_minor",
          quantity: 61,
          deliveryMode: "shadow",
        }),
      }),
    ]);
  });

  it("records premium BYO usage without a Zara carrier charge", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await repository.publishPriceCatalog(createCatalog());
    const producer = new TrustedBillingUsageProducer(repository);

    const result = await producer.recordTerminalCall({
      organizationId: "tenant-byo",
      workspaceId: "workspace-byo",
      callSessionId: "call-byo-premium",
      providerConnectionId: "connection-byo",
      provider: "twilio",
      direction: "inbound",
      ownershipMode: "byo",
      routeMode: "live_route",
      runtimePath: "pstn-premium-realtime",
      outcome: "completed",
      catalogId: "catalog-2026-08-v1",
      commercialMode: "payg",
      runtimeSeconds: 60,
      providerConnectedSeconds: 60,
      supplierRuntimeCostMinor: 20,
      occurredAt: "2026-08-09T16:01:00.000Z",
    });

    expect(result).toEqual({ recorded: 1, duplicates: 0, incomplete: 0 });
    await expect(repository.listLedgerEntries("tenant-byo")).resolves.toEqual([
      expect.objectContaining({
        entryType: "runtime_charge",
        customerAmountMinor: 45,
        supplierCostMinor: 20,
        quantity: 60,
        metadata: expect.objectContaining({
          billingClass: "premium_runtime_seconds",
          connectionOwnership: "byo",
          runtimePath: "pstn-premium-realtime",
        }),
      }),
    ]);
  });

  it("keeps usage visible and incomplete when an approved customer rate is missing", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    const catalog = createCatalog();
    await repository.publishPriceCatalog({
      ...catalog,
      id: "catalog-missing-premium-rate",
      checksum: "b".repeat(64),
      document: {
        ...catalog.document,
        payg: { standardRuntimePerMinuteMinor: 18 },
      },
    });
    const producer = new TrustedBillingUsageProducer(repository);

    const result = await producer.recordTerminalCall({
      organizationId: "tenant-incomplete",
      workspaceId: "workspace-incomplete",
      callSessionId: "call-incomplete",
      providerConnectionId: "connection-byo",
      provider: "twilio",
      direction: "inbound",
      ownershipMode: "byo",
      routeMode: "live_route",
      runtimePath: "pstn-premium-realtime",
      outcome: "completed",
      catalogId: "catalog-missing-premium-rate",
      commercialMode: "payg",
      runtimeSeconds: 30,
      supplierRuntimeCostMinor: 11,
      occurredAt: "2026-08-09T17:00:30.000Z",
    });

    expect(result).toEqual({ recorded: 1, duplicates: 0, incomplete: 1 });
    const entries = await repository.listLedgerEntries("tenant-incomplete");
    expect(entries).toEqual([
      expect.objectContaining({
        supplierCostMinor: 11,
        quantity: 30,
        metadata: expect.objectContaining({
          billingDisposition: "incomplete",
          incompleteReasons: ["missing_customer_runtime_rate"],
        }),
      }),
    ]);
    expect(entries[0]).not.toHaveProperty("customerAmountMinor");
  });

  it("uses the assigned subscription plan rate for the same trusted runtime fact", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await repository.publishPriceCatalog(createCatalog());
    const producer = new TrustedBillingUsageProducer(repository);

    await producer.recordTerminalCall({
      organizationId: "tenant-subscription",
      workspaceId: "workspace-subscription",
      callSessionId: "call-subscription",
      providerConnectionId: "connection-byo",
      provider: "twilio",
      direction: "inbound",
      ownershipMode: "byo",
      routeMode: "live_route",
      runtimePath: "pstn-sandwich",
      outcome: "completed",
      catalogId: "catalog-2026-08-v1",
      commercialMode: "subscription",
      planSlug: "starter",
      runtimeSeconds: 60,
      occurredAt: "2026-08-09T18:01:00.000Z",
    });

    await expect(repository.listLedgerEntries("tenant-subscription")).resolves.toEqual([
      expect.objectContaining({
        customerAmountMinor: 15,
        metadata: expect.objectContaining({
          commercialMode: "subscription",
          planSlug: "starter",
        }),
      }),
    ]);
  });

  it("keeps PAYG-netted subscription usage out of the provider outbox", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await repository.publishPriceCatalog(createCatalog());
    const producer = new TrustedBillingUsageProducer(repository);

    const result = await producer.recordTerminalCall({
      organizationId: "tenant-netted",
      callSessionId: "call-netted",
      providerConnectionId: "connection-byo",
      provider: "twilio",
      direction: "inbound",
      ownershipMode: "byo",
      routeMode: "live_route",
      runtimePath: "pstn-sandwich",
      outcome: "completed",
      catalogId: "catalog-2026-08-v1",
      commercialMode: "subscription",
      planSlug: "starter",
      runtimeSeconds: 90,
      paygAppliedMinor: 6,
      occurredAt: "2026-08-09T18:02:00.000Z",
    });

    expect(result).toEqual({ recorded: 1, duplicates: 0, incomplete: 1 });
    await expect(repository.listOutboxEntries("tenant-netted")).resolves.toEqual([]);
    await expect(repository.listLedgerEntries("tenant-netted")).resolves.toEqual([
      expect.objectContaining({
        customerAmountMinor: 23,
        metadata: expect.objectContaining({
          paygAppliedMinor: 6,
          billingDisposition: "incomplete",
          chargeDelivery: "blocked",
          incompleteReasons: ["subscription_payg_net_settlement_unavailable"],
        }),
      }),
    ]);
  });

  it("also blocks provider delivery for PAYG-netted subscription telephony usage", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await repository.publishPriceCatalog(createCatalog());
    const producer = new TrustedBillingUsageProducer(repository);

    const result = await producer.recordTerminalCall({
      organizationId: "tenant-netted-platform",
      callSessionId: "call-netted-platform",
      providerConnectionId: "connection-platform",
      provider: "twilio",
      direction: "outbound",
      ownershipMode: "platform-managed",
      routeMode: "live_route",
      runtimePath: "pstn-sandwich",
      outcome: "completed",
      catalogId: "catalog-2026-08-v1",
      commercialMode: "subscription",
      planSlug: "starter",
      routeRateId: "twilio-ng-outbound",
      runtimeSeconds: 90,
      providerConnectedSeconds: 61,
      paygAppliedMinor: 6,
      occurredAt: "2026-08-09T18:03:00.000Z",
    });

    expect(result).toEqual({ recorded: 2, duplicates: 0, incomplete: 2 });
    await expect(repository.listOutboxEntries("tenant-netted-platform")).resolves.toEqual([]);
    const entries = await repository.listLedgerEntries("tenant-netted-platform");
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.metadata.billingDisposition === "incomplete")).toBe(true);
    expect(entries.every((entry) => entry.metadata.chargeDelivery === "blocked")).toBe(true);
    expect(entries.every((entry) => entry.metadata.paygAppliedMinor === 6)).toBe(true);
  });

  it("records browser sandbox runtime as explicitly non-billable", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await repository.publishPriceCatalog(createCatalog());
    const producer = new TrustedBillingUsageProducer(repository);

    const result = await producer.recordRuntimeSession({
      organizationId: "tenant-sandbox",
      workspaceId: "workspace-sandbox",
      sessionId: "sandbox-session-a",
      source: "browser_sandbox",
      runtimePath: "standard",
      runtimeSeconds: 90,
      catalogId: "catalog-2026-08-v1",
      occurredAt: "2026-08-09T19:01:30.000Z",
    });

    expect(result).toEqual({ recorded: 1, duplicates: 0, incomplete: 0 });
    const entries = await repository.listLedgerEntries("tenant-sandbox");
    expect(entries).toEqual([
      expect.objectContaining({
        idempotencyKey: "trusted-runtime:sandbox-session-a:standard-runtime",
        quantity: 90,
        unit: "second",
        metadata: expect.objectContaining({
          billingClass: "standard_runtime_seconds",
          source: "browser_sandbox",
          billingDisposition: "non_billable",
          nonBillableReason: "browser_sandbox_v1",
        }),
      }),
    ]);
    expect(entries[0]).not.toHaveProperty("customerAmountMinor");
  });

  it("records an incomplete carrier fact when completed-call provider usage is missing", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await repository.publishPriceCatalog(createCatalog());
    const producer = new TrustedBillingUsageProducer(repository);

    const result = await producer.recordTerminalCall({
      organizationId: "tenant-provider-gap",
      workspaceId: "workspace-provider-gap",
      callSessionId: "call-provider-gap",
      providerConnectionId: "connection-platform",
      provider: "twilio",
      direction: "outbound",
      ownershipMode: "platform-managed",
      routeMode: "live_route",
      runtimePath: "pstn-sandwich",
      outcome: "completed",
      catalogId: "catalog-2026-08-v1",
      commercialMode: "payg",
      routeRateId: "twilio-ng-outbound",
      runtimeSeconds: 20,
      occurredAt: "2026-08-09T20:00:20.000Z",
    });

    expect(result).toEqual({ recorded: 2, duplicates: 0, incomplete: 1 });
    const entries = await repository.listLedgerEntries("tenant-provider-gap");
    expect(entries[1]).toEqual(expect.objectContaining({
      entryType: "telephony_charge",
      quantity: 0,
      metadata: expect.objectContaining({
        billingDisposition: "incomplete",
        incompleteReasons: ["missing_provider_connected_seconds"],
      }),
    }));
    expect(entries[1]).not.toHaveProperty("customerAmountMinor");
  });

  it("keeps a failed no-connect carrier fact visible with an explicit zero-charge policy", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await repository.publishPriceCatalog(createCatalog());
    const producer = new TrustedBillingUsageProducer(repository);

    const result = await producer.recordTerminalCall({
      organizationId: "tenant-failed",
      workspaceId: "workspace-failed",
      callSessionId: "call-failed",
      providerConnectionId: "connection-platform",
      provider: "twilio",
      direction: "outbound",
      ownershipMode: "platform-managed",
      routeMode: "live_route",
      runtimePath: "pstn-sandwich",
      outcome: "failed",
      catalogId: "catalog-2026-08-v1",
      commercialMode: "payg",
      routeRateId: "twilio-ng-outbound",
      runtimeSeconds: 0,
      providerConnectedSeconds: 0,
      supplierTelephonyCostMinor: 3,
      occurredAt: "2026-08-09T21:00:00.000Z",
    });

    expect(result).toEqual({ recorded: 2, duplicates: 0, incomplete: 0 });
    const entries = await repository.listLedgerEntries("tenant-failed");
    expect(entries[1]).toEqual(expect.objectContaining({
      customerAmountMinor: 0,
      supplierCostMinor: 3,
      quantity: 0,
      metadata: expect.objectContaining({
        billingDisposition: "non_billable",
        nonBillableReason: "failed_without_provider_connection",
        outcome: "failed",
      }),
    }));
  });

  it("classifies phone-test usage separately and applies the selected live-route rule", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await repository.publishPriceCatalog(createCatalog());
    const producer = new TrustedBillingUsageProducer(repository);

    await producer.recordTerminalCall({
      organizationId: "tenant-phone-test",
      workspaceId: "workspace-phone-test",
      callSessionId: "call-phone-test",
      providerConnectionId: "connection-platform",
      provider: "twilio",
      direction: "outbound",
      ownershipMode: "platform-managed",
      routeMode: "test_route",
      runtimePath: "pstn-sandwich",
      outcome: "completed",
      catalogId: "catalog-2026-08-v1",
      commercialMode: "payg",
      routeRateId: "twilio-ng-outbound",
      runtimeSeconds: 10,
      providerConnectedSeconds: 10,
      occurredAt: "2026-08-09T22:00:10.000Z",
    });

    const entries = await repository.listLedgerEntries("tenant-phone-test");
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.metadata.usageContext === "phone_test")).toBe(true);
    expect(entries[1]).toEqual(expect.objectContaining({ customerAmountMinor: 35 }));
  });

  it("keeps terminal usage incomplete when no catalog is effective", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    const producer = new TrustedBillingUsageProducer(repository);

    const result = await producer.recordTerminalCall({
      organizationId: "tenant-no-catalog",
      workspaceId: "workspace-no-catalog",
      callSessionId: "call-no-catalog",
      providerConnectionId: "connection-byo",
      provider: "twilio",
      direction: "inbound",
      ownershipMode: "byo",
      routeMode: "live_route",
      runtimePath: "pstn-sandwich",
      outcome: "completed",
      commercialMode: "payg",
      runtimeSeconds: 12,
      providerConnectedSeconds: 12,
      occurredAt: "2026-08-09T23:00:12.000Z",
    });

    expect(result).toEqual({ recorded: 1, duplicates: 0, incomplete: 1 });
    const entries = await repository.listLedgerEntries("tenant-no-catalog");
    expect(entries[0]).toEqual(expect.objectContaining({
      quantity: 12,
      currency: "usd",
      metadata: expect.objectContaining({
        billingDisposition: "incomplete",
        incompleteReasons: ["missing_effective_price_catalog"],
      }),
    }));
    expect(entries[0]).not.toHaveProperty("catalogId");
    expect(entries[0]).not.toHaveProperty("customerAmountMinor");
  });

  it("keeps subscription usage incomplete when the assigned plan rate is missing", async () => {
    const repository = new PostgresBillingLedgerRepository(pool);
    await repository.publishPriceCatalog(createCatalog());
    const producer = new TrustedBillingUsageProducer(repository);

    const result = await producer.recordTerminalCall({
      organizationId: "tenant-plan-gap",
      workspaceId: "workspace-plan-gap",
      callSessionId: "call-plan-gap",
      providerConnectionId: "connection-byo",
      provider: "twilio",
      direction: "inbound",
      ownershipMode: "byo",
      routeMode: "live_route",
      runtimePath: "pstn-sandwich",
      outcome: "completed",
      catalogId: "catalog-2026-08-v1",
      commercialMode: "subscription",
      planSlug: "unknown-plan",
      runtimeSeconds: 60,
      providerConnectedSeconds: 60,
      occurredAt: "2026-08-09T23:30:00.000Z",
    });

    expect(result).toEqual({ recorded: 1, duplicates: 0, incomplete: 1 });
    const entries = await repository.listLedgerEntries("tenant-plan-gap");
    expect(entries[0]?.metadata).toEqual(expect.objectContaining({
      billingDisposition: "incomplete",
      incompleteReasons: ["missing_customer_runtime_rate"],
    }));
  });
});

function createCatalog() {
  return {
    id: "catalog-2026-08-v1",
    version: 1,
    status: "active" as const,
    currency: "usd" as const,
    effectiveFrom: "2026-08-09T00:00:00.000Z",
    checksum: "a".repeat(64),
    document: {
      payg: {
        standardRuntimePerMinuteMinor: 18,
        premiumRuntimePerMinuteMinor: 45,
      },
      plans: {
        starter: {
          standardRuntimePerMinuteMinor: 15,
          premiumRuntimePerMinuteMinor: 40,
        },
      },
      telephonyRoutes: {
        "twilio-ng-outbound": {
          provider: "twilio",
          direction: "outbound",
          customerRateMinorPerMinute: 35,
          rounding: "next_full_minute",
        },
      },
    },
    approvedBy: "billing-approver",
    approvedAt: "2026-08-09T00:00:00.000Z",
    createdAt: "2026-08-09T00:00:00.000Z",
  };
}
