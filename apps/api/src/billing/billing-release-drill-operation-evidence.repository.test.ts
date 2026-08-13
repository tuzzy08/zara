import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  hashBillingReleaseDrillEvidence,
  PostgresBillingReleaseDrillOperationEvidenceReader,
} from "./billing-release-drill-operation-evidence.repository";

describe("PostgresBillingReleaseDrillOperationEvidenceReader", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;

  beforeEach(() => {
    const database = newDb();
    database.public.none(`
      create table billing_price_catalogs (id text primary key, version bigint not null);
      create table billing_payg_orders (
        tenant_id text not null, id text not null, currency text not null,
        paid_amount_minor bigint not null, granted_credit_minor bigint not null,
        status text not null, primary key (tenant_id,id)
      );
      create table billing_ledger_entries (
        tenant_id text not null, id text not null, primary key (tenant_id,id)
      );
      create table billing_adjustments (
        tenant_id text not null, id text not null, ledger_entry_id text not null,
        created_by text not null, primary key (tenant_id,id),
        foreign key (tenant_id,ledger_entry_id) references billing_ledger_entries(tenant_id,id)
      );
      create table audit_logs (
        tenant_id text not null, id text not null, actor_id text not null,
        action text not null, target_id text, primary key (tenant_id,id)
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
        ledger_entry_id text, audit_log_id text,
        primary key (tenant_id, id),
        foreign key (tenant_id,payg_order_id) references billing_payg_orders(tenant_id,id),
        foreign key (tenant_id,adjustment_id) references billing_adjustments(tenant_id,id),
        foreign key (tenant_id,ledger_entry_id) references billing_ledger_entries(tenant_id,id),
        foreign key (tenant_id,audit_log_id) references audit_logs(tenant_id,id)
      );
      insert into billing_price_catalogs values ('catalog-1', 3), ('catalog-other', 4);
      insert into billing_payg_orders values ('tenant-a','order-a','usd',500,500,'paid');
      insert into billing_release_drill_operation_evidence (
        tenant_id,id,run_id,release_id,catalog_id,drill_id,evidence_hash,
        operation_record_ids,observed_result,executed_at,
        source_type,source_record_id,payg_order_id
      ) values
        ('tenant-a','evidence-a','run-1','release-1','catalog-1','top_up',
         '${"f".repeat(64)}','["order-a"]','{"paid":false}',
         '2026-08-12T08:00:00Z','payg_order','order-a','order-a'),
        ('tenant-b','evidence-b','run-1','release-1','catalog-1','top_up',
         '${evidenceHash("top_up", ["order-b"], { paid: false })}','["order-b"]','{"paid":false}',
         '2026-08-12T08:00:00Z',null,null,null),
        ('tenant-a','evidence-other-release','run-1','release-2','catalog-1','paid_grant',
         '${evidenceHash("paid_grant", ["grant-other"], { grantCount: 1 })}','["grant-other"]','{"grantCount":1}',
         '2026-08-12T08:00:00Z',null,null,null),
        ('tenant-a','evidence-other-catalog','run-1','release-1','catalog-other','reservation',
         '${evidenceHash("reservation", ["reservation-other"], { accepted: true })}','["reservation-other"]','{"accepted":true}',
         '2026-08-12T08:00:00Z',null,null,null)
    `);
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool();
  });

  afterEach(async () => pool.end());

  it("reads operation evidence only for the exact tenant, run, release, and catalog", async () => {
    const reader = new PostgresBillingReleaseDrillOperationEvidenceReader(
      pool,
      () => new Date("2026-08-12T09:00:00.000Z"),
    );

    await expect(reader.loadRun({
      organizationId: "tenant-a",
      runId: "run-1",
      releaseId: "release-1",
      catalogId: "catalog-1",
    })).resolves.toEqual([{
      id: "evidence-a",
      organizationId: "tenant-a",
      runId: "run-1",
      releaseId: "release-1",
      catalogId: "catalog-1",
      catalogVersion: 3,
      drillId: "top_up",
      sourceType: "payg_order",
      sourceRecordId: "order-a",
      evidenceHash: evidenceHash("top_up", ["order-a"], {
        currency: "USD", orderAmountMinor: 500, packProductKey: "payg-5-usd", paid: true,
      }),
      operationRecordIds: ["order-a"],
      observedResult: {
        currency: "USD", orderAmountMinor: 500, packProductKey: "payg-5-usd", paid: true,
      },
      executedAt: "2026-08-12T08:00:00.000Z",
      fetchedAt: "2026-08-12T09:00:00.000Z",
    }]);
  });

  it("rejects evidence that is not bound to an operation record", async () => {
    await pool.query(`insert into billing_release_drill_operation_evidence (
      tenant_id,id,run_id,release_id,catalog_id,drill_id,evidence_hash,
      operation_record_ids,observed_result,executed_at
    ) values
      ('tenant-a','evidence-empty','run-empty','release-1','catalog-1','top_up',
       $1,'[]','{"paid":true}','2026-08-12T08:00:00Z')`, ["e".repeat(64)]);
    const reader = new PostgresBillingReleaseDrillOperationEvidenceReader(pool);

    await expect(reader.loadRun({
      organizationId: "tenant-a",
      runId: "run-empty",
      releaseId: "release-1",
      catalogId: "catalog-1",
    })).rejects.toThrow("Stored drill operation evidence has no trusted source record.");
  });

  it("cannot store a typed source reference when the tenant source record is missing", async () => {
    await expect(pool.query(`insert into billing_release_drill_operation_evidence (
      tenant_id,id,run_id,release_id,catalog_id,drill_id,evidence_hash,
      operation_record_ids,observed_result,executed_at,
      source_type,source_record_id,payg_order_id
    ) values (
      'tenant-a','missing-source','run-missing','release-1','catalog-1','top_up',$1,
      '["missing-order"]','{}','2026-08-12T08:00:00Z',
      'payg_order','missing-order','missing-order'
    )`, ["a".repeat(64)])).rejects.toThrow();
  });

  it("recomputes adjustment evidence from the original ledger row and append-only audit", async () => {
    await pool.query(`
      insert into billing_ledger_entries values ('tenant-a','ledger-a');
      insert into billing_adjustments values ('tenant-a','adjustment-a','ledger-a','billing-owner-a');
      insert into audit_logs values (
        'tenant-a','audit-a','billing-owner-a','billing.adjustment_applied','adjustment-a'
      );
      insert into billing_release_drill_operation_evidence (
        tenant_id,id,run_id,release_id,catalog_id,drill_id,evidence_hash,
        operation_record_ids,observed_result,executed_at,
        source_type,source_record_id,adjustment_id,ledger_entry_id,audit_log_id
      ) values (
        'tenant-a','evidence-adjustment','run-adjustment','release-1','catalog-1','adjustment',$1,
        '["adjustment-a","ledger-a","audit-a"]','{"auditRecordCount":99}',
        '2026-08-12T08:00:00Z','adjustment','adjustment-a','adjustment-a','ledger-a','audit-a'
      )
    `, ["f".repeat(64)]);
    const reader = new PostgresBillingReleaseDrillOperationEvidenceReader(pool);

    const [evidence] = await reader.loadRun({
      organizationId: "tenant-a",
      runId: "run-adjustment",
      releaseId: "release-1",
      catalogId: "catalog-1",
    });

    expect(evidence?.observedResult).toEqual({
      originalLedgerEntryPreserved: true,
      adjustmentCount: 1,
      auditRecordCount: 1,
    });
  });

  it("rejects changed-original, missing-audit, and cross-tenant adjustment evidence", async () => {
    await pool.query(`
      insert into billing_ledger_entries values
        ('tenant-a','ledger-a'), ('tenant-a','ledger-other'), ('tenant-b','ledger-b');
      insert into billing_adjustments values
        ('tenant-a','adjustment-a','ledger-a','owner-a'),
        ('tenant-b','adjustment-b','ledger-b','owner-b');
      insert into audit_logs values
        ('tenant-a','audit-a','owner-a','billing.adjustment_applied','adjustment-a'),
        ('tenant-b','audit-b','owner-b','billing.adjustment_applied','adjustment-b');
    `);
    const insert = (id: string, adjustmentId: string, ledgerId: string, auditId: string) =>
      pool.query(`insert into billing_release_drill_operation_evidence (
        tenant_id,id,run_id,release_id,catalog_id,drill_id,evidence_hash,
        operation_record_ids,observed_result,executed_at,
        source_type,source_record_id,adjustment_id,ledger_entry_id,audit_log_id
      ) values ('tenant-a',$1,$1,'release-1','catalog-1','adjustment',$2,$3,'{}',
        '2026-08-12T08:00:00Z','adjustment',$4,$4,$5,$6)`, [
        id,
        "a".repeat(64),
        JSON.stringify([adjustmentId, ledgerId, auditId]),
        adjustmentId,
        ledgerId,
        auditId,
      ]);

    await expect(insert("changed-original", "adjustment-a", "ledger-other", "audit-a"))
      .resolves.toBeDefined();
    const reader = new PostgresBillingReleaseDrillOperationEvidenceReader(pool);
    await expect(reader.loadRun({
      organizationId: "tenant-a", runId: "changed-original",
      releaseId: "release-1", catalogId: "catalog-1",
    })).rejects.toThrow("Adjustment evidence does not match its original ledger entry.");
    await expect(insert("missing-audit", "adjustment-a", "ledger-a", "missing-audit"))
      .rejects.toThrow();
    await expect(insert("cross-tenant", "adjustment-b", "ledger-b", "audit-b"))
      .rejects.toThrow();
  });
});

function evidenceHash(
  drillId: string,
  operationRecordIds: string[],
  observedResult: Record<string, unknown>,
) {
  return hashBillingReleaseDrillEvidence({
    drillId,
    sourceType: "payg_order",
    sourceRecordId: operationRecordIds[0]!,
    operationRecordIds,
    observedResult,
  });
}
