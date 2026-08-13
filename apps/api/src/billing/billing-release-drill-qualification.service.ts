import { Inject, Injectable, Optional } from "@nestjs/common";

import {
  BillingUsageReconciliationService,
  type PolarUsageReconciliationEvent,
  type ZaraUsageReconciliationEvent,
} from "./billing-usage-reconciliation.service";
import {
  BILLING_RELEASE_DRILL_REPORT_REPOSITORY,
  type BillingReleaseDrillReportRepository,
  type StoredBillingReleaseDrillReport,
} from "./billing-release-drill-report.repository";
import {
  BILLING_RELEASE_DRILL_OPERATION_EVIDENCE_READER,
  type BillingReleaseDrillOperationEvidence,
  type BillingReleaseDrillOperationEvidenceReader,
} from "./billing-release-drill-operation-evidence.repository";

type DrillId =
  | "top_up"
  | "paid_grant"
  | "reservation"
  | "debit_finalization"
  | "refund_reversal"
  | "zero_balance_stop"
  | "duplicate_event"
  | "late_event"
  | "adjustment"
  | "invoice_dispute"
  | "rollback"
  | "charge_stop";

type AlertClassification =
  | "outbox_backlog"
  | "dead_letters"
  | "webhook_lag"
  | "ledger_mismatch"
  | "payg_mismatch"
  | "reconciliation_failure"
  | "unexpected_charge_growth";

export interface BillingReleaseDrillQualificationInput {
  reportId: string;
  idempotencyKey: string;
  releaseId: string;
  catalog: { id: string; version: number };
  executedAt: string;
  validUntil: string;
  organizationId: string;
  payg: {
    topUp: {
      currency: string;
      orderAmountMinor: number;
      packProductKey: string;
      paid: boolean;
    };
    grant: { grantAmountMinor: number; grantCount: number };
    reservation: {
      availableBeforeMinor: number;
      requestedMinor: number;
      reservedAfterMinor: number;
      accepted: boolean;
    };
    finalization: {
      actualChargeMinor: number;
      balanceAfterMinor: number;
      debitCount: number;
      reservedAfterMinor: number;
    };
    refund: {
      unusedGrantMinor: number;
      reversalMinor: number;
      balanceAfterMinor: number;
      reversalCount: number;
    };
    zeroBalance: {
      remainingMinor: number;
      nextSegmentMinor: number;
      stoppedAfterCurrentTurn: boolean;
    };
    creditEntries: Array<{
      id: string;
      entryType: "grant" | "debit" | "reversal";
      amountMinor: number;
    }>;
  };
  operations: {
    duplicate: {
      receivedCount: number;
      durableFactCount: number;
      customerChargeCount: number;
    };
    lateEvent: {
      cycleStartsAt: string;
      cycleEndsAt: string;
      zaraEvents: ZaraUsageReconciliationEvent[];
      polarEvents: PolarUsageReconciliationEvent[];
      preservedForCorrection: boolean;
    };
    adjustment: {
      originalLedgerEntryPreserved: boolean;
      adjustmentCount: number;
      auditRecordCount: number;
    };
    invoiceDispute: {
      invoiceFrozen: boolean;
      evidenceLinked: boolean;
      correctionUsesAdjustment: boolean;
    };
    rollback: {
      deliveryDisabled: boolean;
      usageFactsBefore: number;
      usageFactsAfter: number;
      duplicateChargeCount: number;
    };
    chargeStop: {
      deliveryDisabled: boolean;
      usageFactsBefore: number;
      usageFactsAfter: number;
      deliveredChargeCountAfter: number;
    };
  };
  signals: {
    outboxPendingCount: number;
    oldestPendingAgeSeconds: number;
    deadLetterCount: number;
    webhookLagSeconds: number;
    ledgerDifferenceMinor: number;
    paygPolarBalanceMinor: number;
    reconciliationFailureCount: number;
    chargedMinorThisWindow: number;
    expectedMaxChargeMinorThisWindow: number;
  };
  thresholds: {
    outboxPendingCount: number;
    outboxOldestAgeSeconds: number;
    webhookLagSeconds: number;
  };
}

