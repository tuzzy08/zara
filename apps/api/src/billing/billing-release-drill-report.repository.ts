import { isDeepStrictEqual } from "node:util";

import { Injectable } from "@nestjs/common";
import type { Pool, QueryResultRow } from "pg";

export const BILLING_RELEASE_DRILL_REPORT_REPOSITORY = Symbol(
  "BILLING_RELEASE_DRILL_REPORT_REPOSITORY",
);

export interface StoredBillingReleaseDrillReport {
  schemaVersion: "zara.billing-drill-qualification.v1";
  evidenceKind: "durable";
  reportId: string;
  idempotencyKey: string;
  organizationId: string;
  releaseId: string;
  catalog: { id: string; version: number };
  executedAt: string;
  validUntil: string;
  status: "passed" | "failed";
  chargeDeliveryEnabled: false;
  drills: Array<{
    id: string;
    status: "passed" | "failed";
    failureCode?: string | undefined;
    evidence: Record<string, boolean | number | string>;
    source: {
      evidenceId: string;
      sourceType: string;
      sourceRecordId: string;
      operationRecordIds: string[];
      evidenceHash: string;
      fetchedAt: string;
    } | null;
  }>;
  alerts: Array<{
    classification: string;
    owner: string;
    severity: "release_blocking";
    status: "alert" | "clear";
  }>;
}

export interface BillingReleaseDrillReportRepository {
  save(report: StoredBillingReleaseDrillReport): Promise<{
    report: StoredBillingReleaseDrillReport;
    duplicate: boolean;
  }>;
  listByRelease(input: {
    organizationId: string;
    releaseId: string;
  }): Promise<StoredBillingReleaseDrillReport[]>;
}

@Injectable()
export class PostgresBillingReleaseDrillReportRepository
implements BillingReleaseDrillReportRepository {
  constructor(private readonly database: Pick<Pool, "query">) {}

  async save(report: StoredBillingReleaseDrillReport) {
    assertDurableReport(report);
    const existingReplay = await this.findByIdempotencyKey(
      report.organizationId,
      report.idempotencyKey,
    );
    if (existingReplay !== null) {
      assertReplayMatch(existingReplay, report);
      return { report: existingReplay, duplicate: true };
    }

    try {
      await this.database.query(
      `insert into billing_release_drill_reports (
         tenant_id, id, idempotency_key, schema_version, release_id,
         catalog_id, catalog_version, executed_at, valid_until, status,
         drill_results, alert_results, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $8)`,
      [
        report.organizationId,
        report.reportId,
        report.idempotencyKey,
        report.schemaVersion,
        report.releaseId,
        report.catalog.id,
        report.catalog.version,
        report.executedAt,
        report.validUntil,
        report.status,
        JSON.stringify(report.drills),
        JSON.stringify(report.alerts),
      ],
      );
      return { report, duplicate: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    const concurrentReplay = await this.findByIdempotencyKey(
      report.organizationId,
      report.idempotencyKey,
    );
    if (concurrentReplay !== null) {
      assertReplayMatch(concurrentReplay, report);
      return { report: concurrentReplay, duplicate: true };
    }
    if (await this.findByReportId(report.organizationId, report.reportId) !== null) {
      throw new Error("Drill report ID already belongs to different evidence.");
    }
    throw new Error("Drill report could not be stored after a uniqueness conflict.");
  }

  async listByRelease(input: { organizationId: string; releaseId: string }) {
    const result = await this.database.query(
      `${SELECT_REPORT}
       where tenant_id = $1 and release_id = $2
       order by executed_at desc, id asc`,
      [input.organizationId, input.releaseId],
    );
    return result.rows.map(mapReport);
  }

  private async findByIdempotencyKey(organizationId: string, idempotencyKey: string) {
    const result = await this.database.query(
      `${SELECT_REPORT}
       where tenant_id = $1 and idempotency_key = $2`,
      [organizationId, idempotencyKey],
    );
    return result.rows[0] === undefined ? null : mapReport(result.rows[0]);
  }

  private async findByReportId(organizationId: string, reportId: string) {
    const result = await this.database.query(
      `${SELECT_REPORT}
       where tenant_id = $1 and id = $2`,
      [organizationId, reportId],
    );
    return result.rows[0] === undefined ? null : mapReport(result.rows[0]);
  }
}

const SELECT_REPORT = `select tenant_id, id, idempotency_key, schema_version,
  release_id, catalog_id, catalog_version, executed_at, valid_until, status,
  drill_results, alert_results
from billing_release_drill_reports`;

function mapReport(row: QueryResultRow): StoredBillingReleaseDrillReport {
  if (
    row.schema_version !== "zara.billing-drill-qualification.v1"
    || (row.status !== "passed" && row.status !== "failed")
  ) {
    throw new Error("Stored drill report has an unsupported schema version or status.");
  }
  const catalogVersion = Number(row.catalog_version);
  if (!Number.isSafeInteger(catalogVersion) || catalogVersion < 1) {
    throw new Error("Stored drill report has an invalid catalog version.");
  }
  return {
    schemaVersion: row.schema_version,
    evidenceKind: "durable",
    reportId: row.id as string,
    idempotencyKey: row.idempotency_key as string,
    organizationId: row.tenant_id as string,
    releaseId: row.release_id as string,
    catalog: { id: row.catalog_id as string, version: catalogVersion },
    executedAt: normalizeTimestamp(row.executed_at),
    validUntil: normalizeTimestamp(row.valid_until),
    status: row.status,
    chargeDeliveryEnabled: false,
    drills: row.drill_results,
    alerts: row.alert_results,
  };
}

function normalizeTimestamp(value: unknown) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function assertReplayMatch(
  existing: StoredBillingReleaseDrillReport,
  report: StoredBillingReleaseDrillReport,
) {
  if (!isDeepStrictEqual(existing, report)) {
    throw new Error("Drill report replay does not match the stored evidence.");
  }
}

function isUniqueViolation(error: unknown) {
  if (error === null || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "23505"
    || (typeof candidate.message === "string" && candidate.message.includes("duplicate key"));
}

function assertDurableReport(report: StoredBillingReleaseDrillReport) {
  if (report.evidenceKind !== "durable") {
    throw new Error(
      "Only durable operation evidence can be stored as a drill qualification report.",
    );
  }
  for (const drill of report.drills) {
    if (drill.source === null) {
      if (drill.failureCode?.startsWith("durable_") !== true) {
        throw new Error(
          "Only durable operation evidence can be stored as a drill qualification report.",
        );
      }
      continue;
    }
    if (
      drill.source.operationRecordIds.length === 0
      || !/^[a-f0-9]{64}$/.test(drill.source.evidenceHash)
      || drill.source.evidenceId.trim() === ""
      || drill.source.sourceType.trim() === ""
      || drill.source.sourceRecordId.trim() === ""
      || !Number.isFinite(Date.parse(drill.source.fetchedAt))
    ) {
      throw new Error(
        "Only durable operation evidence can be stored as a drill qualification report.",
      );
    }
  }
}
