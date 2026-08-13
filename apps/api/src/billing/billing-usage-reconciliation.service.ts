import { Inject, Injectable, Optional } from "@nestjs/common";

import { BillingOutboxObservability } from "./billing-outbox-observability";

export interface ZaraUsageReconciliationEvent {
  externalEventId: string;
  meterKey: string;
  quantity: number;
  occurredAt: string;
}

export interface PolarUsageReconciliationEvent {
  externalEventId: string;
  quantity: number;
  receivedAt: string;
}

export const BILLING_RECONCILIATION_REPORT_REPOSITORY = Symbol(
  "BILLING_RECONCILIATION_REPORT_REPOSITORY",
);
export const BILLING_PROVIDER_USAGE_EVIDENCE_SOURCE = Symbol(
  "BILLING_PROVIDER_USAGE_EVIDENCE_SOURCE",
);
export const BILLING_POLAR_METER_EVIDENCE_SOURCE = Symbol(
  "BILLING_POLAR_METER_EVIDENCE_SOURCE",
);
export const BILLING_DRAFT_INVOICE_EVIDENCE_SOURCE = Symbol(
  "BILLING_DRAFT_INVOICE_EVIDENCE_SOURCE",
);

export type BillingReconciliationMeterKey =
  | "standard_runtime_seconds"
  | "premium_runtime_seconds"
  | "platform_telephony_charge_minor"
  | "payg_charge_minor";

export interface BillingCycleLocalEvidence {
  ledger: Array<{
    id: string;
    entryType: string;
    meterKey: string | null;
    adjustmentKind?: "credit" | "debit" | undefined;
    quantity: number;
    customerAmountMinor: number | null;
  }>;
  outbox: Array<{
    id: string;
    aggregateId: string;
    meterKey: string;
    quantity: number;
    deliveryMode: "shadow" | "charge";
    status: "pending" | "processing" | "delivered" | "dead_letter";
  }>;
  payg: {
    orders: Array<{
      id: string;
      status: string;
      paidAmountMinor: number;
      grantedCreditMinor: number;
    }>;
    creditEntries: Array<{
      orderId?: string | undefined;
      entryType: "grant" | "debit" | "reversal" | "adjustment";
      amountMinor: number;
    }>;
    reservations: Array<{
      status: "active" | "expired" | "finalized" | "released";
      reservedAmountMinor: number;
      actualAmountMinor?: number | undefined;
    }>;
    reservationSnapshotMinor: number;
  };
}

export type BillingReconciliationMismatchClass =
  | "incomplete_ledger_charge"
  | "outbox_ledger_mismatch"
  | "missing_provider_usage_evidence"
  | "provider_usage_quantity_mismatch"
  | "provider_native_evidence_mismatch"
  | "missing_polar_meter_evidence"
  | "polar_meter_quantity_mismatch"
  | "missing_draft_invoice_evidence"
  | "draft_invoice_total_mismatch"
  | "payg_order_grant_mismatch"
  | "payg_refund_reversal_mismatch"
  | "payg_reservation_balance_mismatch"
  | "payg_debit_meter_mismatch";

export interface BillingReconciliationMismatchDraft {
  mismatchClass: BillingReconciliationMismatchClass;
  owner: BillingReconciliationOwner;
  correctionRule: string;
  severity: "high" | "critical";
  details: Record<string, string | number | boolean>;
}

export interface BillingReconciliationReportRepository {
  loadLocalCycleEvidence(input: {
    organizationId: string;
    cycleStartsAt: string;
    cycleEndsAt: string;
  }): Promise<BillingCycleLocalEvidence>;
  appendMismatchEvidence(input: BillingReconciliationMismatchDraft & {
    organizationId: string;
    cycleStartsAt: string;
    cycleEndsAt: string;
  }): Promise<{ evidenceId: string }>;
  appendReport(input: {
    organizationId: string;
    releaseId: string;
    catalogId: string;
    runKey: string;
    cycleStartsAt: string;
    cycleEndsAt: string;
    validUntil: string;
    status: "matched" | "mismatch";
    mismatchCount: number;
    report: Record<string, unknown>;
  }): Promise<{ evidenceId: string }>;
  listTenantCycles(now: string): Promise<Array<{
    organizationId: string;
    catalogId: string;
    cycleStartsAt: string;
    cycleEndsAt: string;
  }>>;
}

