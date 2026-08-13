import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  BillingCycleLocalEvidence,
  BillingReconciliationMismatchDraft,
  BillingReconciliationReportRepository,
} from "./billing-usage-reconciliation.service";

type Queryable = Pick<Pool | PoolClient, "query">;

@Injectable()
export class PostgresBillingReconciliationReportRepository
implements BillingReconciliationReportRepository {
  constructor(private readonly database: Queryable) {}

  async loadLocalCycleEvidence(input: {
    organizationId: string;
    cycleStartsAt: string;
    cycleEndsAt: string;
  }): Promise<BillingCycleLocalEvidence> {
    const parameters = [input.organizationId, input.cycleStartsAt, input.cycleEndsAt];
    const [ledger, outbox, orders, creditEntries, reservations, reservationSnapshot] =
      await Promise.all([
        this.database.query(
          `select id, entry_type, metadata ->> 'billingClass' as meter_key,
                  metadata ->> 'kind' as adjustment_kind, quantity,
                  customer_amount_minor
             from billing_ledger_entries
            where tenant_id = $1
              and occurred_at >= $2::timestamptz
              and occurred_at < $3::timestamptz
            order by occurred_at, id`,
          parameters,
        ),
        this.database.query(
          `select outbox.id, outbox.aggregate_id, outbox.status, outbox.payload
             from billing_outbox outbox
             left join billing_ledger_entries ledger
               on outbox.tenant_id = ledger.tenant_id
              and outbox.aggregate_type = 'billing_ledger_entry'
              and outbox.aggregate_id = ledger.id
             left join billing_payg_credit_entries credit
               on outbox.tenant_id = credit.tenant_id
              and outbox.aggregate_type = 'payg_credit_entry'
              and outbox.aggregate_id = credit.id
            where outbox.tenant_id = $1
              and ((ledger.occurred_at >= $2::timestamptz and ledger.occurred_at < $3::timestamptz)
                or (credit.created_at >= $2::timestamptz and credit.created_at < $3::timestamptz))
            order by outbox.created_at, outbox.id`,
          parameters,
        ),
        this.database.query(
          `select id, status, paid_amount_minor, granted_credit_minor
             from billing_payg_orders
            where tenant_id = $1
              and ((created_at >= $2::timestamptz and created_at < $3::timestamptz)
                or id in (
                  select order_id
                    from billing_payg_credit_entries
                   where tenant_id = $1
                     and order_id is not null
                     and created_at >= $2::timestamptz
                     and created_at < $3::timestamptz
                ))
            order by created_at, id`,
          parameters,
        ),
        this.database.query(
          `with referenced_order_id as (
             select distinct order_id
               from billing_payg_credit_entries
              where tenant_id = $1
                and order_id is not null
                and created_at >= $2::timestamptz
                and created_at < $3::timestamptz
           )
           select order_id, entry_type, amount_minor
             from billing_payg_credit_entries
            where tenant_id = $1
              and ((created_at >= $2::timestamptz and created_at < $3::timestamptz)
                or order_id in (select order_id from referenced_order_id))
            order by created_at, id`,
          parameters,
        ),
        this.database.query(
          `select case
                    when created_at < $3::timestamptz
                     and expires_at > $3::timestamptz
                     and (status in ('active', 'expired')
                       or finalized_at >= $3::timestamptz
                       or released_at >= $3::timestamptz)
                    then 'active'
                    else status
                  end as status,
                  reserved_amount_minor, actual_amount_minor
             from billing_charge_reservations
            where tenant_id = $1
              and created_at < $3::timestamptz
            order by created_at, id`,
          parameters,
        ),
        this.database.query(
          `select coalesce(sum(reserved_amount_minor) filter (
                    where created_at < $3::timestamptz
                      and expires_at > $3::timestamptz
                      and (status in ('active', 'expired')
                        or finalized_at >= $3::timestamptz
                        or released_at >= $3::timestamptz)
                  ), 0) as reservation_snapshot_minor
             from billing_charge_reservations
            where tenant_id = $1`,
          parameters,
        ),
      ]);

    return {
      ledger: ledger.rows.map(mapLedger),
      outbox: outbox.rows.map(mapOutbox),
      payg: {
        orders: orders.rows.map(mapOrder),
        creditEntries: creditEntries.rows.map(mapCreditEntry),
        reservations: reservations.rows.map(mapReservation),
        reservationSnapshotMinor: reservationSnapshot.rows.length === 0
          ? 0
          : integer(
              reservationSnapshot.rows[0]?.reservation_snapshot_minor,
              "reservation_snapshot_minor",
            ),
      },
    };
  }

  async listTenantCycles(now: string) {
    const result = await this.database.query(
      `select tenant_id, catalog_id, starts_at, ends_at
         from billing_cycles
        where starts_at < $1::timestamptz
          and ends_at > $1::timestamptz - interval '35 days'
        order by tenant_id, starts_at`,
      [now],
    );
    return result.rows.map((row) => ({
      organizationId: text(row.tenant_id, "tenant_id"),
      catalogId: text(row.catalog_id, "catalog_id"),
      cycleStartsAt: timestamp(row.starts_at, "starts_at"),
      cycleEndsAt: timestamp(row.ends_at, "ends_at"),
    }));
  }

  async appendReport(input: {
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
  }) {
    const evidenceId = `billing_reconciliation_report_${createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex")}`;
    const id = evidenceId;
    await this.database.query(
      `insert into billing_reconciliation_reports (
         tenant_id, id, release_id, catalog_id, run_key, cycle_starts_at,
         cycle_ends_at, valid_until, status, mismatch_count, evidence_id, report, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, now())
       on conflict (tenant_id, id) do nothing`,
      [
        input.organizationId,
        id,
        input.releaseId,
        input.catalogId,
        input.runKey,
        input.cycleStartsAt,
        input.cycleEndsAt,
        input.validUntil,
        input.status,
        input.mismatchCount,
        evidenceId,
        JSON.stringify(input.report),
      ],
    );
    return { evidenceId };
  }

  async appendMismatchEvidence(input: BillingReconciliationMismatchDraft & {
    organizationId: string;
    cycleStartsAt: string;
    cycleEndsAt: string;
  }) {
    const cycleId = `${input.cycleStartsAt}/${input.cycleEndsAt}`;
    const evidenceId = `billing_reconciliation_${createHash("sha256").update(JSON.stringify({
      organizationId: input.organizationId,
      cycleId,
      mismatchClass: input.mismatchClass,
      owner: input.owner,
      correctionRule: input.correctionRule,
      severity: input.severity,
      details: input.details,
    })).digest("hex")}`;
    await this.database.query(
      `insert into audit_logs (
         id, tenant_id, actor_type, actor_id, action, target_type, target_id,
         metadata, occurred_at
       ) values ($1, $2, 'system', 'billing-reconciliation', $3, $4, $5, $6::jsonb, now())
       on conflict (id) do nothing`,
      [
        evidenceId,
        input.organizationId,
        "billing.reconciliation_mismatch",
        "billing_cycle",
        cycleId,
        JSON.stringify({
          mismatchClass: input.mismatchClass,
          owner: input.owner,
          correctionRule: input.correctionRule,
          severity: input.severity,
          cycleStartsAt: input.cycleStartsAt,
          cycleEndsAt: input.cycleEndsAt,
          details: input.details,
        }),
      ],
    );
    return { evidenceId };
  }
}

