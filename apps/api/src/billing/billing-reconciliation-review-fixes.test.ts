import { describe, expect, it, vi } from "vitest";

import {
  BillingUsageReconciliationService,
  type BillingCycleLocalEvidence,
  type BillingDraftInvoiceEvidenceSource,
  type BillingPolarMeterEvidenceSource,
  type BillingProviderUsageEvidenceSource,
  type BillingReconciliationReportRepository,
} from "./billing-usage-reconciliation.service";

describe("Billing reconciliation reviewed accounting", () => {
  it("keeps gross carrier cents separate from a prepaid carrier remainder", async () => {
    const local = localEvidence();
    local.ledger.push({ id: "carrier", entryType: "telephony_charge", meterKey: "platform_telephony_charge_minor",
      quantity: 61, customerAmountMinor: 10,
      grossCustomerAmountMinor: 70, settlementMeterKey: "subscription_charge_minor" });
    local.outbox.push({ id: "carrier-outbox", aggregateId: "carrier", meterKey: "subscription_charge_minor",
      quantity: 10, deliveryMode: "charge", status: "delivered" });
    const sources = evidenceSources(110);
    for (const [source, quantities] of [
      [sources.provider, { standard_runtime_seconds: 60, platform_telephony_charge_minor: 70 }],
      [sources.polar, { standard_runtime_seconds: 60, subscription_charge_minor: 10, payg_charge_minor: 20 }],
    ] as const) {
      source.loadTenantCycleEvidence.mockResolvedValue({ ...(await source.loadTenantCycleEvidence(cycleInput())), quantities });
    }
    const report = await new BillingUsageReconciliationService(undefined, repositoryWith(local), sources.provider, sources.polar, sources.invoice)
      .reconcileTenantCycle(cycleInput());
    expect(report).toMatchObject({ customerStatus: "matched", supplierStatus: "matched",
      sources: { zaraLedger: { quantities: { platform_telephony_charge_minor: 70 } } } });
  });
  it.each([0, 30])("reconciles a %i-cent subscription remainder while keeping raw supplier usage", async (remainder) => {
    const local = localEvidence();
    Object.assign(local.ledger[0]!, { settlementMeterKey: "subscription_charge_minor", customerAmountMinor: remainder });
    Object.assign(local.outbox[0]!, { meterKey: "subscription_charge_minor", quantity: remainder });
    const sources = evidenceSources(remainder);
    const polar = await sources.polar.loadTenantCycleEvidence(cycleInput());
    sources.polar.loadTenantCycleEvidence.mockResolvedValue({ ...polar,
      quantities: { subscription_charge_minor: remainder, payg_charge_minor: 20 } });
    const report = await new BillingUsageReconciliationService(undefined, repositoryWith(local), sources.provider, sources.polar, sources.invoice)
      .reconcileTenantCycle(cycleInput());
    expect(report).toMatchObject({ customerStatus: "matched", supplierStatus: "matched",
      sources: { zaraLedger: { quantities: { standard_runtime_seconds: 60 }, customerAmountMinor: remainder } } });
  });
  it("compares platform telephony in cents rather than connected seconds", async () => {
    const local = localEvidence();
    local.ledger.push({ id: "carrier", entryType: "telephony_charge", meterKey: "platform_telephony_charge_minor",
      quantity: 61, customerAmountMinor: 70 });
    local.outbox.push({ id: "carrier-outbox", aggregateId: "carrier", meterKey: "platform_telephony_charge_minor",
      quantity: 70, deliveryMode: "charge", status: "delivered" });
    const sources = evidenceSources(170);
    for (const source of [sources.provider, sources.polar]) {
      const existing = await source.loadTenantCycleEvidence(cycleInput());
      source.loadTenantCycleEvidence.mockResolvedValue({ ...existing,
        quantities: { ...existing.quantities, platform_telephony_charge_minor: 70 } });
    }
    const report = await new BillingUsageReconciliationService(undefined, repositoryWith(local), sources.provider, sources.polar, sources.invoice)
      .reconcileTenantCycle(cycleInput());
    expect(report.customerStatus).toBe("matched");
    expect(local.ledger.find(entry => entry.id === "carrier")?.quantity).toBe(61);
  });
  it("includes current eligible pending charges without marking them delivered", async () => {
    const local = localEvidence();
    local.outbox = local.outbox.map(entry => ({ ...entry, status: "pending", deliveryEligible: true }));
    const sources = evidenceSources(100);
    const service = new BillingUsageReconciliationService(undefined, repositoryWith(local), sources.provider, sources.polar, sources.invoice);
    const report = await service.reconcileTenantCycle(cycleInput());
    expect(report).toMatchObject({ customerStatus: "matched", sources: { outbox: { statuses: { pending: 2, delivered: 0 } } } });
  });
  it("compares customer charges without historical shadow or abandoned delivery usage", async () => {
    const local = localEvidence();
    local.outbox = local.outbox.map(entry => ({ ...entry, deliveryMode: "charge", status: "delivered" }));
    for (const [id, deliveryMode] of [["historical", "shadow"], ["abandoned", "charge"]] as const) {
      local.ledger.push({ id, entryType: "runtime_charge", meterKey: "standard_runtime_seconds", quantity: 120, customerAmountMinor: 200 });
      local.outbox.push({ id: `outbox-${id}`, aggregateId: id, meterKey: "standard_runtime_seconds", quantity: 120,
        deliveryMode, status: "pending" });
    }
    const sources = evidenceSources(100);
    sources.provider.loadTenantCycleEvidence.mockResolvedValue({
      ...(await sources.provider.loadTenantCycleEvidence(cycleInput())), quantities: { standard_runtime_seconds: 300 },
    });
    const service = new BillingUsageReconciliationService(undefined, repositoryWith(local), sources.provider, sources.polar, sources.invoice);
    const report = await service.reconcileTenantCycle(cycleInput());
    expect(report).toMatchObject({ customerStatus: "matched", supplierStatus: "matched",
      sources: { zaraLedger: { quantities: { standard_runtime_seconds: 300 }, customerAmountMinor: 500 } } });
  });
  it("keeps missing supplier evidence separate from matched customer charges", async () => {
    const repository = repositoryWith(localEvidence());
    const sources = evidenceSources(100);
    sources.provider.loadTenantCycleEvidence.mockResolvedValue(null);
    const service = new BillingUsageReconciliationService(
      undefined, repository, sources.provider, sources.polar, sources.invoice,
    );

    const report = await service.reconcileTenantCycle(cycleInput());

    expect(report).toMatchObject({
      status: "mismatch",
      customerStatus: "matched",
      supplierStatus: "mismatch",
      customerMismatchCount: 0,
      supplierMismatchCount: 1,
      mismatches: [expect.objectContaining({ mismatchClass: "missing_provider_usage_evidence" })],
    });
  });

  it("completes customer checks when the supplier evidence source fails", async () => {
    const repository = repositoryWith(localEvidence());
    const sources = evidenceSources(100);
    sources.provider.loadTenantCycleEvidence.mockRejectedValue(new Error("Supplier unavailable"));
    const service = new BillingUsageReconciliationService(
      undefined, repository, sources.provider, sources.polar, sources.invoice,
    );

    const report = await service.reconcileTenantCycle(cycleInput());

    expect(report).toMatchObject({
      status: "mismatch", customerStatus: "matched", supplierStatus: "mismatch",
      sources: { providerUsage: { status: "missing" } },
    });
  });

  it("completes customer checks without a configured supplier source", async () => {
    const sources = evidenceSources(100);
    const service = new BillingUsageReconciliationService(
      undefined, repositoryWith(localEvidence()), undefined, sources.polar, sources.invoice,
    );
    expect(await service.reconcileTenantCycle(cycleInput())).toMatchObject({
      customerStatus: "matched", supplierStatus: "mismatch",
    });
  });

  it("loads external evidence from server adapters and persists a matched report", async () => {
    const repository = repositoryWith(localEvidence());
    const sources = evidenceSources(100);
    const service = new BillingUsageReconciliationService(
      undefined,
      repository,
      sources.provider,
      sources.polar,
      sources.invoice,
    );

    const report = await service.reconcileTenantCycle({
      organizationId: "tenant-a",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
      runKey: "daily:2026-09-01",
      releaseId: "release-1",
      catalogId: "catalog-1",
      validUntil: "2026-09-02T00:00:00.000Z",
    });

    expect(sources.provider.loadTenantCycleEvidence).toHaveBeenCalledTimes(1);
    expect(sources.polar.loadTenantCycleEvidence).toHaveBeenCalledTimes(1);
    expect(sources.invoice.loadTenantCycleEvidence).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({
      status: "matched", customerStatus: "matched", supplierStatus: "matched",
      evidenceId: "report-evidence-1",
    });
    expect(repository.appendReport).toHaveBeenCalledWith(expect.objectContaining({
      runKey: "daily:2026-09-01",
      status: "matched",
      mismatchCount: 0,
    }));
  });

  it("filters non-meter facts and applies debit and credit adjustments to the invoice total", async () => {
    const local = localEvidence();
    local.ledger.push(
      {
        id: "adjustment-debit",
        entryType: "adjustment",
        meterKey: null,
        adjustmentKind: "debit",
        quantity: 1,
        customerAmountMinor: 25,
      },
      {
        id: "adjustment-credit",
        entryType: "adjustment",
        meterKey: null,
        adjustmentKind: "credit",
        quantity: 1,
        customerAmountMinor: 10,
      },
      {
        id: "credit-grant",
        entryType: "credit",
        meterKey: null,
        quantity: 1,
        customerAmountMinor: null,
      },
    );
    const repository = repositoryWith(local);
    const sources = evidenceSources(115);
    const service = new BillingUsageReconciliationService(
      undefined, repository, sources.provider, sources.polar, sources.invoice,
    );

    const report = await service.reconcileTenantCycle(cycleInput());

    expect(report.status).toBe("matched");
    expect(report.sources.zaraLedger).toMatchObject({
      entryCount: 4,
      meteredEntryCount: 1,
      customerAmountMinor: 115,
    });
    expect(report.mismatches).toEqual([]);
  });

  it("matches a refunded PAYG order directly to its reversal without a refund credit entry", async () => {
    const local = localEvidence();
    local.payg.orders[0] = {
      id: "order-1",
      status: "refunded",
      paidAmountMinor: 500,
      grantedCreditMinor: 500,
    };
    local.payg.creditEntries.push({
      orderId: "order-1",
      entryType: "reversal",
      amountMinor: 500,
    });
    const repository = repositoryWith(local);
    const sources = evidenceSources(100);
    const service = new BillingUsageReconciliationService(
      undefined, repository, sources.provider, sources.polar, sources.invoice,
    );

    const report = await service.reconcileTenantCycle(cycleInput());

    const mismatchClasses = report.mismatches.map((item) => item.mismatchClass);
    expect(mismatchClasses).not.toContain("payg_order_grant_mismatch");
    expect(mismatchClasses).not.toContain("payg_refund_reversal_mismatch");
    expect(report.sources.payg).toMatchObject({ refundedMinor: 500, reversedMinor: 500 });
  });

  it("persists a mismatched report after it stores mismatch audit evidence", async () => {
    const repository = repositoryWith(localEvidence());
    const sources = evidenceSources(101);
    const service = new BillingUsageReconciliationService(
      undefined, repository, sources.provider, sources.polar, sources.invoice,
    );

    const report = await service.reconcileTenantCycle(cycleInput());

    expect(report).toMatchObject({
      status: "mismatch", customerStatus: "mismatch", supplierStatus: "matched",
      customerMismatchCount: 1, supplierMismatchCount: 0,
    });
    expect(repository.appendMismatchEvidence).toHaveBeenCalled();
    expect(repository.appendReport).toHaveBeenCalledWith(expect.objectContaining({
      status: "mismatch",
      mismatchCount: 1,
      report: expect.objectContaining({
        mismatches: [expect.objectContaining({ evidenceId: "mismatch-evidence-1" })],
      }),
    }));
  });

  it("rejects evidence with the wrong tenant-cycle scope or stale fetch time", async () => {
    const repository = repositoryWith(localEvidence());
    const sources = evidenceSources(100);
    vi.mocked(sources.provider.loadTenantCycleEvidence).mockResolvedValue({
      ...(await sources.provider.loadTenantCycleEvidence(cycleInput()))!,
      organizationId: "tenant-b",
    });
    vi.mocked(sources.polar.loadTenantCycleEvidence).mockResolvedValue({
      ...(await sources.polar.loadTenantCycleEvidence(cycleInput()))!,
      fetchedAt: "2026-08-31T23:59:59.000Z",
    });
    const service = new BillingUsageReconciliationService(
      undefined, repository, sources.provider, sources.polar, sources.invoice,
    );

    const report = await service.reconcileTenantCycle(cycleInput());

    expect(report.sources.providerUsage).toEqual({ status: "missing" });
    expect(report.sources.polarMeters).toEqual({ status: "missing" });
    expect(report.mismatches.map((item) => item.mismatchClass)).toEqual(expect.arrayContaining([
      "missing_provider_usage_evidence",
      "missing_polar_meter_evidence",
    ]));
  });
});