export interface BillingReleaseDrillRunIdentity {
  organizationId: string;
  releaseId: string;
  catalog: { id: string; version: number };
  runId: string;
}

interface DrillResult {
  id: DrillId;
  status: "passed" | "failed";
  failureCode?: string;
  evidence: Record<string, boolean | number | string>;
}

interface AlertResult {
  classification: AlertClassification;
  owner:
    | "billing_delivery"
    | "billing_integrations"
    | "billing_reconciliation"
    | "billing_release_owner";
  severity: "release_blocking";
  status: "alert" | "clear";
}

const REQUIRED_DRILL_IDS: DrillId[] = [
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
];

@Injectable()
export class BillingReleaseDrillQualificationService {
  constructor(
    private readonly reconciliation: BillingUsageReconciliationService,
    @Optional()
    @Inject(BILLING_RELEASE_DRILL_REPORT_REPOSITORY)
    private readonly reportRepository?: BillingReleaseDrillReportRepository,
    @Optional()
    @Inject(BILLING_RELEASE_DRILL_OPERATION_EVIDENCE_READER)
    private readonly operationEvidenceReader?: BillingReleaseDrillOperationEvidenceReader,
  ) {}

  run(input: BillingReleaseDrillQualificationInput) {
    const lateReport = this.reconciliation.reconcileCycle({
      organizationId: input.organizationId,
      ...input.operations.lateEvent,
    });
    const paygReport = this.reconciliation.reconcilePaygBalance({
      organizationId: input.organizationId,
      creditEntries: input.payg.creditEntries,
      polarBalanceMinor: input.signals.paygPolarBalanceMinor,
    });
    const drills: DrillResult[] = [
      result(
        "top_up",
        input.payg.topUp.paid
          && input.payg.topUp.currency === "USD"
          && input.payg.topUp.orderAmountMinor === 500
          && input.payg.topUp.packProductKey === "payg-5-usd",
        "payg_top_up_invalid",
        input.payg.topUp,
      ),
      result(
        "paid_grant",
        input.payg.grant.grantAmountMinor === 500
          && input.payg.grant.grantCount === 1,
        "payg_grant_not_exactly_once",
        input.payg.grant,
      ),
      result(
        "reservation",
        input.payg.reservation.accepted
          && input.payg.reservation.availableBeforeMinor >= input.payg.reservation.requestedMinor
          && input.payg.reservation.reservedAfterMinor === input.payg.reservation.requestedMinor,
        "payg_reservation_invalid",
        input.payg.reservation,
      ),
      result(
        "debit_finalization",
        input.payg.finalization.debitCount === 1
          && input.payg.finalization.reservedAfterMinor === 0
          && input.payg.finalization.actualChargeMinor <= input.payg.reservation.requestedMinor
          && input.payg.finalization.balanceAfterMinor
            === input.payg.reservation.availableBeforeMinor - input.payg.finalization.actualChargeMinor,
        input.payg.finalization.debitCount === 1
          ? "payg_finalization_invalid"
          : "payg_debit_not_exactly_once",
        input.payg.finalization,
      ),
      result(
        "refund_reversal",
        input.payg.refund.unusedGrantMinor === 500
          && input.payg.refund.reversalMinor === 500
          && input.payg.refund.balanceAfterMinor === 0
          && input.payg.refund.reversalCount === 1,
        "payg_refund_reversal_invalid",
        input.payg.refund,
      ),
      result(
        "zero_balance_stop",
        input.payg.zeroBalance.remainingMinor < input.payg.zeroBalance.nextSegmentMinor
          && input.payg.zeroBalance.stoppedAfterCurrentTurn,
        "payg_zero_balance_did_not_stop",
        input.payg.zeroBalance,
      ),
      result(
        "duplicate_event",
        input.operations.duplicate.receivedCount > 1
          && input.operations.duplicate.durableFactCount === 1
          && input.operations.duplicate.customerChargeCount === 1,
        "duplicate_event_created_extra_fact",
        input.operations.duplicate,
      ),
      result(
        "late_event",
        lateReport.lateExternalEventIds.length > 0
          && input.operations.lateEvent.preservedForCorrection,
        "late_event_not_preserved",
        {
          lateEventCount: lateReport.lateExternalEventIds.length,
          preservedForCorrection: input.operations.lateEvent.preservedForCorrection,
        },
      ),
      result(
        "adjustment",
        input.operations.adjustment.originalLedgerEntryPreserved
          && input.operations.adjustment.adjustmentCount === 1
          && input.operations.adjustment.auditRecordCount === 1,
        "adjustment_not_append_only_audited",
        input.operations.adjustment,
      ),
      result(
        "invoice_dispute",
        input.operations.invoiceDispute.invoiceFrozen
          && input.operations.invoiceDispute.evidenceLinked
          && input.operations.invoiceDispute.correctionUsesAdjustment,
        "invoice_dispute_controls_incomplete",
        input.operations.invoiceDispute,
      ),
      result(
        "rollback",
        input.operations.rollback.deliveryDisabled
          && input.operations.rollback.usageFactsAfter === input.operations.rollback.usageFactsBefore
          && input.operations.rollback.duplicateChargeCount === 0,
        "rollback_lost_facts_or_duplicated_charges",
        input.operations.rollback,
      ),
      result(
        "charge_stop",
        input.operations.chargeStop.deliveryDisabled
          && input.operations.chargeStop.usageFactsAfter >= input.operations.chargeStop.usageFactsBefore
          && input.operations.chargeStop.deliveredChargeCountAfter === 0,
        "charge_delivery_continued",
        input.operations.chargeStop,
      ),
    ];

    const alerts: AlertResult[] = [
      alert(
        "outbox_backlog",
        "billing_delivery",
        input.signals.outboxPendingCount > input.thresholds.outboxPendingCount
          || input.signals.oldestPendingAgeSeconds > input.thresholds.outboxOldestAgeSeconds,
      ),
      alert("dead_letters", "billing_delivery", input.signals.deadLetterCount > 0),
      alert(
        "webhook_lag",
        "billing_integrations",
        input.signals.webhookLagSeconds > input.thresholds.webhookLagSeconds,
      ),
      alert("ledger_mismatch", "billing_reconciliation", input.signals.ledgerDifferenceMinor !== 0),
      alert("payg_mismatch", "billing_reconciliation", paygReport.status === "mismatch"),
      alert(
        "reconciliation_failure",
        "billing_reconciliation",
        input.signals.reconciliationFailureCount > 0,
      ),
      alert(
        "unexpected_charge_growth",
        "billing_release_owner",
        input.signals.chargedMinorThisWindow > input.signals.expectedMaxChargeMinorThisWindow,
      ),
    ];

    return {
      schemaVersion: "zara.billing-drill-qualification.v1" as const,
      reportId: input.reportId,
      idempotencyKey: input.idempotencyKey,
      releaseId: input.releaseId,
      catalog: input.catalog,
      executedAt: input.executedAt,
      validUntil: input.validUntil,
      organizationId: input.organizationId,
      status: drills.every((drill) => drill.status === "passed")
        && alerts.every((item) => item.status === "clear")
        ? "passed" as const
        : "failed" as const,
      chargeDeliveryEnabled: false as const,
      drills,
      alerts,
    };
  }