function mapLedger(row: QueryResultRow): BillingCycleLocalEvidence["ledger"][number] {
  return {
    id: text(row.id, "id"),
    entryType: text(row.entry_type, "entry_type"),
    meterKey: row.meter_key === null ? null : text(row.meter_key, "meter_key"),
    ...(row.adjustment_kind === null
      ? {}
      : { adjustmentKind: adjustmentKind(row.adjustment_kind) }),
    quantity: integer(row.quantity, "quantity"),
    customerAmountMinor: row.customer_amount_minor === null
      ? null
      : integer(row.customer_amount_minor, "customer_amount_minor"),
  };
}

function mapOutbox(row: QueryResultRow): BillingCycleLocalEvidence["outbox"][number] {
  const payload = record(row.payload, "payload");
  const deliveryMode = text(payload.deliveryMode, "payload.deliveryMode");
  if (deliveryMode !== "shadow" && deliveryMode !== "charge") {
    throw new Error(`Unsupported billing outbox delivery mode: ${deliveryMode}.`);
  }
  const status = text(row.status, "status");
  if (
    status !== "pending"
    && status !== "processing"
    && status !== "delivered"
    && status !== "dead_letter"
  ) {
    throw new Error(`Unsupported billing outbox status: ${status}.`);
  }
  return {
    id: text(row.id, "id"),
    aggregateId: text(row.aggregate_id, "aggregate_id"),
    meterKey: text(payload.meterKey, "payload.meterKey"),
    quantity: integer(payload.quantity, "payload.quantity"),
    deliveryMode,
    status,
  };
}

function mapOrder(row: QueryResultRow): BillingCycleLocalEvidence["payg"]["orders"][number] {
  return {
    id: text(row.id, "id"),
    status: text(row.status, "status"),
    paidAmountMinor: integer(row.paid_amount_minor, "paid_amount_minor"),
    grantedCreditMinor: integer(row.granted_credit_minor, "granted_credit_minor"),
  };
}

function mapCreditEntry(
  row: QueryResultRow,
): BillingCycleLocalEvidence["payg"]["creditEntries"][number] {
  const entryType = text(row.entry_type, "entry_type");
  if (
    entryType !== "grant"
    && entryType !== "debit"
    && entryType !== "reversal"
    && entryType !== "adjustment"
  ) {
    throw new Error(`Unsupported PAYG credit entry type: ${entryType}.`);
  }
  return {
    ...(row.order_id == null ? {} : { orderId: text(row.order_id, "order_id") }),
    entryType,
    amountMinor: integer(row.amount_minor, "amount_minor"),
  };
}

function mapReservation(
  row: QueryResultRow,
): BillingCycleLocalEvidence["payg"]["reservations"][number] {
  const status = text(row.status, "status");
  if (
    status !== "active"
    && status !== "expired"
    && status !== "finalized"
    && status !== "released"
  ) {
    throw new Error(`Unsupported billing reservation status: ${status}.`);
  }
  return {
    status,
    reservedAmountMinor: integer(row.reserved_amount_minor, "reserved_amount_minor"),
    ...(row.actual_amount_minor === null
      ? {}
      : { actualAmountMinor: integer(row.actual_amount_minor, "actual_amount_minor") }),
  };
}

function integer(value: unknown, field: string) {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
  return normalized;
}

function text(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required.`);
  }
  return value;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} is required.`);
  }
  return value as Record<string, unknown>;
}

function adjustmentKind(value: unknown): "credit" | "debit" {
  if (value === "credit" || value === "debit") return value;
  throw new Error("adjustment_kind must be credit or debit.");
}

function timestamp(value: unknown, field: string) {
  const normalized = value instanceof Date ? value.toISOString() : text(value, field);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${field} must be a timestamp.`);
  return normalized;
}
