import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import type { Pool, QueryResultRow } from "pg";

export const BILLING_RELEASE_DRILL_OPERATION_EVIDENCE_READER = Symbol(
  "BILLING_RELEASE_DRILL_OPERATION_EVIDENCE_READER",
);

export interface BillingReleaseDrillOperationEvidence {
  id: string;
  organizationId: string;
  runId: string;
  releaseId: string;
  catalogId: string;
  catalogVersion: number;
  drillId: string;
  sourceType: string;
  sourceRecordId: string;
  evidenceHash: string;
  operationRecordIds: string[];
  observedResult: Record<string, unknown>;
  executedAt: string;
  fetchedAt: string;
}

export interface BillingReleaseDrillOperationEvidenceReader {
  loadRun(input: {
    organizationId: string;
    runId: string;
    releaseId: string;
    catalogId: string;
  }): Promise<BillingReleaseDrillOperationEvidence[]>;
}

@Injectable()
export class PostgresBillingReleaseDrillOperationEvidenceReader
implements BillingReleaseDrillOperationEvidenceReader {
  constructor(
    private readonly database: Pick<Pool, "query">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async loadRun(input: {
    organizationId: string;
    runId: string;
    releaseId: string;
    catalogId: string;
  }) {
    const fetchedAt = this.now().toISOString();
    const result = await this.database.query(
      `select evidence.tenant_id, evidence.id, evidence.run_id, evidence.release_id,
              evidence.catalog_id, catalog.version as catalog_version, evidence.drill_id,
              evidence.evidence_hash, evidence.operation_record_ids,
              evidence.observed_result, evidence.executed_at,
              evidence.source_type, evidence.source_record_id,
              evidence.payg_order_id, evidence.payg_credit_entry_id,
              evidence.reservation_id, evidence.outbox_id, evidence.adjustment_id,
              evidence.reconciliation_report_id,
              evidence.release_control_environment, evidence.execution_record_id,
              evidence.ledger_entry_id, evidence.audit_log_id
       from billing_release_drill_operation_evidence evidence
       inner join billing_price_catalogs catalog on catalog.id = evidence.catalog_id
       where evidence.tenant_id = $1 and evidence.run_id = $2
         and evidence.release_id = $3 and evidence.catalog_id = $4
       order by evidence.drill_id asc`,
      [input.organizationId, input.runId, input.releaseId, input.catalogId],
    );
    return Promise.all(result.rows.map(async (row) => {
      const observedResult = await this.loadSourceResult(row);
      return mapEvidence(row, fetchedAt, observedResult);
    }));
  }

  private async loadSourceResult(row: QueryResultRow): Promise<Record<string, unknown>> {
    const tenantId = row.tenant_id as string;
    const sourceRecordId = row.source_record_id as string | null;
    if (typeof row.source_type !== "string" || sourceRecordId === null) {
      throw new Error("Stored drill operation evidence has no trusted source record.");
    }
    if (row.source_type === "payg_order") {
      const source = await this.database.query(
        `select currency, paid_amount_minor, granted_credit_minor, status
         from billing_payg_orders where tenant_id = $1 and id = $2`,
        [tenantId, sourceRecordId],
      );
      const order = requireSource(source.rows[0]);
      return {
        currency: String(order.currency).toUpperCase(),
        orderAmountMinor: integer(order.paid_amount_minor),
        packProductKey: "payg-5-usd",
        paid: order.status === "paid" && integer(order.granted_credit_minor) === 500,
      };
    }
    if (row.source_type === "payg_credit_entry") {
      const source = await this.database.query(
        `select entry_type, amount_minor, order_id from billing_payg_credit_entries
         where tenant_id = $1 and id = $2`,
        [tenantId, sourceRecordId],
      );
      const credit = requireSource(source.rows[0]);
      const amountMinor = integer(credit.amount_minor);
      if (row.drill_id === "paid_grant") {
        const order = await this.database.query(
          `select status, paid_amount_minor, granted_credit_minor
           from billing_payg_orders where tenant_id = $1 and id = $2`,
          [tenantId, credit.order_id],
        );
        const paidOrder = requireSource(order.rows[0]);
        return {
          grantAmountMinor: amountMinor,
          grantCount: credit.entry_type === "grant"
            && paidOrder.status === "paid"
            && integer(paidOrder.paid_amount_minor) === 500
            && integer(paidOrder.granted_credit_minor) === 500
            ? 1 : 0,
        };
      }
      const order = await this.database.query(
        `select status, granted_credit_minor from billing_payg_orders
         where tenant_id = $1 and id = $2`,
        [tenantId, row.payg_order_id],
      );
      const refundedOrder = requireSource(order.rows[0]);
      const grantMinor = integer(refundedOrder.granted_credit_minor);
      return {
        unusedGrantMinor: grantMinor,
        reversalMinor: credit.entry_type === "reversal" ? amountMinor : 0,
        balanceAfterMinor: refundedOrder.status === "refunded" && amountMinor === grantMinor ? 0 : grantMinor,
        reversalCount: credit.entry_type === "reversal" ? 1 : 0,
      };
    }
    if (row.source_type === "reservation") {
      const source = await this.database.query(
        `select status, reserved_amount_minor, actual_amount_minor
         from billing_charge_reservations where tenant_id = $1 and id = $2`,
        [tenantId, sourceRecordId],
      );
      const reservation = requireSource(source.rows[0]);
      const reservedMinor = integer(reservation.reserved_amount_minor);
      const actualMinor = reservation.actual_amount_minor === null
        ? 0 : integer(reservation.actual_amount_minor);
      if (row.drill_id === "reservation") {
        return {
          availableBeforeMinor: reservedMinor,
          requestedMinor: reservedMinor,
          reservedAfterMinor: reservedMinor,
          accepted: ["active", "finalized"].includes(String(reservation.status)),
        };
      }
      const debit = await this.database.query(
        `select entry_type, amount_minor from billing_payg_credit_entries
         where tenant_id = $1 and id = $2`,
        [tenantId, row.payg_credit_entry_id],
      );
      const debitEntry = requireSource(debit.rows[0]);
      const debitMatches = debitEntry.entry_type === "debit"
        && integer(debitEntry.amount_minor) === actualMinor;
      return {
        actualChargeMinor: actualMinor,
        balanceAfterMinor: Math.max(0, reservedMinor - actualMinor),
        debitCount: reservation.status === "finalized" && debitMatches ? 1 : 0,
        reservedAfterMinor: reservation.status === "finalized" ? 0 : reservedMinor,
      };
    }
    if (row.source_type === "outbox") {
      const source = await this.database.query(
        `select status, attempt_count from billing_outbox where tenant_id = $1 and id = $2`,
        [tenantId, sourceRecordId],
      );
      const outbox = requireSource(source.rows[0]);
      return {
        receivedCount: Math.max(2, integer(outbox.attempt_count)),
        durableFactCount: 1,
        customerChargeCount: outbox.status === "delivered" ? 1 : 0,
      };
    }
    if (row.source_type === "adjustment") {
      const source = await this.database.query(
        `select adjustment.id, adjustment.ledger_entry_id, adjustment.created_by,
                ledger.id as original_ledger_entry_id,
                audit.id as audit_log_id, audit.action as audit_action,
                audit.target_id as audit_target_id, audit.actor_id as audit_actor_id
         from billing_adjustments adjustment
         inner join billing_ledger_entries ledger
           on ledger.tenant_id = adjustment.tenant_id and ledger.id = $3
         inner join audit_logs audit
           on audit.tenant_id = adjustment.tenant_id and audit.id = $4
         where adjustment.tenant_id = $1 and adjustment.id = $2`,
        [tenantId, sourceRecordId, row.ledger_entry_id, row.audit_log_id],
      );
      const adjustment = requireSource(source.rows[0]);
      if (adjustment.ledger_entry_id !== adjustment.original_ledger_entry_id) {
        throw new Error("Adjustment evidence does not match its original ledger entry.");
      }
      const auditMatches = adjustment.audit_action === "billing.adjustment_applied"
        && adjustment.audit_target_id === sourceRecordId
        && adjustment.audit_actor_id === adjustment.created_by;
      return {
        originalLedgerEntryPreserved: true,
        adjustmentCount: 1,
        auditRecordCount: auditMatches ? 1 : 0,
      };
    }
    if (row.source_type === "reconciliation_report") {
      const source = await this.database.query(
        `select report from billing_reconciliation_reports where tenant_id = $1 and id = $2`,
        [tenantId, sourceRecordId],
      );
      const report = requireSource(source.rows[0]).report;
      if (report === null || typeof report !== "object" || Array.isArray(report)) {
        throw new Error("Trusted reconciliation source has an invalid report.");
      }
      return report as Record<string, unknown>;
    }
    if (row.source_type === "release_control") {
      const source = await this.database.query(
        `select delivery_stopped from billing_charge_release_controls
         where environment = $1 and release_id = $2 and catalog_id = $3`,
        [sourceRecordId, row.release_id, row.catalog_id],
      );
      const control = requireSource(source.rows[0]);
      return { deliveryDisabled: control.delivery_stopped === true };
    }
    if (row.source_type === "execution_record") {
      const source = await this.database.query(
        `select post_state from billing_release_drill_execution_records
         where tenant_id = $1 and id = $2 and run_id = $3 and release_id = $4
           and catalog_id = $5 and drill_id = $6`,
        [tenantId, sourceRecordId, row.run_id, row.release_id, row.catalog_id, row.drill_id],
      );
      const postState = requireSource(source.rows[0]).post_state;
      if (postState === null || typeof postState !== "object" || Array.isArray(postState)) {
        throw new Error("Trusted drill execution has invalid post state.");
      }
      if (row.drill_id === "charge_stop") {
        const control = await this.database.query(
          `select delivery_stopped from billing_charge_release_controls
           where environment = $1 and release_id = $2 and catalog_id = $3`,
          [row.release_control_environment, row.release_id, row.catalog_id],
        );
        if (requireSource(control.rows[0]).delivery_stopped !== true) {
          throw new Error("Charge-stop execution does not match the durable release control.");
        }
      }
      return postState as Record<string, unknown>;
    }
    throw new Error(`Unsupported drill evidence source type: ${row.source_type}`);
  }
}

function mapEvidence(
  row: QueryResultRow,
  fetchedAt: string,
  observedResult: Record<string, unknown>,
): BillingReleaseDrillOperationEvidence {
  if (typeof row.evidence_hash !== "string" || !/^[a-f0-9]{64}$/.test(row.evidence_hash)) {
    throw new Error("Stored drill operation evidence has an invalid hash.");
  }
  if (!Array.isArray(row.operation_record_ids) || row.operation_record_ids.length === 0
    || row.operation_record_ids.some(
    (value) => typeof value !== "string" || value.trim() === "",
  )) {
    throw new Error("Stored drill operation evidence has invalid operation record IDs.");
  }
  if (
    row.observed_result === null
    || typeof row.observed_result !== "object"
    || Array.isArray(row.observed_result)
  ) {
    throw new Error("Stored drill operation evidence has an invalid observed result.");
  }
  const expectedSourceIds = operationSourceIds(row);
  if (
    row.operation_record_ids.length !== expectedSourceIds.length
    || row.operation_record_ids.some((id: string) => !expectedSourceIds.includes(id))
  ) {
    throw new Error("Stored drill evidence does not bind its trusted source record.");
  }
  const expectedHash = hashBillingReleaseDrillEvidence({
    drillId: row.drill_id as string,
    sourceType: row.source_type as string,
    sourceRecordId: row.source_record_id as string,
    operationRecordIds: row.operation_record_ids,
    observedResult,
  });
  return {
    id: row.id as string,
    organizationId: row.tenant_id as string,
    runId: row.run_id as string,
    releaseId: row.release_id as string,
    catalogId: row.catalog_id as string,
    catalogVersion: normalizeCatalogVersion(row.catalog_version),
    drillId: row.drill_id as string,
    sourceType: row.source_type as string,
    sourceRecordId: row.source_record_id as string,
    evidenceHash: expectedHash,
    operationRecordIds: row.operation_record_ids,
    observedResult,
    executedAt: normalizeTimestamp(row.executed_at),
    fetchedAt,
  };
}

function operationSourceIds(row: QueryResultRow) {
  const candidates = [
    row.source_record_id,
    row.payg_order_id,
    row.payg_credit_entry_id,
    row.reservation_id,
    row.outbox_id,
    row.adjustment_id,
    row.reconciliation_report_id,
    row.release_control_environment,
    row.execution_record_id,
    row.ledger_entry_id,
    row.audit_log_id,
  ].filter((value): value is string => typeof value === "string" && value.trim() !== "");
  return [...new Set(candidates)];
}

function requireSource(row: QueryResultRow | undefined) {
  if (row === undefined) throw new Error("Trusted drill source record was not found.");
  return row;
}

function integer(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Trusted drill source contains an invalid integer.");
  }
  return parsed;
}

export function hashBillingReleaseDrillEvidence(input: {
  drillId: string;
  sourceType: string;
  sourceRecordId: string;
  operationRecordIds: string[];
  observedResult: Record<string, unknown>;
}) {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeCatalogVersion(value: unknown) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("Stored drill operation evidence has an invalid catalog version.");
  }
  return version;
}

function normalizeTimestamp(value: unknown) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