  async runAndPersist(input: BillingReleaseDrillRunIdentity) {
    if (this.reportRepository === undefined || this.operationEvidenceReader === undefined) {
      throw new Error("Billing drill report persistence is not configured.");
    }
    const operationEvidence = await this.operationEvidenceReader.loadRun({
      organizationId: input.organizationId,
      runId: input.runId,
      releaseId: input.releaseId,
      catalogId: input.catalog.id,
    });
    return this.reportRepository.save(this.createDurableReport(input, operationEvidence));
  }

  async listEvidence(input: { organizationId: string; releaseId: string }) {
    if (this.reportRepository === undefined) {
      throw new Error("Billing drill report persistence is not configured.");
    }
    return this.reportRepository.listByRelease(input);
  }

  private createDurableReport(
    identity: BillingReleaseDrillRunIdentity,
    evidence: BillingReleaseDrillOperationEvidence[],
  ): StoredBillingReleaseDrillReport {
    const byDrill = new Map(evidence.map((item) => [item.drillId, item]));
    const executedAt = latestExecutedAt(evidence);
    const reportBase = {
      schemaVersion: "zara.billing-drill-qualification.v1" as const,
      evidenceKind: "durable" as const,
      reportId: `drill-report:${identity.runId}`,
      idempotencyKey: `billing-release-drills:${identity.releaseId}:${identity.runId}`,
      organizationId: identity.organizationId,
      releaseId: identity.releaseId,
      catalog: identity.catalog,
      executedAt,
      validUntil: addHours(executedAt, 24),
      chargeDeliveryEnabled: false as const,
    };
    const scopeIsTrusted = evidence.every((item) =>
      item.organizationId === identity.organizationId
      && item.releaseId === identity.releaseId
      && item.runId === identity.runId
      && item.catalogId === identity.catalog.id
      && item.catalogVersion === identity.catalog.version
    );
    const missing = REQUIRED_DRILL_IDS.filter((id) => !byDrill.has(id));
    if (!scopeIsTrusted || missing.length > 0) {
      const drills = REQUIRED_DRILL_IDS.map((id) => {
        const item = scopeIsTrusted ? byDrill.get(id) : undefined;
        return {
          id,
          status: "failed" as const,
          failureCode: item === undefined
            ? "durable_operation_evidence_missing"
            : "durable_run_evidence_incomplete",
          evidence: {},
          source: item === undefined ? null : source(item),
        };
      });
      return {
        ...reportBase,
        status: "failed",
        drills,
        alerts: releaseBlockingAlerts(),
      };
    }

    const signalsEvidence = byDrill.get("release_signals");
    if (signalsEvidence === undefined) {
      return {
        ...reportBase,
        status: "failed",
        drills: REQUIRED_DRILL_IDS.map((id) => ({
          id,
          status: "failed" as const,
          failureCode: "durable_release_signal_evidence_missing",
          evidence: {},
          source: source(byDrill.get(id)!),
        })),
        alerts: releaseBlockingAlerts(),
      };
    }

    const fixture = fixtureFromEvidence(reportBase, byDrill, signalsEvidence);
    const evaluated = this.run(fixture);
    const drills = evaluated.drills.map((drill) => ({
      ...drill,
      source: source(byDrill.get(drill.id)!),
    }));
    return {
      ...reportBase,
      status: drills.every((drill) => drill.status === "passed")
        && evaluated.alerts.every((alert) => alert.status === "clear")
        ? "passed"
        : "failed",
      drills,
      alerts: evaluated.alerts,
    };
  }
}

