import { Injectable } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import type { Pool } from "pg";

import { hashBillingReleaseDrillEvidence } from "./billing-release-drill-operation-evidence.repository";

type TypedExecutionDrill =
  | "zero_balance_stop"
  | "invoice_dispute"
  | "rollback"
  | "charge_stop"
  | "release_signals";

export interface TrustedBillingReleaseDrillExecutionInput {
  organizationId: string;
  runId: string;
  releaseId: string;
  catalogId: string;
  drillId: TypedExecutionDrill;
  actorId: string;
  executedAt: string;
  releaseControlEnvironment?: string | undefined;
  reservationId?: string | undefined;
  sessionId?: string | undefined;
  invoiceId?: string | undefined;
  adjustmentId?: string | undefined;
}

export interface TrustedBillingReleaseDrillOperations {
  readState(input: TrustedBillingReleaseDrillExecutionInput): Promise<Record<string, unknown>>;
  perform(input: TrustedBillingReleaseDrillExecutionInput): Promise<void>;
}

@Injectable()
export class TrustedBillingReleaseDrillExecutor {
  private readonly operations: TrustedBillingReleaseDrillOperations;

  constructor(
    private readonly database: Pick<Pool, "connect" | "query">,
    operations?: TrustedBillingReleaseDrillOperations,
  ) {
    this.operations = operations ?? new PostgresTrustedBillingReleaseDrillOperations(database);
  }