type BillingReconciliationOwner =
  | "billing_operations"
  | "finance_operations"
  | "platform_engineering"
  | "provider_operations";

export interface ExternalMeterEvidence {
  evidenceId: string;
  sourceId: string;
  fetchedAt: string;
  organizationId: string;
  catalogId: string;
  cycleStartsAt: string;
  cycleEndsAt: string;
  quantities: Partial<Record<BillingReconciliationMeterKey, number>>;
  providerNative?: ProviderNativeReconciliation[] | undefined;
  requiredNativeProviders?: string[] | undefined;
  polarBalanceMinor?: number | undefined;
}

export interface ProviderNativeReconciliation {
  provider: string;
  sourceReportId: string;
  status: "matched" | "mismatch";
  factCount: number;
  scopeId: string;
  coverageStartsAt: string;
  coverageEndsAt: string;
  totals: Record<string, number>;
  issues: string[];
}

export interface BillingCycleEvidenceInput {
  organizationId: string;
  catalogId: string;
  cycleStartsAt: string;
  cycleEndsAt: string;
}

export interface BillingProviderUsageEvidenceSource {
  loadTenantCycleEvidence(input: BillingCycleEvidenceInput): Promise<ExternalMeterEvidence | null>;
}

export interface BillingPolarMeterEvidenceSource {
  loadTenantCycleEvidence(input: BillingCycleEvidenceInput): Promise<ExternalMeterEvidence | null>;
}

export interface BillingDraftInvoiceEvidence {
  evidenceId: string;
  sourceId: string;
  fetchedAt: string;
  organizationId: string;
  catalogId: string;
  cycleStartsAt: string;
  cycleEndsAt: string;
  amountMinor: number;
  currency: string;
}

export interface BillingDraftInvoiceEvidenceSource {
  loadTenantCycleEvidence(input: BillingCycleEvidenceInput): Promise<BillingDraftInvoiceEvidence | null>;
}

@Injectable()
export class BillingUsageReconciliationService {
  constructor(
    @Optional()
    @Inject(BillingOutboxObservability)
    private readonly observability?: Pick<
      BillingOutboxObservability,
      "recordReconciliation"
    >,
    @Optional()
    @Inject(BILLING_RECONCILIATION_REPORT_REPOSITORY)
    private readonly reportRepository?: BillingReconciliationReportRepository,
    @Optional()
    @Inject(BILLING_PROVIDER_USAGE_EVIDENCE_SOURCE)
    private readonly providerUsageSource?: BillingProviderUsageEvidenceSource,
    @Optional()
    @Inject(BILLING_POLAR_METER_EVIDENCE_SOURCE)
    private readonly polarMeterSource?: BillingPolarMeterEvidenceSource,
    @Optional()
    @Inject(BILLING_DRAFT_INVOICE_EVIDENCE_SOURCE)
    private readonly draftInvoiceSource?: BillingDraftInvoiceEvidenceSource,
  ) {}

