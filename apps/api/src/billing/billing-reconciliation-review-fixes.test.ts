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
    expect(report).toMatchObject({ status: "matched", evidenceId: "report-evidence-1" });
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

    expect(report.status).toBe("mismatch");
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
        deliveryMode: "shadow",
        status: "pending",
      },
      {
        id: "outbox-payg",
        aggregateId: "debit-1",
        meterKey: "payg_charge_minor",
        quantity: 20,
        deliveryMode: "shadow",
        status: "pending",
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
