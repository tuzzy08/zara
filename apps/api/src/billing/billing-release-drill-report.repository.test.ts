import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PostgresBillingReleaseDrillReportRepository,
  type StoredBillingReleaseDrillReport,
} from "./billing-release-drill-report.repository";

describe("PostgresBillingReleaseDrillReportRepository", () => {
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;

  beforeEach(() => {
    const database = newDb();
    database.public.none(`
      create table billing_release_drill_reports (
        tenant_id text not null,
        id text not null,
        idempotency_key text not null,
        schema_version text not null,
        release_id text not null,
        catalog_id text not null,
        catalog_version bigint not null,
        executed_at timestamptz not null,
        valid_until timestamptz not null,
        status text not null,
        drill_results jsonb not null,
        alert_results jsonb not null,
        created_at timestamptz not null,
        primary key (tenant_id, id),
        unique (tenant_id, idempotency_key)
      )
    `);
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool();
  });

  afterEach(async () => pool.end());

  it("stores complete failed evidence and returns it only for the tenant release scope", async () => {
    const repository = new PostgresBillingReleaseDrillReportRepository(pool);
    const report = failedReport();

    await expect(repository.save(report)).resolves.toEqual({ report, duplicate: false });
    await expect(repository.listByRelease({
      organizationId: "tenant-other",
      releaseId: report.releaseId,
    })).resolves.toEqual([]);
    await expect(repository.listByRelease({
      organizationId: report.organizationId,
      releaseId: "release-other",
    })).resolves.toEqual([]);
    await expect(repository.listByRelease({
      organizationId: report.organizationId,
      releaseId: report.releaseId,
    })).resolves.toEqual([report]);
  });

  it("accepts an exact idempotent replay and rejects changed evidence", async () => {
    const repository = new PostgresBillingReleaseDrillReportRepository(pool);
    const report = failedReport();
    await repository.save(report);

    await expect(repository.save(report)).resolves.toEqual({ report, duplicate: true });
    await expect(repository.save({ ...report, status: "passed" })).rejects.toThrow(
      "Drill report replay does not match the stored evidence.",
    );
  });

  it("rejects reuse of a report ID with a different idempotency key", async () => {
    const repository = new PostgresBillingReleaseDrillReportRepository(pool);
    const report = failedReport();
    await repository.save(report);

    await expect(repository.save({
      ...report,
      idempotencyKey: "different-idempotency-key",
    })).rejects.toThrow("Drill report ID already belongs to different evidence.");
  });

  it("rejects fixture results that do not have durable operation bindings", async () => {
    const repository = new PostgresBillingReleaseDrillReportRepository(pool);
    const report = failedReport();

    await expect(repository.save({
      ...report,
      evidenceKind: "fixture",
      drills: report.drills.map((drill) => ({ ...drill, source: null })),
    } as never)).rejects.toThrow(
      "Only durable operation evidence can be stored as a drill qualification report.",
    );
  });
});

function failedReport(): StoredBillingReleaseDrillReport {
  return {
    schemaVersion: "zara.billing-drill-qualification.v1",
    evidenceKind: "durable",
    reportId: "report-1",
    idempotencyKey: "release-1:tenant-a:drills",
    organizationId: "tenant-a",
    releaseId: "release-1",
    catalog: { id: "catalog-1", version: 1 },
    executedAt: "2026-08-12T08:00:00.000Z",
    validUntil: "2026-08-13T08:00:00.000Z",
    status: "failed",
    chargeDeliveryEnabled: false,
    drills: [{
      id: "zero_balance_stop",
      status: "failed",
      failureCode: "payg_zero_balance_did_not_stop",
      evidence: { remainingMinor: 0, stoppedAfterCurrentTurn: false },
      source: {
        evidenceId: "evidence-zero-stop",
        sourceType: "execution_record",
        sourceRecordId: "stop-record-1",
        operationRecordIds: ["stop-record-1"],
        evidenceHash: "a".repeat(64),
        fetchedAt: "2026-08-12T08:01:00.000Z",
      },
    }],
    alerts: [{
      classification: "payg_mismatch",
      owner: "billing_reconciliation",
      severity: "release_blocking",
      status: "alert",
    }],
  };
}