function result(
  id: DrillId,
  passed: boolean,
  failureCode: string,
  evidence: Record<string, boolean | number | string>,
): DrillResult {
  return {
    id,
    status: passed ? "passed" : "failed",
    ...(passed ? {} : { failureCode }),
    evidence,
  };
}

function alert(
  classification: AlertClassification,
  owner: AlertResult["owner"],
  triggered: boolean,
): AlertResult {
  return {
    classification,
    owner,
    severity: "release_blocking",
    status: triggered ? "alert" : "clear",
  };
}

function source(evidence: BillingReleaseDrillOperationEvidence) {
  return {
    evidenceId: evidence.id,
    sourceType: evidence.sourceType,
    sourceRecordId: evidence.sourceRecordId,
    operationRecordIds: evidence.operationRecordIds,
    evidenceHash: evidence.evidenceHash,
    fetchedAt: evidence.fetchedAt,
  };
}

function latestExecutedAt(evidence: BillingReleaseDrillOperationEvidence[]) {
  if (evidence.length === 0) return new Date(0).toISOString();
  return evidence.reduce((latest, item) =>
    Date.parse(item.executedAt) > Date.parse(latest) ? item.executedAt : latest,
  evidence[0]!.executedAt);
}

function addHours(timestamp: string, hours: number) {
  return new Date(Date.parse(timestamp) + hours * 60 * 60 * 1_000).toISOString();
}