  async execute(input: TrustedBillingReleaseDrillExecutionInput) {
    if (input.actorId.trim() === "") {
      throw new Error("A trusted drill execution actor is required.");
    }
    if (
      (input.drillId === "charge_stop" || input.drillId === "rollback")
      && (input.releaseControlEnvironment?.trim() ?? "") === ""
    ) {
      throw new Error("The release-control drill requires a release control environment.");
    }
    if (input.drillId === "zero_balance_stop"
      && ((input.reservationId?.trim() ?? "") === "" || (input.sessionId?.trim() ?? "") === "")) {
      throw new Error("The zero-balance drill requires a reservation and session.");
    }
    if (input.drillId === "invoice_dispute"
      && ((input.invoiceId?.trim() ?? "") === "" || (input.adjustmentId?.trim() ?? "") === "")) {
      throw new Error("The invoice-dispute drill requires an invoice and adjustment.");
    }
    const preState = await this.operations.readState(input);
    assertState(preState);
    await this.operations.perform(input);
    const postState = await this.operations.readState(input);
    assertState(postState);
    const confirmedPostState = await this.operations.readState(input);
    if (!isDeepStrictEqual(postState, confirmedPostState)) {
      throw new Error("Trusted drill post-operation readback changed before evidence commit.");
    }
    const executionId = `drill-execution:${input.runId}:${input.drillId}`;
    const evidenceId = `drill-evidence:${input.runId}:${input.drillId}`;
    const operationRecordIds = operationIds(input, executionId);
    const evidenceHash = hashBillingReleaseDrillEvidence({
      drillId: input.drillId,
      sourceType: "execution_record",
      sourceRecordId: executionId,
      operationRecordIds,
      observedResult: postState,
    });
    const client = await this.database.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into billing_release_drill_execution_records (
           tenant_id, id, run_id, release_id, catalog_id, drill_id,
           actor_id, pre_state, post_state, executed_at, created_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$10)`,
        [
          input.organizationId,
          executionId,
          input.runId,
          input.releaseId,
          input.catalogId,
          input.drillId,
          input.actorId,
          JSON.stringify(preState),
          JSON.stringify(postState),
          input.executedAt,
        ],
      );
      await client.query(
        `insert into billing_release_drill_operation_evidence (
           tenant_id, id, run_id, release_id, catalog_id, drill_id,
           evidence_hash, operation_record_ids, observed_result, executed_at,
           source_type, source_record_id, execution_record_id,
           release_control_environment, created_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,
                   'execution_record',$11,$11,$12,$10)`,
        [
          input.organizationId,
          evidenceId,
          input.runId,
          input.releaseId,
          input.catalogId,
          input.drillId,
          evidenceHash,
          JSON.stringify(operationRecordIds),
          JSON.stringify(postState),
          input.executedAt,
          executionId,
          input.releaseControlEnvironment ?? null,
        ],
      );
      await client.query("commit");
      return { executionId, evidenceId };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PostgresTrustedBillingReleaseDrillOperations
implements TrustedBillingReleaseDrillOperations {
  constructor(private readonly database: Pick<Pool, "query">) {}

  async perform(input: TrustedBillingReleaseDrillExecutionInput) {
    if (input.drillId === "charge_stop" || input.drillId === "rollback") {
      const result = await this.database.query(
        `update billing_charge_release_controls
         set delivery_stopped = true, stop_reason = $4, stopped_at = $5, updated_at = $5
         where environment = $1 and release_id = $2 and catalog_id = $3
           and delivery_stopped = false`,
        [input.releaseControlEnvironment, input.releaseId, input.catalogId,
          `Trusted ${input.drillId} drill ${input.runId}`, input.executedAt],
      );
      assertOneMutation(result.rowCount, input.drillId);
      return;
    }
    if (input.drillId === "zero_balance_stop") {
      const result = await this.database.query(
        `update billing_charge_reservations
         set status = 'finalized', actual_amount_minor = reserved_amount_minor,
             session_id = $3, terminal_outcome = 'completed', finalized_at = $4, updated_at = $4
         where tenant_id = $1 and id = $2 and status = 'active'`,
        [input.organizationId, input.reservationId, input.sessionId, input.executedAt],
      );
      assertOneMutation(result.rowCount, input.drillId);
      return;
    }
    if (input.drillId === "invoice_dispute") {
      const result = await this.database.query(
        `update billing_invoices invoice set status = 'disputed'
         where invoice.tenant_id = $1 and invoice.id = $2 and invoice.status <> 'disputed'
           and exists (select 1 from billing_adjustments adjustment
             where adjustment.tenant_id = invoice.tenant_id and adjustment.id = $3
               and adjustment.ledger_entry_id = invoice.metadata ->> 'ledgerEntryId')`,
        [input.organizationId, input.invoiceId, input.adjustmentId],
      );
      assertOneMutation(result.rowCount, input.drillId);
      return;
    }
    if (input.drillId === "release_signals") {
      await this.readState(input);
      return;
    }
    throw new Error(`Trusted drill operation ${input.drillId} is not supported.`);
  }

  async readState(input: TrustedBillingReleaseDrillExecutionInput) {
    if (input.drillId === "charge_stop" || input.drillId === "rollback") {
      const result = await this.database.query(
        `select control.delivery_stopped,
                (select count(*)::int from billing_ledger_entries ledger
                 where ledger.tenant_id = $4) as usage_fact_count,
                (select count(*)::int - count(distinct ledger.idempotency_key)::int
                 from billing_ledger_entries ledger where ledger.tenant_id = $4) as duplicate_charge_count,
                (select count(*)::int from billing_outbox outbox
                 where outbox.tenant_id = $4 and outbox.status = 'delivered'
                   and outbox.charge_promoted_at is not null) as delivered_charge_count
         from billing_charge_release_controls control
         where control.environment = $1 and control.release_id = $2 and control.catalog_id = $3`,
        [input.releaseControlEnvironment, input.releaseId, input.catalogId, input.organizationId],
      );
      const row = requireRow(result.rows[0]);
      const common = {
        deliveryDisabled: row.delivery_stopped === true,
        usageFactsBefore: integer(row.usage_fact_count),
        usageFactsAfter: integer(row.usage_fact_count),
      };
      return input.drillId === "rollback"
        ? { ...common, duplicateChargeCount: integer(row.duplicate_charge_count) }
        : { ...common, deliveredChargeCountAfter: integer(row.delivered_charge_count) };
    }
    if (input.drillId === "zero_balance_stop") {
      const result = await this.database.query(
        `select status, reserved_amount_minor, actual_amount_minor
         from billing_charge_reservations where tenant_id = $1 and id = $2`,
        [input.organizationId, input.reservationId],
      );
      const row = requireRow(result.rows[0]);
      return {
        remainingMinor: Math.max(0, integer(row.reserved_amount_minor) - integer(row.actual_amount_minor ?? 0)),
        nextSegmentMinor: 1,
        stoppedAfterCurrentTurn: ["finalized", "released", "expired"].includes(String(row.status)),
      };
    }
    if (input.drillId === "invoice_dispute") {
      const result = await this.database.query(
        `select invoice.status as invoice_status,
                invoice.metadata ->> 'ledgerEntryId' as invoice_ledger_entry_id,
                adjustment.ledger_entry_id as adjustment_ledger_entry_id
         from billing_invoices invoice
         inner join billing_adjustments adjustment
           on adjustment.tenant_id = invoice.tenant_id and adjustment.id = $3
         where invoice.tenant_id = $1 and invoice.id = $2`,
        [input.organizationId, input.invoiceId, input.adjustmentId],
      );
      const row = requireRow(result.rows[0]);
      const linked = typeof row.invoice_ledger_entry_id === "string"
        && row.invoice_ledger_entry_id === row.adjustment_ledger_entry_id;
      return {
        invoiceFrozen: row.invoice_status === "disputed",
        evidenceLinked: linked,
        correctionUsesAdjustment: linked,
      };
    }
    const result = await this.database.query(
      `select
         (select count(*)::int from billing_outbox where tenant_id = $1 and status = 'pending') as outbox_pending_count,
         coalesce((select max(extract(epoch from ($2::timestamptz - created_at)))::int
                   from billing_outbox where tenant_id = $1 and status = 'pending'), 0) as oldest_pending_age_seconds,
         (select count(*)::int from billing_outbox where tenant_id = $1 and status = 'dead_letter') as dead_letter_count,
         coalesce((select max(extract(epoch from ($2::timestamptz - received_at)))::int
                   from billing_webhook_receipts where tenant_id = $1 and processed_at is null), 0) as webhook_lag_seconds,
         (select (report ->> 'ledgerDifferenceMinor')::int from billing_reconciliation_reports
          where tenant_id = $1 and release_id = $3 and catalog_id = $4 order by created_at desc limit 1) as ledger_difference_minor,
         (select (report ->> 'polarBalanceMinor')::int from billing_reconciliation_reports
          where tenant_id = $1 and release_id = $3 and catalog_id = $4 order by created_at desc limit 1) as payg_polar_balance_minor,
         (select count(*)::int from billing_reconciliation_reports
          where tenant_id = $1 and release_id = $3 and catalog_id = $4 and status = 'mismatch') as reconciliation_failure_count,
         (select (report ->> 'chargedMinorThisWindow')::int from billing_reconciliation_reports
          where tenant_id = $1 and release_id = $3 and catalog_id = $4 order by created_at desc limit 1) as charged_minor_this_window,
         (select (report ->> 'expectedMaxChargeMinorThisWindow')::int from billing_reconciliation_reports
          where tenant_id = $1 and release_id = $3 and catalog_id = $4 order by created_at desc limit 1) as expected_max_charge_minor_this_window,
         (select coalesce(jsonb_agg(jsonb_build_object(
             'id', id, 'entryType', entry_type, 'amountMinor', amount_minor
           ) order by created_at, id), '[]'::jsonb)
          from billing_payg_credit_entries where tenant_id = $1) as credit_entries`,
      [input.organizationId, input.executedAt, input.releaseId, input.catalogId],
    );
    const row = requireRow(result.rows[0]);
    return {
      outboxPendingCount: integer(row.outbox_pending_count),
      oldestPendingAgeSeconds: integer(row.oldest_pending_age_seconds),
      deadLetterCount: integer(row.dead_letter_count),
      webhookLagSeconds: integer(row.webhook_lag_seconds),
      ledgerDifferenceMinor: signedInteger(row.ledger_difference_minor),
      paygPolarBalanceMinor: integer(row.payg_polar_balance_minor),
      reconciliationFailureCount: integer(row.reconciliation_failure_count),
      chargedMinorThisWindow: integer(row.charged_minor_this_window),
      expectedMaxChargeMinorThisWindow: integer(row.expected_max_charge_minor_this_window),
      creditEntries: requireCreditEntries(row.credit_entries),
      thresholds: { outboxPendingCount: 10, outboxOldestAgeSeconds: 300, webhookLagSeconds: 900 },
    };
  }
}

function assertState(state: Record<string, unknown>) {
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("Trusted drill execution state must be an object.");
  }
}

function requireRow(row: Record<string, unknown> | undefined) {
  if (row === undefined) throw new Error("Trusted drill operation source was not found.");
  return row;
}

function integer(value: unknown) {
  if (value === null || value === undefined || value === "") {
    throw new Error("Trusted drill operation returned a missing integer.");
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Trusted drill operation returned an invalid integer.");
  }
  return parsed;
}

function signedInteger(value: unknown) {
  if (value === null || value === undefined || value === "") {
    throw new Error("Trusted drill operation returned a missing integer.");
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("Trusted drill operation returned an invalid integer.");
  return parsed;
}

function requireCreditEntries(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Trusted drill credit entries were not found.");
  return value.map((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Trusted drill credit entry is invalid.");
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || !["grant", "debit", "reversal"].includes(String(row.entryType))) {
      throw new Error("Trusted drill credit entry is invalid.");
    }
    return { id: row.id, entryType: row.entryType, amountMinor: integer(row.amountMinor) };
  });
}

function assertOneMutation(rowCount: number | null, drillId: string) {
  if (rowCount !== 1) throw new Error(`Trusted ${drillId} drill did not change exactly one source record.`);
}

function operationIds(input: TrustedBillingReleaseDrillExecutionInput, executionId: string) {
  if (input.drillId === "zero_balance_stop") return [executionId, input.reservationId!];
  if (input.drillId === "invoice_dispute") {
    return [executionId, input.invoiceId!, input.adjustmentId!];
  }
  if (input.drillId === "charge_stop" || input.drillId === "rollback") {
    return [executionId, input.releaseControlEnvironment!];
  }
  return [executionId];
}
