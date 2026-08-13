import { describe, expect, it } from "vitest";

import { BillingOutboxObservability } from "./billing-outbox-observability";
import type {
  BillingReleaseDrillReportRepository,
  StoredBillingReleaseDrillReport,
} from "./billing-release-drill-report.repository";
import type {
  BillingReleaseDrillOperationEvidence,
  BillingReleaseDrillOperationEvidenceReader,
} from "./billing-release-drill-operation-evidence.repository";
import { BillingReleaseDrillQualificationService } from "./billing-release-drill-qualification.service";
import { BillingUsageReconciliationService } from "./billing-usage-reconciliation.service";

describe("BillingReleaseDrillQualificationService", () => {
  it("qualifies every required PAYG and billing drill with machine-readable evidence", () => {
    const service = qualificationService();

    const result = service.run(healthyQualificationInput());

    expect(result.schemaVersion).toBe("zara.billing-drill-qualification.v1");
    expect(result.chargeDeliveryEnabled).toBe(false);
    expect(result).not.toHaveProperty("approvalEvidence");
    expect(result).not.toHaveProperty("canaryEvidence");
    expect(result.status).toBe("passed");
    expect(result.drills.map((drill) => drill.id)).toEqual([
      "top_up",
      "paid_grant",
      "reservation",
      "debit_finalization",
      "refund_reversal",
      "zero_balance_stop",
      "duplicate_event",
      "late_event",
      "adjustment",
      "invoice_dispute",
      "rollback",
      "charge_stop",
    ]);
    expect(result.drills.every((drill) => drill.status === "passed")).toBe(true);
    expect(result.drills.find((drill) => drill.id === "debit_finalization")?.evidence).toEqual({
      actualChargeMinor: 125,
      balanceAfterMinor: 375,
      debitCount: 1,
      reservedAfterMinor: 0,
    });
    expect(result.alerts.every((alert) => alert.status === "clear")).toBe(true);
  });

  it("fails unsafe drill observations without creating approval or enabling delivery", () => {
    const service = qualificationService();
    const input = healthyQualificationInput();
    input.payg.finalization.debitCount = 2;
    input.payg.zeroBalance.stoppedAfterCurrentTurn = false;
    input.operations.chargeStop.usageFactsAfter = 8;
    input.operations.chargeStop.usageFactsBefore = 7;
    input.operations.chargeStop.deliveredChargeCountAfter = 1;

    const result = service.run(input);

    expect(result.status).toBe("failed");
    expect(result.chargeDeliveryEnabled).toBe(false);
    expect(result).not.toHaveProperty("approvalEvidence");
    expect(result).not.toHaveProperty("canaryEvidence");
    expect(result.drills.find((drill) => drill.id === "debit_finalization")).toMatchObject({
      status: "failed",
      failureCode: "payg_debit_not_exactly_once",
    });
    expect(result.drills.find((drill) => drill.id === "zero_balance_stop")).toMatchObject({
      status: "failed",
      failureCode: "payg_zero_balance_did_not_stop",
    });
    expect(result.drills.find((drill) => drill.id === "charge_stop")).toMatchObject({
      status: "failed",
      failureCode: "charge_delivery_continued",
    });
  });

  it("classifies each required release alert from observed evidence", () => {
    const service = qualificationService();
    const input = healthyQualificationInput();
    input.signals = {
      outboxPendingCount: 11,
      oldestPendingAgeSeconds: 301,
      deadLetterCount: 1,
      webhookLagSeconds: 901,
      ledgerDifferenceMinor: 1,
      paygPolarBalanceMinor: 374,
      reconciliationFailureCount: 1,
      chargedMinorThisWindow: 101,
      expectedMaxChargeMinorThisWindow: 100,
    };

    expect(service.run(input).alerts).toEqual([
      alert("outbox_backlog", "billing_delivery"),
      alert("dead_letters", "billing_delivery"),
      alert("webhook_lag", "billing_integrations"),
      alert("ledger_mismatch", "billing_reconciliation"),
      alert("payg_mismatch", "billing_reconciliation"),
      alert("reconciliation_failure", "billing_reconciliation"),
      alert("unexpected_charge_growth", "billing_release_owner"),
    ]);
  });

  it("persists full failed drill evidence and reads it only by tenant and release scope", async () => {
    const repository = new InMemoryDrillReportRepository();
    const evidence = durableEvidence();
    evidence.find((item) => item.drillId === "zero_balance_stop")!.observedResult = {
      remainingMinor: 0,
      nextSegmentMinor: 1,
      stoppedAfterCurrentTurn: false,
    };
    const service = qualificationService(repository, new InMemoryEvidenceReader(evidence));
    const input = runIdentity();

    const first = await service.runAndPersist(input);
    const replay = await service.runAndPersist(input);

    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);
    expect(first.report).toMatchObject({
      schemaVersion: "zara.billing-drill-qualification.v1",
      reportId: "drill-report:run-2026-08-12",
      organizationId: "tenant-internal",
      releaseId: "release-2026-08-12.1",
      catalog: { id: "catalog-v1", version: 1 },
      executedAt: "2026-08-12T08:00:00.000Z",
      status: "failed",
    });
    expect(first.report.drills.find((drill) => drill.id === "zero_balance_stop")).toMatchObject({
      status: "failed",
      failureCode: "payg_zero_balance_did_not_stop",
      source: {
        operationRecordIds: ["record-zero_balance_stop"],
        evidenceHash: "a".repeat(64),
        fetchedAt: "2026-08-12T09:00:00.000Z",
      },
    });
    expect(first.report).not.toHaveProperty("approvalEvidence");
    expect(first.report).not.toHaveProperty("canaryEvidence");
    await expect(service.listEvidence({
      organizationId: "tenant-other",
      releaseId: input.releaseId,
    })).resolves.toEqual([]);
    await expect(service.listEvidence({
      organizationId: input.organizationId,
      releaseId: input.releaseId,
    })).resolves.toEqual([first.report]);
  });

  it("rejects a changed replay under the same tenant report ID", async () => {
    const reader = new InMemoryEvidenceReader(durableEvidence());
    const service = qualificationService(new InMemoryDrillReportRepository(), reader);
    const input = runIdentity();
    await service.runAndPersist(input);
    reader.evidence.find((item) => item.drillId === "charge_stop")!.observedResult = {
      deliveryDisabled: true,
      usageFactsBefore: 7,
      usageFactsAfter: 8,
      deliveredChargeCountAfter: 1,
    };

    await expect(service.runAndPersist(input)).rejects.toThrow(
      "Drill report replay does not match the stored evidence.",
    );
  });

  it("ignores spoofed caller outcomes and persists the trusted durable result", async () => {
    const evidence = durableEvidence();
    evidence.find((item) => item.drillId === "paid_grant")!.observedResult = {
      grantAmountMinor: 500,
      grantCount: 0,
    };
    const service = qualificationService(
      new InMemoryDrillReportRepository(),
      new InMemoryEvidenceReader(evidence),
    );

    const result = await service.runAndPersist({
      ...runIdentity(),
      paidGrantPassed: true,
      grantCount: 1,
    } as never);

    expect(result.report.status).toBe("failed");
    expect(result.report.drills.find((drill) => drill.id === "paid_grant")).toMatchObject({
      status: "failed",
      failureCode: "payg_grant_not_exactly_once",
    });
  });

  it("fails every missing durable drill and cannot use another tenant's evidence", async () => {
    const reader = new InMemoryEvidenceReader(durableEvidence());
    const service = qualificationService(new InMemoryDrillReportRepository(), reader);

    const noRecords = await service.runAndPersist({ ...runIdentity(), runId: "missing-run" });
    const crossTenant = await service.runAndPersist({
      ...runIdentity(),
      organizationId: "tenant-other",
      runId: "cross-tenant-run",
    });

    expect(noRecords.report.status).toBe("failed");
    expect(noRecords.report.drills).toHaveLength(12);
    expect(noRecords.report.drills.every((drill) =>
      drill.failureCode === "durable_operation_evidence_missing"
    )).toBe(true);
    expect(crossTenant.report.status).toBe("failed");
    expect(crossTenant.report.drills.every((drill) =>
      drill.failureCode === "durable_operation_evidence_missing"
    )).toBe(true);
  });
});

