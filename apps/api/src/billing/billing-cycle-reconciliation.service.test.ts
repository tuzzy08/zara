import { describe, expect, it, vi } from "vitest";

import {
  BillingUsageReconciliationService,
  type BillingCycleLocalEvidence,
  type BillingReconciliationReportRepository,
} from "./billing-usage-reconciliation.service";

describe("BillingUsageReconciliationService tenant-cycle reports", () => {
  it("matches ledger, shadow outbox, provider, Polar, invoice, and PAYG evidence", async () => {
    const repository = repositoryWith(matchedLocalEvidence());
    const service = serviceWith(repository, {
      provider: {
        evidenceId: "provider-export-1",
        quantities: {
          standard_runtime_seconds: 60,
          premium_runtime_seconds: 60,
          platform_telephony_charge_minor: 60,
        },
      },
      polar: {
        evidenceId: "polar-meter-export-1",
        polarBalanceMinor: 402,
        quantities: {
          standard_runtime_seconds: 60,
          premium_runtime_seconds: 60,
          platform_telephony_charge_minor: 60,
          payg_charge_minor: 98,
        },
      },
      invoice: { evidenceId: "polar-draft-invoice-1", amountMinor: 98, currency: "usd" },
    });

    const report = await service.reconcileTenantCycle({
      ...cycleRunInput(),
    });

    expect(report.status).toBe("matched");
    expect(report.mismatches).toEqual([]);
    expect(report.sources).toMatchObject({
      zaraLedger: { status: "present", customerAmountMinor: 98 },
      outbox: {
        status: "present",
        deliveryMode: "shadow",
        quantityMinor: 98,
        statuses: { pending: 4, processing: 0, delivered: 0, deadLetter: 0 },
      },
      providerUsage: { status: "present", evidenceId: "provider-export-1" },
      polarMeters: { status: "present", evidenceId: "polar-meter-export-1" },
      draftInvoice: { status: "present", evidenceId: "polar-draft-invoice-1" },
      payg: {
        paidOrderMinor: 500,
        grantedMinor: 500,
        reservedMinor: 0,
        debitedMinor: 98,
        refundedMinor: 0,
        reversedMinor: 0,
      },
    });
    expect(repository.appendMismatchEvidence).not.toHaveBeenCalled();
    expect(repository.appendReport).toHaveBeenCalledWith(expect.objectContaining({
      report: expect.objectContaining({ polarBalanceMinor: 402 }),
    }));
  });

  it("reports missing external evidence and appends one audit evidence record per mismatch", async () => {
    const repository = repositoryWith(matchedLocalEvidence());
    vi.mocked(repository.appendMismatchEvidence)
      .mockResolvedValueOnce({ evidenceId: "recon-audit-1" })
      .mockResolvedValueOnce({ evidenceId: "recon-audit-2" })
      .mockResolvedValueOnce({ evidenceId: "recon-audit-3" });
    const service = serviceWith(repository, { provider: null, polar: null, invoice: null });

    const report = await service.reconcileTenantCycle({
      ...cycleRunInput(),
    });

    expect(report.status).toBe("mismatch");
    expect(report.sources.providerUsage).toEqual({ status: "missing" });
    expect(report.sources.polarMeters).toEqual({ status: "missing" });
    expect(report.sources.draftInvoice).toEqual({ status: "missing" });
    expect(report.mismatches).toEqual([
      expect.objectContaining({
        mismatchClass: "missing_provider_usage_evidence",
        owner: "provider_operations",
        correctionRule: "import_provider_cycle_usage_evidence",
        severity: "critical",
        evidenceId: "recon-audit-1",
      }),
      expect.objectContaining({
        mismatchClass: "missing_polar_meter_evidence",
        owner: "billing_operations",
        correctionRule: "fetch_polar_cycle_meter_evidence",
        severity: "critical",
        evidenceId: "recon-audit-2",
      }),
      expect.objectContaining({
        mismatchClass: "missing_draft_invoice_evidence",
        owner: "finance_operations",
        correctionRule: "fetch_polar_draft_invoice_evidence",
        severity: "high",
        evidenceId: "recon-audit-3",
      }),
    ]);
    expect(repository.appendMismatchEvidence).toHaveBeenCalledTimes(3);
    const persisted = vi.mocked(repository.appendReport).mock.calls[0]?.[0];
    expect(persisted?.report).not.toHaveProperty("polarBalanceMinor");
  });

  it("classifies local, external, invoice, and PAYG amount mismatches with correction ownership", async () => {
    const local = matchedLocalEvidence();
    local.outbox = local.outbox.slice(0, 2);
    local.payg.orders[0]!.grantedCreditMinor = 400;
    local.payg.orders[0]!.status = "refunded";
    local.payg.reservations.push({ status: "active", reservedAmountMinor: 25 });
    const repository = repositoryWith(local);
    vi.mocked(repository.appendMismatchEvidence).mockImplementation(async (mismatch) => ({
      evidenceId: `audit-${mismatch.mismatchClass}`,
    }));
    const service = serviceWith(repository, {
      provider: { evidenceId: "provider-export-2", quantities: { standard_runtime_seconds: 59 } },
      polar: { evidenceId: "polar-meter-export-2", quantities: { payg_charge_minor: 97 } },
      invoice: { evidenceId: "polar-draft-invoice-2", amountMinor: 99, currency: "usd" },
    });

    const report = await service.reconcileTenantCycle({
      ...cycleRunInput(),
    });

    const classes = report.mismatches.map((mismatch) => mismatch.mismatchClass);
    expect(classes).toEqual(expect.arrayContaining([
      "outbox_ledger_mismatch",
      "provider_usage_quantity_mismatch",
      "polar_meter_quantity_mismatch",
      "draft_invoice_total_mismatch",
      "payg_order_grant_mismatch",
      "payg_refund_reversal_mismatch",
      "payg_reservation_balance_mismatch",
      "payg_debit_meter_mismatch",
    ]));
    expect(report.mismatches.every((mismatch) => (
      mismatch.owner.length > 0
      && mismatch.correctionRule.length > 0
      && mismatch.evidenceId.startsWith("audit-")
    ))).toBe(true);
  });
});

