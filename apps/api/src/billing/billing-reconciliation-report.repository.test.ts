import { describe, expect, it, vi } from "vitest";

import { PostgresBillingReconciliationReportRepository } from "./billing-reconciliation-report.repository";

describe("PostgresBillingReconciliationReportRepository", () => {
  it("loads tenant-cycle ledger, outbox, and PAYG facts without replacing missing values with zero", async () => {
    const database = queryDatabase({
      billing_ledger_entries: [{
        id: "ledger-1",
        entry_type: "runtime_charge",
        meter_key: "standard_runtime_seconds",
        adjustment_kind: null,
        quantity: "60",
        customer_amount_minor: null,
      }],
      billing_outbox: [{
        id: "outbox-1",
        aggregate_id: "ledger-1",
        status: "pending",
        payload: {
          meterKey: "standard_runtime_seconds",
          quantity: 60,
          deliveryMode: "shadow",
        },
      }],
      billing_payg_orders: [{
        id: "order-1",
        status: "paid",
        paid_amount_minor: "500",
        granted_credit_minor: "500",
      }],
      billing_payg_credit_entries: [
        { order_id: "order-1", entry_type: "grant", amount_minor: "500" },
        { entry_type: "debit", amount_minor: "89" },
      ],
      billing_charge_reservations: [{
        status: "active",
        reserved_amount_minor: "120",
        actual_amount_minor: null,
      }],
      reservation_snapshot: [{ reservation_snapshot_minor: "120" }],
    });
    const repository = new PostgresBillingReconciliationReportRepository(database);

    const evidence = await repository.loadLocalCycleEvidence({
      organizationId: "tenant-a",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
    });

    expect(evidence).toEqual({
      ledger: [{
        id: "ledger-1",
        entryType: "runtime_charge",
        meterKey: "standard_runtime_seconds",
        quantity: 60,
        customerAmountMinor: null,
      }],
      outbox: [{
        id: "outbox-1",
        aggregateId: "ledger-1",
        meterKey: "standard_runtime_seconds",
        quantity: 60,
        deliveryMode: "shadow",
        status: "pending",
      }],
      payg: {
        orders: [{ id: "order-1", status: "paid", paidAmountMinor: 500, grantedCreditMinor: 500 }],
        creditEntries: [
          { orderId: "order-1", entryType: "grant", amountMinor: 500 },
          { entryType: "debit", amountMinor: 89 },
        ],
        reservations: [{ status: "active", reservedAmountMinor: 120 }],
        reservationSnapshotMinor: 120,
      },
    });
    expect(database.query).toHaveBeenCalledTimes(6);
    expect(database.query.mock.calls.every((call) => call[1]?.[0] === "tenant-a")).toBe(true);
    const outboxSql = database.query.mock.calls[1]![0] as string;
    expect(outboxSql).toContain("join billing_ledger_entries");
    expect(outboxSql).toContain("occurred_at >= $2::timestamptz");
    expect(outboxSql).not.toContain("billing_outbox\n            where");
    const snapshotSql = database.query.mock.calls[5]![0] as string;
    expect(snapshotSql).toContain("finalized_at");
    expect(snapshotSql).not.toContain("billing_reservation_accounts");
    const ordersSql = database.query.mock.calls[2]![0] as string;
    const creditsSql = database.query.mock.calls[3]![0] as string;
    expect(ordersSql).toContain("billing_payg_credit_entries");
    expect(creditsSql).toContain("referenced_order_id");
  });

  it("persists each tenant-cycle report with release-bound evidence", async () => {
    const database = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const repository = new PostgresBillingReconciliationReportRepository(database);

    const result = await repository.appendReport({
      organizationId: "tenant-a",
      releaseId: "release-1",
      catalogId: "catalog-1",
      runKey: "daily:2026-09-01",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
      validUntil: "2026-09-02T00:00:00.000Z",
      status: "matched",
      mismatchCount: 0,
      report: { status: "matched" },
    });

    expect(result.evidenceId).toMatch(/^billing_reconciliation_report_/);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("insert into billing_reconciliation_reports"),
      expect.arrayContaining([
        "tenant-a",
        "release-1",
        "catalog-1",
        "daily:2026-09-01",
        "matched",
        0,
        result.evidenceId,
      ]),
    );
  });

  it("appends immutable mismatch audit evidence and returns its generated ID", async () => {
    const database = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const repository = new PostgresBillingReconciliationReportRepository(database);

    const result = await repository.appendMismatchEvidence({
      organizationId: "tenant-a",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
      mismatchClass: "draft_invoice_total_mismatch",
      owner: "finance_operations",
      correctionRule: "hold_invoice_and_append_approved_adjustment",
      severity: "critical",
      details: { zaraCustomerAmountMinor: 98, draftInvoiceAmountMinor: 99 },
    });

    expect(result.evidenceId).toMatch(/^billing_reconciliation_/);
    const replay = await repository.appendMismatchEvidence({
      organizationId: "tenant-a",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
      mismatchClass: "draft_invoice_total_mismatch",
      owner: "finance_operations",
      correctionRule: "hold_invoice_and_append_approved_adjustment",
      severity: "critical",
      details: { zaraCustomerAmountMinor: 98, draftInvoiceAmountMinor: 99 },
    });
    expect(replay.evidenceId).toBe(result.evidenceId);
    const [statement, values] = database.query.mock.calls[0]!;
    expect(statement).toContain("insert into audit_logs");
    expect(statement).toContain("on conflict (id) do nothing");
    expect(statement).not.toMatch(/update|delete/i);
    expect(values).toEqual([
      result.evidenceId,
      "tenant-a",
      "billing.reconciliation_mismatch",
      "billing_cycle",
      "2026-08-01T00:00:00.000Z/2026-09-01T00:00:00.000Z",
      expect.stringContaining('"mismatchClass":"draft_invoice_total_mismatch"'),
    ]);
  });
});

function queryDatabase(rowsByTable: Record<string, Array<Record<string, unknown>>>) {
  return {
    query: vi.fn().mockImplementation(async (statement: string) => {
      if (statement.includes("as reservation_snapshot_minor")) {
        return { rows: rowsByTable.reservation_snapshot ?? [] };
      }
      const table = Object.keys(rowsByTable).find((name) => statement.includes(`from ${name}`));
      return { rows: table === undefined ? [] : rowsByTable[table] };
    }),
  };
}