  async reconcileTenantCycle(input: {
    organizationId: string;
    cycleStartsAt: string;
    cycleEndsAt: string;
    runKey: string;
    releaseId: string;
    catalogId: string;
    validUntil: string;
    providerCollectionFailed?: boolean;
  }) {
    if (
      this.reportRepository === undefined
      || this.providerUsageSource === undefined
      || this.polarMeterSource === undefined
      || this.draftInvoiceSource === undefined
    ) {
      throw new Error("Billing reconciliation dependencies are unavailable.");
    }
    const evidenceInput = {
      organizationId: input.organizationId,
      catalogId: input.catalogId,
      cycleStartsAt: input.cycleStartsAt,
      cycleEndsAt: input.cycleEndsAt,
    };
    const [local, providerEvidenceCandidate, polarEvidenceCandidate, invoiceEvidenceCandidate] =
      await Promise.all([
        this.reportRepository.loadLocalCycleEvidence(evidenceInput),
        this.providerUsageSource.loadTenantCycleEvidence(evidenceInput),
        this.polarMeterSource.loadTenantCycleEvidence(evidenceInput),
        this.draftInvoiceSource.loadTenantCycleEvidence(evidenceInput),
      ]);
    const providerUsageEvidence = !input.providerCollectionFailed && validScopedEvidence(
      providerEvidenceCandidate,
      evidenceInput,
      input.validUntil,
    ) ? providerEvidenceCandidate : null;
    const polarMeterEvidence = validScopedEvidence(
      polarEvidenceCandidate,
      evidenceInput,
      input.validUntil,
    ) ? polarEvidenceCandidate : null;
    const draftInvoiceEvidence = validScopedEvidence(
      invoiceEvidenceCandidate,
      evidenceInput,
      input.validUntil,
    ) ? invoiceEvidenceCandidate : null;
    const meteredLedger = local.ledger.filter(isMeteredLedgerEntry);
    const ledgerQuantities = sumMeterQuantities(meteredLedger);
    const ledgerCustomerAmountMinor = local.ledger.reduce(
      (total, entry) => total + signedCustomerAmount(entry),
      0,
    );
    const payg = summarizePayg(local);
    const outboxDeliveryModes = new Set(local.outbox.map((entry) => entry.deliveryMode));
    const drafts: BillingReconciliationMismatchDraft[] = [];

    const incompleteLedgerIds = meteredLedger
      .filter((entry) => entry.customerAmountMinor === null)
      .map((entry) => entry.id);
    if (incompleteLedgerIds.length > 0) {
      drafts.push(mismatch("incomplete_ledger_charge", {
        count: incompleteLedgerIds.length,
        ledgerEntryIds: incompleteLedgerIds.join(","),
      }));
    }

    const usageOutbox = local.outbox.filter((entry) => entry.meterKey !== "payg_charge_minor");
    const outboxMatchesLedger = meteredLedger.every((ledger) => usageOutbox.some((outbox) => (
      outbox.aggregateId === ledger.id
      && outbox.meterKey === ledger.meterKey
      && outbox.quantity === ledger.quantity
    ))) && usageOutbox.length === meteredLedger.length;
    if (!outboxMatchesLedger) {
      drafts.push(mismatch("outbox_ledger_mismatch", {
        ledgerEntryCount: meteredLedger.length,
        usageOutboxCount: usageOutbox.length,
      }));
    }

    drafts.push(...this.reconcileProviderUsageEvidence({
      evidence: providerUsageEvidence,
      expected: ledgerQuantities,
    }));
    compareExternalMeters(
      drafts,
      polarMeterEvidence,
      { ...ledgerQuantities, payg_charge_minor: payg.debitedMinor },
      "missing_polar_meter_evidence",
      "polar_meter_quantity_mismatch",
    );

    if (draftInvoiceEvidence === null) {
      drafts.push(mismatch("missing_draft_invoice_evidence", {}));
    } else if (
      draftInvoiceEvidence.currency !== "usd"
      || draftInvoiceEvidence.amountMinor !== ledgerCustomerAmountMinor
    ) {
      drafts.push(mismatch("draft_invoice_total_mismatch", {
        zaraCustomerAmountMinor: ledgerCustomerAmountMinor,
        draftInvoiceAmountMinor: draftInvoiceEvidence.amountMinor,
        currency: draftInvoiceEvidence.currency,
      }));
    }

    if (
      local.payg.orders.some((order) => (
        (order.status === "paid" || order.status === "refunded")
        && (order.paidAmountMinor !== 500 || order.grantedCreditMinor !== 500)
      ))
      || payg.orderGrantedMinor !== payg.grantedMinor
    ) {
      drafts.push(mismatch("payg_order_grant_mismatch", {
        orderGrantedMinor: payg.orderGrantedMinor,
        creditGrantedMinor: payg.grantedMinor,
      }));
    }
    if (payg.refundedMinor !== payg.refundedOrderReversalMinor) {
      drafts.push(mismatch("payg_refund_reversal_mismatch", {
        refundedMinor: payg.refundedMinor,
        reversedMinor: payg.refundedOrderReversalMinor,
      }));
    }
    if (payg.reservedMinor !== local.payg.reservationSnapshotMinor) {
      drafts.push(mismatch("payg_reservation_balance_mismatch", {
        activeReservationMinor: payg.reservedMinor,
        reservationSnapshotMinor: local.payg.reservationSnapshotMinor,
      }));
    }
    const paygOutboxMinor = sumMeterQuantities(
      local.outbox.filter((entry) => entry.meterKey === "payg_charge_minor"),
    ).payg_charge_minor ?? 0;
    if (paygOutboxMinor !== payg.debitedMinor) {
      drafts.push(mismatch("payg_debit_meter_mismatch", {
        debitedMinor: payg.debitedMinor,
        outboxQuantityMinor: paygOutboxMinor,
      }));
    }

    const mismatches = [];
    for (const draft of drafts) {
      const evidence = await this.reportRepository.appendMismatchEvidence({
        ...draft,
        organizationId: input.organizationId,
        cycleStartsAt: input.cycleStartsAt,
        cycleEndsAt: input.cycleEndsAt,
      });
      mismatches.push({ ...draft, evidenceId: evidence.evidenceId });
    }
    this.observability?.recordReconciliation({
      lateCount: 0,
      mismatchCount: mismatches.length,
    });

    const report = {
      organizationId: input.organizationId,
      cycleStartsAt: input.cycleStartsAt,
      cycleEndsAt: input.cycleEndsAt,
      status: mismatches.length === 0 ? "matched" as const : "mismatch" as const,
      ...(polarMeterEvidence?.polarBalanceMinor === undefined
        ? {}
        : { polarBalanceMinor: polarMeterEvidence.polarBalanceMinor }),
      sources: {
        zaraLedger: {
          status: "present" as const,
          entryCount: local.ledger.length,
          meteredEntryCount: meteredLedger.length,
          customerAmountMinor: ledgerCustomerAmountMinor,
          quantities: ledgerQuantities,
        },
        outbox: {
          status: "present" as const,
          entryCount: local.outbox.length,
          deliveryMode: outboxDeliveryModes.size === 1
            ? [...outboxDeliveryModes][0]
            : "mixed" as const,
          quantityMinor: paygOutboxMinor,
          statuses: {
            pending: local.outbox.filter((entry) => entry.status === "pending").length,
            processing: local.outbox.filter((entry) => entry.status === "processing").length,
            delivered: local.outbox.filter((entry) => entry.status === "delivered").length,
            deadLetter: local.outbox.filter((entry) => entry.status === "dead_letter").length,
          },
        },
        providerUsage: providerUsageEvidence === null
          ? { status: "missing" as const }
          : { status: "present" as const, ...providerUsageEvidence },
        polarMeters: polarMeterEvidence === null
          ? { status: "missing" as const }
          : { status: "present" as const, ...polarMeterEvidence },
        draftInvoice: draftInvoiceEvidence === null
          ? { status: "missing" as const }
          : { status: "present" as const, ...draftInvoiceEvidence },
        payg: {
          paidOrderMinor: payg.paidOrderMinor,
          grantedMinor: payg.grantedMinor,
          reservedMinor: payg.reservedMinor,
          debitedMinor: payg.debitedMinor,
          refundedMinor: payg.refundedMinor,
          reversedMinor: payg.refundedOrderReversalMinor,
        },
      },
      mismatches,
    };
    const persisted = await this.reportRepository.appendReport({
      organizationId: input.organizationId,
      releaseId: input.releaseId,
      catalogId: input.catalogId,
      runKey: input.runKey,
      cycleStartsAt: input.cycleStartsAt,
      cycleEndsAt: input.cycleEndsAt,
      validUntil: input.validUntil,
      status: report.status,
      mismatchCount: mismatches.length,
      report,
    });
    return { ...report, evidenceId: persisted.evidenceId };
  }