function cycleInput() {
  return {
    organizationId: "tenant-a",
    cycleStartsAt: "2026-08-01T00:00:00.000Z",
    cycleEndsAt: "2026-09-01T00:00:00.000Z",
    runKey: "daily:2026-09-01",
    releaseId: "release-1",
    catalogId: "catalog-1",
    validUntil: "2026-09-02T00:00:00.000Z",
  };
}

function repositoryWith(local: BillingCycleLocalEvidence) {
  return {
    loadLocalCycleEvidence: vi.fn().mockResolvedValue(local),
    appendMismatchEvidence: vi.fn().mockResolvedValue({ evidenceId: "mismatch-evidence-1" }),
    appendReport: vi.fn().mockResolvedValue({ evidenceId: "report-evidence-1" }),
    listTenantCycles: vi.fn().mockResolvedValue([]),
  } satisfies BillingReconciliationReportRepository;
}

function evidenceSources(invoiceAmountMinor: number) {
  const scope = {
    sourceId: "test-source",
    fetchedAt: "2026-09-01T01:00:00.000Z",
    organizationId: "tenant-a",
    catalogId: "catalog-1",
    cycleStartsAt: "2026-08-01T00:00:00.000Z",
    cycleEndsAt: "2026-09-01T00:00:00.000Z",
  };
  const provider = {
    loadTenantCycleEvidence: vi.fn().mockResolvedValue({
      evidenceId: "provider-1",
      ...scope,
      quantities: { standard_runtime_seconds: 60 },
    }),
  } satisfies BillingProviderUsageEvidenceSource;
  const polar = {
    loadTenantCycleEvidence: vi.fn().mockResolvedValue({
      evidenceId: "polar-1",
      ...scope,
      quantities: { standard_runtime_seconds: 60, payg_charge_minor: 20 },
    }),
  } satisfies BillingPolarMeterEvidenceSource;
  const invoice = {
    loadTenantCycleEvidence: vi.fn().mockResolvedValue({
      evidenceId: "invoice-1",
      ...scope,
      amountMinor: invoiceAmountMinor,
      currency: "usd",
    }),
  } satisfies BillingDraftInvoiceEvidenceSource;
  return { provider, polar, invoice };
}

function localEvidence(): BillingCycleLocalEvidence {
  return {
    ledger: [{
      id: "ledger-1",
      entryType: "runtime_charge",
      meterKey: "standard_runtime_seconds",
      quantity: 60,
      customerAmountMinor: 100,
    }],
    outbox: [
      {
        id: "outbox-ledger",
        aggregateId: "ledger-1",
        meterKey: "standard_runtime_seconds",
        quantity: 60,
        deliveryMode: "charge",
        status: "delivered",
      },
      {
        id: "outbox-payg",
        aggregateId: "debit-1",
        meterKey: "payg_charge_minor",
        quantity: 20,
        deliveryMode: "charge",
        status: "delivered",
      },
    ],
    payg: {
      orders: [{
        id: "order-1",
        status: "paid",
        paidAmountMinor: 500,
        grantedCreditMinor: 500,
      }],
      creditEntries: [
        { orderId: "order-1", entryType: "grant", amountMinor: 500 },
        { entryType: "debit", amountMinor: 20 },
      ],
      reservations: [],
      reservationSnapshotMinor: 0,
    },
  };
}
