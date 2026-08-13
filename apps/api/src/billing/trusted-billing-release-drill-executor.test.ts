import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PostgresTrustedBillingReleaseDrillOperations,
  TrustedBillingReleaseDrillExecutor,
  type TrustedBillingReleaseDrillOperations,
} from "./trusted-billing-release-drill-executor";

describe("TrustedBillingReleaseDrillExecutor", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;

  beforeEach(() => {
    const database = newDb();
    database.public.none(`
      create table billing_release_drill_execution_records (
        tenant_id text not null, id text not null, run_id text not null,
        release_id text not null, catalog_id text not null, drill_id text not null,
        actor_id text not null, pre_state jsonb not null, post_state jsonb not null,
        executed_at timestamptz not null, created_at timestamptz not null,
        primary key (tenant_id,id), unique (tenant_id,run_id,drill_id)
      );
      create table billing_release_drill_operation_evidence (
        tenant_id text not null, id text not null, run_id text not null,
        release_id text not null, catalog_id text not null, drill_id text not null,
        evidence_hash text not null, operation_record_ids jsonb not null,
        observed_result jsonb not null, executed_at timestamptz not null,
        source_type text, source_record_id text, payg_order_id text,
        payg_credit_entry_id text, reservation_id text, outbox_id text,
        adjustment_id text, reconciliation_report_id text,
        release_control_environment text, execution_record_id text,
        created_at timestamptz not null,
        primary key (tenant_id,id), unique (tenant_id,run_id,drill_id)
      )
    `);
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool();
  });

  afterEach(async () => pool.end());

  it("writes an actor-bound immutable execution record only after a trusted operation succeeds", async () => {
    const operations = operationHandler(
      { deliveryStopped: false, usageFactCount: 7 },
      { deliveryStopped: true, usageFactCount: 8, deliveredChargeCount: 0 },
    );
    const executor = new TrustedBillingReleaseDrillExecutor(pool, operations);

    await executor.execute({
      organizationId: "tenant-a",
      runId: "run-1",
      releaseId: "release-1",
      catalogId: "catalog-1",
      drillId: "charge_stop",
      actorId: "billing-owner-a",
      executedAt: "2026-08-12T08:00:00.000Z",
      releaseControlEnvironment: "production",
      postState: { deliveryStopped: false, deliveredChargeCount: 99 },
    } as never);

    expect(operations.perform).toHaveBeenCalledOnce();
    const execution = await pool.query(
      "select * from billing_release_drill_execution_records where tenant_id = 'tenant-a'",
    );
    expect(execution.rows[0]).toMatchObject({
      actor_id: "billing-owner-a",
      drill_id: "charge_stop",
      pre_state: { deliveryStopped: false, usageFactCount: 7 },
      post_state: { deliveryStopped: true, usageFactCount: 8, deliveredChargeCount: 0 },
    });
    const evidence = await pool.query(
      "select * from billing_release_drill_operation_evidence where tenant_id = 'tenant-a'",
    );
    expect(evidence.rows[0]).toMatchObject({
      source_type: "execution_record",
      source_record_id: "drill-execution:run-1:charge_stop",
      execution_record_id: "drill-execution:run-1:charge_stop",
      release_control_environment: "production",
    });
  });

  it("writes no evidence when the trusted operation fails", async () => {
    const operations = operationHandler({}, {});
    operations.perform.mockRejectedValueOnce(new Error("Rollback operation failed."));
    const executor = new TrustedBillingReleaseDrillExecutor(pool, operations);

    await expect(executor.execute({
      organizationId: "tenant-a",
      runId: "run-failed",
      releaseId: "release-1",
      catalogId: "catalog-1",
      drillId: "rollback",
      actorId: "billing-owner-a",
      executedAt: "2026-08-12T08:00:00.000Z",
      releaseControlEnvironment: "production",
    })).rejects.toThrow("Rollback operation failed.");

    await expect(pool.query(
      "select count(*)::int as count from billing_release_drill_execution_records",
    )).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(pool.query(
      "select count(*)::int as count from billing_release_drill_operation_evidence",
    )).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it("rejects an unstable durable post-operation readback", async () => {
    const operations = operationHandler(
      { stopped: false },
      { stopped: true },
      { stopped: false },
    );
    const executor = new TrustedBillingReleaseDrillExecutor(pool, operations);

    await expect(executor.execute({
      organizationId: "tenant-a",
      runId: "run-mismatch",
      releaseId: "release-1",
      catalogId: "catalog-1",
      drillId: "rollback",
      actorId: "billing-owner-a",
      executedAt: "2026-08-12T08:00:00.000Z",
      releaseControlEnvironment: "production",
    })).rejects.toThrow("Trusted drill post-operation readback changed before evidence commit.");

    const evidence = await pool.query(
      "select count(*)::int as count from billing_release_drill_operation_evidence",
    );
    expect(evidence.rows[0]?.count).toBe(0);
  });
});

describe("PostgresTrustedBillingReleaseDrillOperations", () => {
  it.each([
    ["zero_balance_stop", { reservationId: "reservation-1" }, "update billing_charge_reservations"],
    ["invoice_dispute", { invoiceId: "invoice-1", adjustmentId: "adjustment-1" }, "update billing_invoices"],
    ["rollback", { releaseControlEnvironment: "production" }, "update billing_charge_release_controls"],
  ] as const)("performs the %s operation before it can qualify", async (drillId, fields, sql) => {
    const database = { query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{}] }) };
    const operations = new PostgresTrustedBillingReleaseDrillOperations(database as never);

    await operations.perform(executionInput(drillId, fields));

    expect(database.query.mock.calls[0]?.[0]).toContain(sql);
  });

  it("fails closed when a requested source record was already pass-shaped", async () => {
    const database = { query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }) };
    const operations = new PostgresTrustedBillingReleaseDrillOperations(database as never);

    await expect(operations.perform(executionInput("rollback", {
      releaseControlEnvironment: "production",
    }))).rejects.toThrow("Trusted rollback drill did not change exactly one source record.");
  });

  it("reads a disputed invoice only when its adjustment targets the invoice ledger entry", async () => {
    const database = { query: vi.fn().mockResolvedValue({ rows: [{
      invoice_status: "disputed",
      invoice_ledger_entry_id: "ledger-1",
      adjustment_ledger_entry_id: "ledger-1",
    }] }) };
    const operations = new PostgresTrustedBillingReleaseDrillOperations(database as never);

    await expect(operations.readState(executionInput("invoice_dispute", {
      invoiceId: "invoice-1", adjustmentId: "adjustment-1",
    }))).resolves.toEqual({
      invoiceFrozen: true,
      evidenceLinked: true,
      correctionUsesAdjustment: true,
    });
  });

  it("returns the full rollback and release signal contracts", async () => {
    const rollbackDatabase = { query: vi.fn().mockResolvedValue({ rows: [{
      delivery_stopped: true, usage_fact_count: 7, duplicate_charge_count: 0,
    }] }) };
    const rollback = new PostgresTrustedBillingReleaseDrillOperations(rollbackDatabase as never);
    await expect(rollback.readState(executionInput("rollback", {
      releaseControlEnvironment: "production",
    }))).resolves.toMatchObject({ duplicateChargeCount: 0 });

    const signalDatabase = { query: vi.fn().mockResolvedValue({ rows: [{
      outbox_pending_count: 0, oldest_pending_age_seconds: 0, dead_letter_count: 0,
      webhook_lag_seconds: 0, ledger_difference_minor: 0, payg_polar_balance_minor: 375,
      reconciliation_failure_count: 0, charged_minor_this_window: 0,
      expected_max_charge_minor_this_window: 0,
      credit_entries: [{ id: "grant-1", entryType: "grant", amountMinor: 500 }],
    }] }) };
    const signals = new PostgresTrustedBillingReleaseDrillOperations(signalDatabase as never);
    await expect(signals.readState(executionInput("release_signals"))).resolves.toMatchObject({
      creditEntries: [{ id: "grant-1", entryType: "grant", amountMinor: 500 }],
      thresholds: { outboxPendingCount: 10, outboxOldestAgeSeconds: 300, webhookLagSeconds: 900 },
      paygPolarBalanceMinor: 375,
    });
    expect(signalDatabase.query.mock.calls[0]?.[0]).toContain("'polarBalanceMinor'");
  });

  it("fails closed when independent Polar balance evidence is missing", async () => {
    const database = { query: vi.fn().mockResolvedValue({ rows: [{
      outbox_pending_count: 0, oldest_pending_age_seconds: 0, dead_letter_count: 0,
      webhook_lag_seconds: 0, ledger_difference_minor: 0, payg_polar_balance_minor: null,
      reconciliation_failure_count: 0, charged_minor_this_window: 0,
      expected_max_charge_minor_this_window: 0, credit_entries: [],
    }] }) };
    const operations = new PostgresTrustedBillingReleaseDrillOperations(database as never);

    await expect(operations.readState(executionInput("release_signals")))
      .rejects.toThrow("Trusted drill operation returned a missing integer.");
  });
});

function executionInput(drillId: Parameters<TrustedBillingReleaseDrillExecutor["execute"]>[0]["drillId"], fields = {}) {
  return {
    organizationId: "tenant-a", runId: "run-1", releaseId: "release-1",
    catalogId: "catalog-1", drillId, actorId: "owner-a",
    executedAt: "2026-08-12T08:00:00.000Z", ...fields,
  };
}

function operationHandler(
  preState: Record<string, unknown>,
  postState: Record<string, unknown>,
  confirmedPostState = postState,
) {
  return {
    readState: vi.fn()
      .mockResolvedValueOnce(preState)
      .mockResolvedValueOnce(postState)
      .mockResolvedValueOnce(confirmedPostState),
    perform: vi.fn().mockResolvedValue(undefined),
  } satisfies TrustedBillingReleaseDrillOperations;
}