  reconcilePaygBalance(input: {
    organizationId: string;
    creditEntries: Array<{
      id: string;
      entryType: "grant" | "debit" | "reversal";
      amountMinor: number;
    }>;
    polarBalanceMinor: number;
  }) {
    const grantedMinor = input.creditEntries
      .filter((entry) => entry.entryType === "grant")
      .reduce((total, entry) => total + entry.amountMinor, 0);
    const debitedMinor = input.creditEntries
      .filter((entry) => entry.entryType === "debit")
      .reduce((total, entry) => total + entry.amountMinor, 0);
    const reversedMinor = input.creditEntries
      .filter((entry) => entry.entryType === "reversal")
      .reduce((total, entry) => total + entry.amountMinor, 0);
    const localBalanceMinor = grantedMinor - debitedMinor - reversedMinor;
    const differenceMinor = localBalanceMinor - input.polarBalanceMinor;
    return {
      organizationId: input.organizationId,
      grantedMinor,
      debitedMinor,
      ...(reversedMinor === 0 ? {} : { reversedMinor }),
      localBalanceMinor,
      polarBalanceMinor: input.polarBalanceMinor,
      differenceMinor,
      status: differenceMinor === 0 ? "matched" as const : "mismatch" as const,
    };
  }

  reconcileProviderUsageEvidence(input: {
    evidence: ExternalMeterEvidence | null;
    expected: Partial<Record<BillingReconciliationMeterKey, number>>;
  }): BillingReconciliationMismatchDraft[] {
    if (input.evidence === null) {
      return [mismatch("missing_provider_usage_evidence", {})];
    }
    const evidence = input.evidence;
    const native = evidence.providerNative ?? [];
    const invalidNative = native.filter((report) => (
      report.status !== "matched" || report.factCount < 1 || report.issues.length > 0
    ));
    if (invalidNative.length > 0) {
      return [mismatch("provider_native_evidence_mismatch", {
        evidenceId: evidence.evidenceId,
        providers: invalidNative.map((report) => report.provider).join(","),
        issues: invalidNative.flatMap((report) => report.issues).join(","),
      })];
    }
    const requiredProviders = (evidence.requiredNativeProviders ?? []).filter((provider) => (
      ((input.expected.standard_runtime_seconds ?? 0) > 0 && provider === "cartesia")
      || ((input.expected.premium_runtime_seconds ?? 0) > 0
        && (provider === "openai" || provider === "gemini"))
    ));
    const missingRequiredProviders = requiredProviders.filter((provider) => (
      !native.some((report) => report.provider === provider && report.status === "matched")
    ));
    if (missingRequiredProviders.length > 0) {
      return [mismatch("provider_native_evidence_mismatch", {
        evidenceId: evidence.evidenceId,
        providers: missingRequiredProviders.join(","),
        issues: "required_provider_report_missing",
      })];
    }
    const missingNativeMeters = (["standard_runtime_seconds", "premium_runtime_seconds"] as const)
      .filter((meterKey) => (
        (input.expected[meterKey] ?? 0) > 0
        && evidence.quantities[meterKey] === undefined
        && !native.some((report) => (
          report.status === "matched" && providerProvesMeter(report.provider, meterKey)
        ))
      ));
    const drafts: BillingReconciliationMismatchDraft[] = [];
    if (missingNativeMeters.length > 0) {
      drafts.push(mismatch("provider_native_evidence_mismatch", {
        evidenceId: evidence.evidenceId,
        meterKeys: missingNativeMeters.join(","),
        issues: "provider_native_meter_evidence_missing",
      }));
    }
    const keys = new Set([
      ...Object.keys(input.expected),
      ...Object.keys(evidence.quantities),
    ] as BillingReconciliationMeterKey[]);
    const differences = [...keys].filter((key) => {
      if (missingNativeMeters.includes(key as "standard_runtime_seconds" | "premium_runtime_seconds")) {
        return false;
      }
      if (
        native.some((report) => providerProvesMeter(report.provider, key))
        && (key === "standard_runtime_seconds" || key === "premium_runtime_seconds")
        && evidence.quantities[key] === undefined
      ) return false;
      return (input.expected[key] ?? 0) !== (evidence.quantities[key] ?? 0);
    });
    if (differences.length > 0) {
      drafts.push(mismatch("provider_usage_quantity_mismatch", {
        evidenceId: evidence.evidenceId,
        meterKeys: differences.join(","),
      }));
    }
    return drafts;
  }