function qualificationService(
  repository?: BillingReleaseDrillReportRepository,
  evidenceReader?: BillingReleaseDrillOperationEvidenceReader,
) {
  const observability = new BillingOutboxObservability();
  return new BillingReleaseDrillQualificationService(
    new BillingUsageReconciliationService(observability),
    repository,
    evidenceReader,
  );
}

function alert(
  classification: string,
  owner: string,
) {
  return {
    classification,
    owner,
    severity: "release_blocking",
    status: "alert",
  };
}

function healthyQualificationInput() {
  return {
    reportId: "drill-report-2026-08-12",
    idempotencyKey: "drill-release-2026-08-12.1-tenant-internal",
    releaseId: "release-2026-08-12.1",
    catalog: { id: "catalog-v1", version: 1 },
    executedAt: "2026-08-12T08:00:00.000Z",
    validUntil: "2026-08-13T08:00:00.000Z",
    organizationId: "tenant-internal",
    payg: {
      topUp: {
        currency: "USD",
        orderAmountMinor: 500,
        packProductKey: "payg-5-usd",
        paid: true,
      },
      grant: {
        grantAmountMinor: 500,
        grantCount: 1,
      },
      reservation: {
        availableBeforeMinor: 500,
        requestedMinor: 200,
        reservedAfterMinor: 200,
        accepted: true,
      },
      finalization: {
        actualChargeMinor: 125,
        balanceAfterMinor: 375,
        debitCount: 1,
        reservedAfterMinor: 0,
      },
      refund: {
        unusedGrantMinor: 500,
        reversalMinor: 500,
        balanceAfterMinor: 0,
        reversalCount: 1,
      },
      zeroBalance: {
        remainingMinor: 0,
        nextSegmentMinor: 1,
        stoppedAfterCurrentTurn: true,
      },
      creditEntries: [
        { id: "grant-1", entryType: "grant" as const, amountMinor: 500 },
        { id: "debit-1", entryType: "debit" as const, amountMinor: 125 },
      ],
    },
    operations: {
      duplicate: {
        receivedCount: 2,
        durableFactCount: 1,
        customerChargeCount: 1,
      },
      lateEvent: {
        cycleStartsAt: "2026-08-01T00:00:00.000Z",
        cycleEndsAt: "2026-09-01T00:00:00.000Z",
        zaraEvents: [{
          externalEventId: "late-event-1",
          meterKey: "standard_runtime_seconds",
          quantity: 60,
          occurredAt: "2026-08-31T23:59:00.000Z",
        }],
        polarEvents: [{
          externalEventId: "late-event-1",
          quantity: 60,
          receivedAt: "2026-09-01T00:01:00.000Z",
        }],
        preservedForCorrection: true,
      },
      adjustment: {
        originalLedgerEntryPreserved: true,
        adjustmentCount: 1,
        auditRecordCount: 1,
      },
      invoiceDispute: {
        invoiceFrozen: true,
        evidenceLinked: true,
        correctionUsesAdjustment: true,
      },
      rollback: {
        deliveryDisabled: true,
        usageFactsBefore: 7,
        usageFactsAfter: 7,
        duplicateChargeCount: 0,
      },
      chargeStop: {
        deliveryDisabled: true,
        usageFactsBefore: 7,
        usageFactsAfter: 8,
        deliveredChargeCountAfter: 0,
      },
    },
    signals: {
      outboxPendingCount: 0,
      oldestPendingAgeSeconds: 0,
      deadLetterCount: 0,
      webhookLagSeconds: 0,
      ledgerDifferenceMinor: 0,
      paygPolarBalanceMinor: 375,
      reconciliationFailureCount: 0,
      chargedMinorThisWindow: 0,
      expectedMaxChargeMinorThisWindow: 0,
    },
    thresholds: {
      outboxPendingCount: 10,
      outboxOldestAgeSeconds: 300,
      webhookLagSeconds: 900,
    },
  };
}