function repositoryWith(localEvidence: BillingCycleLocalEvidence) {
  return {
    loadLocalCycleEvidence: vi.fn().mockResolvedValue(localEvidence),
    appendMismatchEvidence: vi.fn().mockResolvedValue({ evidenceId: "recon-audit" }),
    appendReport: vi.fn().mockResolvedValue({ evidenceId: "report-evidence" }),
    listTenantCycles: vi.fn().mockResolvedValue([]),
  } satisfies BillingReconciliationReportRepository;
}

function matchedLocalEvidence(): BillingCycleLocalEvidence {
  return {
    ledger: [
      meter("ledger-standard", "standard_runtime_seconds", 60, 18),
      meter("ledger-premium", "premium_runtime_seconds", 60, 45),
      meter("ledger-telephony", "platform_telephony_charge_minor", 60, 35),
    ],
    outbox: [
      outbox("outbox-standard", "ledger-standard", "standard_runtime_seconds", 60),
      outbox("outbox-premium", "ledger-premium", "premium_runtime_seconds", 60),
      outbox("outbox-telephony", "ledger-telephony", "platform_telephony_charge_minor", 60),
      outbox("outbox-payg", "payg-debit-1", "payg_charge_minor", 98),
    ],
    payg: {
      orders: [{ id: "order-1", status: "paid", paidAmountMinor: 500, grantedCreditMinor: 500 }],
      creditEntries: [
        { orderId: "order-1", entryType: "grant", amountMinor: 500 },
        { entryType: "debit", amountMinor: 98 },
      ],
      reservations: [{ status: "finalized", reservedAmountMinor: 120, actualAmountMinor: 98 }],
      reservationSnapshotMinor: 0,
    },
  };
}

function meter(id: string, meterKey: string, quantity: number, customerAmountMinor: number) {
  return { id, entryType: meterKey === "platform_telephony_charge_minor" ? "telephony_charge" : "runtime_charge", meterKey, quantity, customerAmountMinor };
}

function outbox(
  id: string,
  aggregateId: string,
  meterKey: string,
  quantity: number,
) {
  return {
    id,
    aggregateId,
    meterKey,
    quantity,
    deliveryMode: "shadow" as const,
    status: "pending" as const,
  };
}

function cycleRunInput() {
  return {
    organizationId: "tenant-a",
    cycleStartsAt: "2026-08-01T00:00:00.000Z",
    cycleEndsAt: "2026-09-01T00:00:00.000Z",
    runKey: "daily:release-1:2026-09-01",
    releaseId: "release-1",
    catalogId: "catalog-1",
    validUntil: "2026-09-02T00:00:00.000Z",
  };
}

function serviceWith(
  repository: ReturnType<typeof repositoryWith>,
  evidence: {
    provider: { evidenceId: string; quantities: Record<string, number> } | null;
    polar: { evidenceId: string; quantities: Record<string, number>; polarBalanceMinor?: number } | null;
    invoice: { evidenceId: string; amountMinor: number; currency: string } | null;
  },
) {
  return new BillingUsageReconciliationService(
    undefined,
    repository,
    { loadTenantCycleEvidence: vi.fn().mockResolvedValue(scoped(evidence.provider)) },
    { loadTenantCycleEvidence: vi.fn().mockResolvedValue(scoped(evidence.polar)) },
    { loadTenantCycleEvidence: vi.fn().mockResolvedValue(scoped(evidence.invoice)) },
  );
}

function scoped<T extends Record<string, unknown> | null>(evidence: T) {
  if (evidence === null) return null;
  return {
    sourceId: "test-source",
    fetchedAt: "2026-09-01T01:00:00.000Z",
    organizationId: "tenant-a",
    catalogId: "catalog-1",
    cycleStartsAt: "2026-08-01T00:00:00.000Z",
    cycleEndsAt: "2026-09-01T00:00:00.000Z",
    ...evidence,
  };
}