  reconcileCycle(input: {
    organizationId: string;
    cycleStartsAt: string;
    cycleEndsAt: string;
    zaraEvents: ZaraUsageReconciliationEvent[];
    polarEvents: PolarUsageReconciliationEvent[];
  }) {
    const cycleStart = Date.parse(input.cycleStartsAt);
    const cycleEnd = Date.parse(input.cycleEndsAt);
    const polarByExternalId = new Map<string, PolarUsageReconciliationEvent[]>();
    for (const event of input.polarEvents) {
      const events = polarByExternalId.get(event.externalEventId) ?? [];
      events.push(event);
      polarByExternalId.set(event.externalEventId, events);
    }
    const missingExternalEventIds: string[] = [];
    const duplicateExternalEventIds: string[] = [];
    const lateExternalEventIds: string[] = [];
    const mismatches: Array<{
      externalEventId: string;
      zaraQuantity: number;
      polarQuantity: number;
    }> = [];
    for (const event of input.zaraEvents) {
      const matches = polarByExternalId.get(event.externalEventId) ?? [];
      if (matches.length === 0) {
        missingExternalEventIds.push(event.externalEventId);
        continue;
      }
      if (matches.length > 1) duplicateExternalEventIds.push(event.externalEventId);
      if (matches.every((match) => {
        const receivedAt = Date.parse(match.receivedAt);
        return receivedAt < cycleStart || receivedAt >= cycleEnd;
      })) {
        lateExternalEventIds.push(event.externalEventId);
      }
      const polarQuantity = matches[0]?.quantity;
      if (polarQuantity !== undefined && polarQuantity !== event.quantity) {
        mismatches.push({
          externalEventId: event.externalEventId,
          zaraQuantity: event.quantity,
          polarQuantity,
        });
      }
    }
    const hasMismatch =
      missingExternalEventIds.length > 0
      || duplicateExternalEventIds.length > 0
      || lateExternalEventIds.length > 0
      || mismatches.length > 0;
    this.observability?.recordReconciliation({
      lateCount: lateExternalEventIds.length,
      mismatchCount:
        missingExternalEventIds.length
        + duplicateExternalEventIds.length
        + lateExternalEventIds.length
        + mismatches.length,
    });
    return {
      organizationId: input.organizationId,
      cycleStartsAt: input.cycleStartsAt,
      cycleEndsAt: input.cycleEndsAt,
      zaraQuantity: sumQuantities(input.zaraEvents),
      polarQuantity: sumQuantities(input.polarEvents),
      missingExternalEventIds,
      duplicateExternalEventIds,
      lateExternalEventIds,
      mismatches,
      status: hasMismatch ? "mismatch" as const : "matched" as const,
    };
  }
}