function runIdentity() {
  return {
    organizationId: "tenant-internal",
    releaseId: "release-2026-08-12.1",
    catalog: { id: "catalog-v1", version: 1 },
    runId: "run-2026-08-12",
  };
}

function durableEvidence(): BillingReleaseDrillOperationEvidence[] {
  const input = healthyQualificationInput();
  const observations: Record<string, Record<string, unknown>> = {
    top_up: input.payg.topUp,
    paid_grant: input.payg.grant,
    reservation: input.payg.reservation,
    debit_finalization: input.payg.finalization,
    refund_reversal: input.payg.refund,
    zero_balance_stop: input.payg.zeroBalance,
    duplicate_event: input.operations.duplicate,
    late_event: input.operations.lateEvent,
    adjustment: input.operations.adjustment,
    invoice_dispute: input.operations.invoiceDispute,
    rollback: input.operations.rollback,
    charge_stop: input.operations.chargeStop,
    release_signals: {
      ...input.signals,
      thresholds: input.thresholds,
      creditEntries: input.payg.creditEntries,
    },
  };
  return Object.entries(observations).map(([drillId, observedResult]) => ({
    id: `evidence-${drillId}`,
    organizationId: input.organizationId,
    runId: "run-2026-08-12",
    releaseId: input.releaseId,
    catalogId: input.catalog.id,
    catalogVersion: input.catalog.version,
    drillId,
    sourceType: "execution_record",
    sourceRecordId: `record-${drillId}`,
    evidenceHash: "a".repeat(64),
    operationRecordIds: [`record-${drillId}`],
    observedResult,
    executedAt: input.executedAt,
    fetchedAt: "2026-08-12T09:00:00.000Z",
  }));
}

class InMemoryEvidenceReader implements BillingReleaseDrillOperationEvidenceReader {
  constructor(public readonly evidence: BillingReleaseDrillOperationEvidence[]) {}

  async loadRun(input: {
    organizationId: string;
    runId: string;
    releaseId: string;
    catalogId: string;
  }) {
    return this.evidence.filter((item) =>
      item.organizationId === input.organizationId
      && item.runId === input.runId
      && item.releaseId === input.releaseId
      && item.catalogId === input.catalogId
    );
  }
}

class InMemoryDrillReportRepository implements BillingReleaseDrillReportRepository {
  private readonly reports = new Map<string, StoredBillingReleaseDrillReport>();

  async save(report: StoredBillingReleaseDrillReport) {
    const key = `${report.organizationId}:${report.reportId}`;
    const existing = this.reports.get(key);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(report)) {
        throw new Error("Drill report replay does not match the stored evidence.");
      }
      return { report: existing, duplicate: true };
    }
    this.reports.set(key, structuredClone(report));
    return { report, duplicate: false };
  }

  async listByRelease(input: { organizationId: string; releaseId: string }) {
    return [...this.reports.values()].filter((report) =>
      report.organizationId === input.organizationId
      && report.releaseId === input.releaseId
    );
  }
}