function releaseBlockingAlerts(): AlertResult[] {
  return [
    alert("outbox_backlog", "billing_delivery", true),
    alert("dead_letters", "billing_delivery", true),
    alert("webhook_lag", "billing_integrations", true),
    alert("ledger_mismatch", "billing_reconciliation", true),
    alert("payg_mismatch", "billing_reconciliation", true),
    alert("reconciliation_failure", "billing_reconciliation", true),
    alert("unexpected_charge_growth", "billing_release_owner", true),
  ];
}

function fixtureFromEvidence(
  report: {
    reportId: string;
    idempotencyKey: string;
    organizationId: string;
    releaseId: string;
    catalog: { id: string; version: number };
    executedAt: string;
    validUntil: string;
  },
  evidence: Map<string, BillingReleaseDrillOperationEvidence>,
  signalsEvidence: BillingReleaseDrillOperationEvidence,
): BillingReleaseDrillQualificationInput {
  const signals = signalsEvidence.observedResult as unknown as (
    BillingReleaseDrillQualificationInput["signals"] & {
      thresholds: BillingReleaseDrillQualificationInput["thresholds"];
      creditEntries: BillingReleaseDrillQualificationInput["payg"]["creditEntries"];
    }
  );
  return {
    ...report,
    payg: {
      topUp: observed<BillingReleaseDrillQualificationInput["payg"]["topUp"]>(evidence, "top_up"),
      grant: observed<BillingReleaseDrillQualificationInput["payg"]["grant"]>(evidence, "paid_grant"),
      reservation: observed<BillingReleaseDrillQualificationInput["payg"]["reservation"]>(evidence, "reservation"),
      finalization: observed<BillingReleaseDrillQualificationInput["payg"]["finalization"]>(evidence, "debit_finalization"),
      refund: observed<BillingReleaseDrillQualificationInput["payg"]["refund"]>(evidence, "refund_reversal"),
      zeroBalance: observed<BillingReleaseDrillQualificationInput["payg"]["zeroBalance"]>(evidence, "zero_balance_stop"),
      creditEntries: signals.creditEntries,
    },
    operations: {
      duplicate: observed<BillingReleaseDrillQualificationInput["operations"]["duplicate"]>(evidence, "duplicate_event"),
      lateEvent: observed<BillingReleaseDrillQualificationInput["operations"]["lateEvent"]>(evidence, "late_event"),
      adjustment: observed<BillingReleaseDrillQualificationInput["operations"]["adjustment"]>(evidence, "adjustment"),
      invoiceDispute: observed<BillingReleaseDrillQualificationInput["operations"]["invoiceDispute"]>(evidence, "invoice_dispute"),
      rollback: observed<BillingReleaseDrillQualificationInput["operations"]["rollback"]>(evidence, "rollback"),
      chargeStop: observed<BillingReleaseDrillQualificationInput["operations"]["chargeStop"]>(evidence, "charge_stop"),
    },
    signals: {
      outboxPendingCount: signals.outboxPendingCount,
      oldestPendingAgeSeconds: signals.oldestPendingAgeSeconds,
      deadLetterCount: signals.deadLetterCount,
      webhookLagSeconds: signals.webhookLagSeconds,
      ledgerDifferenceMinor: signals.ledgerDifferenceMinor,
      paygPolarBalanceMinor: signals.paygPolarBalanceMinor,
      reconciliationFailureCount: signals.reconciliationFailureCount,
      chargedMinorThisWindow: signals.chargedMinorThisWindow,
      expectedMaxChargeMinorThisWindow: signals.expectedMaxChargeMinorThisWindow,
    },
    thresholds: signals.thresholds,
  };
}

function observed<T>(
  evidence: Map<string, BillingReleaseDrillOperationEvidence>,
  drillId: DrillId,
) {
  return evidence.get(drillId)!.observedResult as T;
}