function providerProvesMeter(provider: string, meterKey: BillingReconciliationMeterKey) {
  if (meterKey === "standard_runtime_seconds") return provider === "cartesia";
  if (meterKey === "premium_runtime_seconds") return provider === "openai" || provider === "gemini";
  return false;
}

function sumQuantities(events: Array<{ quantity: number }>) {
  return events.reduce((total, event) => total + event.quantity, 0);
}

function sumMeterQuantities(
  entries: Array<{ meterKey: string; quantity: number }>,
): Partial<Record<BillingReconciliationMeterKey, number>> {
  const totals: Partial<Record<BillingReconciliationMeterKey, number>> = {};
  for (const entry of entries) {
    if (!isMeterKey(entry.meterKey)) continue;
    totals[entry.meterKey] = (totals[entry.meterKey] ?? 0) + entry.quantity;
  }
  return totals;
}

function isMeteredLedgerEntry(
  entry: BillingCycleLocalEvidence["ledger"][number],
): entry is BillingCycleLocalEvidence["ledger"][number] & { meterKey: BillingReconciliationMeterKey } {
  return entry.entryType === "runtime_charge" || entry.entryType === "telephony_charge"
    ? entry.meterKey !== null && isMeterKey(entry.meterKey)
    : false;
}

function signedCustomerAmount(entry: BillingCycleLocalEvidence["ledger"][number]) {
  if (entry.customerAmountMinor === null) return 0;
  if (entry.entryType !== "adjustment") return isMeteredLedgerEntry(entry)
    ? entry.customerAmountMinor
    : 0;
  if (entry.adjustmentKind === "credit") return -entry.customerAmountMinor;
  if (entry.adjustmentKind === "debit") return entry.customerAmountMinor;
  return 0;
}

