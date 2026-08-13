import { BigQuery } from "@google-cloud/bigquery";

import type {
  GeminiCloudBillingQueryClient,
  GeminiCloudBillingQueryResult,
  GeminiCloudBillingRow,
} from "./gemini-cloud-billing-evidence.source";

export interface GoogleBigQueryExecutor {
  query(input: {
    query: string;
    parameters: {
      billingAccountId: string;
      projectId: string;
      serviceIds: string[];
      skuIds: string[];
      cycleStartsAt: string;
      cycleEndsAt: string;
    };
  }): Promise<{
    jobId: string;
    complete: boolean;
    completedAt: string;
    rows: Array<Record<string, unknown>>;
  }>;
}

type BigQueryClient = Pick<BigQuery, "createQueryJob">;

export class GoogleCloudBigQueryExecutor implements GoogleBigQueryExecutor {
  constructor(
    private readonly client: BigQueryClient = new BigQuery(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async query(input: Parameters<GoogleBigQueryExecutor["query"]>[0]) {
    const [job] = await this.client.createQueryJob({
      query: input.query,
      params: input.parameters,
      useLegacySql: false,
    });
    const [rows] = await job.getQueryResults();
    return {
      jobId: requiredText(job.id, "BigQuery job ID"),
      complete: true,
      completedAt: requiredText(this.now(), "BigQuery completion time"),
      rows: rows as Array<Record<string, unknown>>,
    };
  }
}

export class GoogleBigQueryBillingClient implements GeminiCloudBillingQueryClient {
  constructor(private readonly executor: GoogleBigQueryExecutor) {}

  async queryCycle(input: Parameters<GeminiCloudBillingQueryClient["queryCycle"]>[0])
  : Promise<GeminiCloudBillingQueryResult> {
    if (!validView(input.normalizedBillingView)) {
      throw new Error("Gemini normalized billing view is invalid.");
    }
    const result = await this.executor.query({
      query: cycleQuery(input.normalizedBillingView),
      parameters: {
        billingAccountId: input.billingAccountId,
        projectId: input.projectId,
        serviceIds: [...input.serviceIds],
        skuIds: [...input.skuIds],
        cycleStartsAt: input.cycleStartsAt,
        cycleEndsAt: input.cycleEndsAt,
      },
    });
    const watermarkValues = result.rows.map((row) => textValue(row.latest_export_time))
      .filter((value): value is string => value !== null);
    if (watermarkValues.length === 0 || new Set(watermarkValues).size !== 1) {
      throw new Error("Gemini Cloud Billing export watermark is unavailable or inconsistent.");
    }
    const rows = result.rows
      .filter((row) => row.billing_account_id !== null && row.billing_account_id !== undefined)
      .map((row) => {
        const parsed = parseBillingRow(row);
        return {
          ...parsed,
          allocationStatus: Date.parse(parsed.usageStartTime) < Date.parse(input.cycleStartsAt)
            || Date.parse(parsed.usageEndTime) > Date.parse(input.cycleEndsAt)
            ? "boundary_overlap" as const
            : "contained" as const,
        };
      });
    return {
      queryJobId: requiredText(result.jobId, "BigQuery job ID"),
      complete: result.complete,
      queriedAt: requiredText(result.completedAt, "BigQuery completion time"),
      latestExportTime: watermarkValues[0]!,
      rows,
    };
  }
}

function cycleQuery(view: string) {
  return `WITH export_watermark AS (
  SELECT MAX(export_time) AS latest_export_time
  FROM \`${view}\`
  WHERE billing_account_id = @billingAccountId
), scoped_usage AS (
  SELECT
    billing_account_id,
    project.id AS project_id,
    service.id AS service_id,
    sku.id AS sku_id,
    usage_start_time,
    usage_end_time,
    export_time,
    CAST(ROUND((cost + IFNULL((
      SELECT SUM(credit.amount) FROM UNNEST(credits) AS credit
    ), 0)) * 1000000) AS INT64) AS cost_micros,
    currency,
    CAST(usage.amount AS STRING) AS usage_amount,
    usage.unit AS usage_unit
  FROM \`${view}\`
  WHERE billing_account_id = @billingAccountId
    AND project.id = @projectId
    AND service.id IN UNNEST(@serviceIds)
    AND sku.id IN UNNEST(@skuIds)
    AND usage_start_time < TIMESTAMP(@cycleEndsAt)
    AND usage_end_time > TIMESTAMP(@cycleStartsAt)
)
SELECT
  export_watermark.latest_export_time,
  scoped_usage.*
FROM export_watermark
LEFT JOIN scoped_usage ON TRUE
ORDER BY usage_start_time, usage_end_time, service_id, sku_id, export_time`;
}

function parseBillingRow(row: Record<string, unknown>): GeminiCloudBillingRow {
  const rawCost = typeof row.cost_micros === "number"
    ? row.cost_micros
    : Number(requiredText(row.cost_micros, "cost micros"));
  if (!Number.isSafeInteger(rawCost)) throw new Error("Gemini BigQuery cost micros is invalid.");
  return {
    billingAccountId: requiredText(row.billing_account_id, "billing account ID"),
    projectId: requiredText(row.project_id, "project ID"),
    serviceId: requiredText(row.service_id, "service ID"),
    skuId: requiredText(row.sku_id, "SKU ID"),
    usageStartTime: requiredText(row.usage_start_time, "usage start time"),
    usageEndTime: requiredText(row.usage_end_time, "usage end time"),
    exportTime: requiredText(row.export_time, "export time"),
    costMicros: rawCost,
    currency: requiredText(row.currency, "currency"),
    usageAmount: requiredText(row.usage_amount, "usage amount"),
    usageUnit: requiredText(row.usage_unit, "usage unit"),
  };
}

function validView(value: string) {
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]\.[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function textValue(value: unknown) {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const nested = (value as { value?: unknown }).value;
    if (typeof nested === "string" && nested.trim() !== "") return nested;
  }
  return null;
}

function requiredText(value: unknown, field: string) {
  const text = textValue(value);
  if (text === null) throw new Error(`Gemini ${field} is invalid.`);
  return text;
}