function isMeterKey(value: string): value is BillingReconciliationMeterKey {
  return value === "standard_runtime_seconds"
    || value === "premium_runtime_seconds"
    || value === "platform_telephony_charge_minor"
    || value === "payg_charge_minor";
}

function summarizePayg(local: BillingCycleLocalEvidence) {
  const sumCreditType = (entryType: BillingCycleLocalEvidence["payg"]["creditEntries"][number]["entryType"]) => (
    local.payg.creditEntries
      .filter((entry) => entry.entryType === entryType)
      .reduce((total, entry) => total + entry.amountMinor, 0)
  );
  return {
    paidOrderMinor: local.payg.orders
      .filter((order) => order.status === "paid")
      .reduce((total, order) => total + order.paidAmountMinor, 0),
    orderGrantedMinor: local.payg.orders
      .filter((order) => order.status === "paid" || order.status === "refunded")
      .reduce((total, order) => total + order.grantedCreditMinor, 0),
    grantedMinor: sumCreditType("grant"),
    debitedMinor: sumCreditType("debit"),
    refundedMinor: local.payg.orders
      .filter((order) => order.status === "refunded")
      .reduce((total, order) => total + order.grantedCreditMinor, 0),
    refundedOrderReversalMinor: local.payg.creditEntries
      .filter((entry) => entry.entryType === "reversal")
      .filter((entry) => local.payg.orders.some((order) => (
        order.id === entry.orderId && order.status === "refunded"
      )))
      .reduce((total, entry) => total + entry.amountMinor, 0),
    reservedMinor: local.payg.reservations
      .filter((reservation) => reservation.status === "active")
      .reduce((total, reservation) => total + reservation.reservedAmountMinor, 0),
  };
}

function compareExternalMeters(
  drafts: BillingReconciliationMismatchDraft[],
  evidence: ExternalMeterEvidence | null,
  expected: Partial<Record<BillingReconciliationMeterKey, number>>,
  missingClass: "missing_provider_usage_evidence" | "missing_polar_meter_evidence",
  mismatchClass: "provider_usage_quantity_mismatch" | "polar_meter_quantity_mismatch",
) {
  if (evidence === null) {
    drafts.push(mismatch(missingClass, {}));
    return;
  }
  const keys = new Set([
    ...Object.keys(expected),
    ...Object.keys(evidence.quantities),
  ] as BillingReconciliationMeterKey[]);
  const differences = [...keys].filter((key) => (
    (expected[key] ?? 0) !== (evidence.quantities[key] ?? 0)
  ));
  if (differences.length > 0) {
    drafts.push(mismatch(mismatchClass, {
      evidenceId: evidence.evidenceId,
      meterKeys: differences.join(","),
    }));
  }
}

const mismatchPolicies: Record<BillingReconciliationMismatchClass, {
  owner: BillingReconciliationOwner;
  correctionRule: string;
  severity: "high" | "critical";
}> = {
  incomplete_ledger_charge: {
    owner: "billing_operations",
    correctionRule: "resolve_missing_charge_evidence_then_append_correction",
    severity: "critical",
  },
  outbox_ledger_mismatch: {
    owner: "platform_engineering",
    correctionRule: "repair_or_replay_outbox_from_immutable_ledger",
    severity: "critical",
  },
  missing_provider_usage_evidence: {
    owner: "provider_operations",
    correctionRule: "import_provider_cycle_usage_evidence",
    severity: "critical",
  },
  provider_usage_quantity_mismatch: {
    owner: "provider_operations",
    correctionRule: "verify_provider_sessions_then_append_billing_correction",
    severity: "high",
  },
  provider_native_evidence_mismatch: {
    owner: "provider_operations",
    correctionRule: "verify_provider_native_scope_coverage_and_facts",
    severity: "critical",
  },
  missing_polar_meter_evidence: {
    owner: "billing_operations",
    correctionRule: "fetch_polar_cycle_meter_evidence",
    severity: "critical",
  },
  polar_meter_quantity_mismatch: {
    owner: "billing_operations",
    correctionRule: "replay_missing_usage_or_append_meter_correction",
    severity: "critical",
  },
  missing_draft_invoice_evidence: {
    owner: "finance_operations",
    correctionRule: "fetch_polar_draft_invoice_evidence",
    severity: "high",
  },
  draft_invoice_total_mismatch: {
    owner: "finance_operations",
    correctionRule: "hold_invoice_and_append_approved_adjustment",
    severity: "critical",
  },
  payg_order_grant_mismatch: {
    owner: "billing_operations",
    correctionRule: "verify_paid_five_dollar_order_then_append_credit_correction",
    severity: "critical",
  },
  payg_refund_reversal_mismatch: {
    owner: "finance_operations",
    correctionRule: "verify_refund_then_append_credit_reversal",
    severity: "critical",
  },
  payg_reservation_balance_mismatch: {
    owner: "platform_engineering",
    correctionRule: "rebuild_reservation_account_from_active_reservations",
    severity: "critical",
  },
  payg_debit_meter_mismatch: {
    owner: "billing_operations",
    correctionRule: "replay_missing_payg_debit_or_append_credit_correction",
    severity: "critical",
  },
};

function mismatch(
  mismatchClass: BillingReconciliationMismatchClass,
  details: Record<string, string | number | boolean>,
): BillingReconciliationMismatchDraft {
  return { mismatchClass, ...mismatchPolicies[mismatchClass], details };
}

function validScopedEvidence(
  evidence: {
    evidenceId: string;
    sourceId: string;
    fetchedAt: string;
    organizationId: string;
    catalogId: string;
    cycleStartsAt: string;
    cycleEndsAt: string;
  } | null,
  input: BillingCycleEvidenceInput,
  validUntil: string,
) {
  if (evidence === null) return false;
  const fetchedAt = Date.parse(evidence.fetchedAt);
  return evidence.evidenceId.trim() !== ""
    && evidence.sourceId.trim() !== ""
    && evidence.organizationId === input.organizationId
    && evidence.catalogId === input.catalogId
    && evidence.cycleStartsAt === input.cycleStartsAt
    && evidence.cycleEndsAt === input.cycleEndsAt
    && Number.isFinite(fetchedAt)
    && fetchedAt >= Date.parse(input.cycleEndsAt)
    && fetchedAt <= Date.parse(validUntil);
}
