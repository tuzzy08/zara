import { createHash } from "node:crypto";

import type {
  BillingProviderEvidenceReport,
  BillingProviderEvidenceSource,
} from "./billing-production-reconciliation-evidence";
import type { BillingCycleEvidenceInput } from "./billing-usage-reconciliation.service";

export interface GeminiCloudBillingProjectMapping {
  id: string;
  organizationId: string;
  gcpProjectId: string;
  billingAccountId: string;
  normalizedBillingView: string;
  serviceIds: string[];
  skuIds: string[];
  exportEnabledAt: string;
}

export interface GeminiCloudBillingProjectMappingReader {
  readActiveMapping(input: BillingCycleEvidenceInput): Promise<GeminiCloudBillingProjectMapping | null>;
}

export interface GeminiCloudBillingRow {
  billingAccountId: string;
  projectId: string;
  serviceId: string;
  skuId: string;
  usageStartTime: string;
  usageEndTime: string;
  exportTime: string;
  costMicros: number;
  currency: string;
  usageAmount: string;
  usageUnit: string;
  allocationStatus?: "contained" | "boundary_overlap";
}

export interface GeminiCloudBillingQueryResult {
  queryJobId: string;
  complete: boolean;
  queriedAt: string;
  latestExportTime: string;
  rows: GeminiCloudBillingRow[];
}

export interface GeminiCloudBillingQueryClient {
  queryCycle(input: {
    normalizedBillingView: string;
    billingAccountId: string;
    projectId: string;
    serviceIds: string[];
    skuIds: string[];
    cycleStartsAt: string;
    cycleEndsAt: string;
  }): Promise<GeminiCloudBillingQueryResult>;
}

export class GeminiCloudBillingEvidenceSource implements BillingProviderEvidenceSource {
  constructor(
    private readonly mappings: GeminiCloudBillingProjectMappingReader,
    private readonly bigQuery: GeminiCloudBillingQueryClient,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async collectCycle(input: BillingCycleEvidenceInput): Promise<BillingProviderEvidenceReport | null> {
    const collectedAt = validTimestamp(this.now(), "collection time");
    const cycleStartsAt = validTimestamp(input.cycleStartsAt, "cycle start");
    const cycleEndsAt = validTimestamp(input.cycleEndsAt, "cycle end");
    if (cycleEndsAt <= cycleStartsAt) throw new Error("Gemini billing cycle is invalid.");
    if (cycleEndsAt > collectedAt) throw new Error("Gemini billing cycle is not complete.");

    const mapping = await this.mappings.readActiveMapping(input);
    if (mapping === null) return null;
    validateMapping(mapping, input, cycleStartsAt);

    const result = await this.bigQuery.queryCycle({
      normalizedBillingView: mapping.normalizedBillingView,
      billingAccountId: mapping.billingAccountId,
      projectId: mapping.gcpProjectId,
      serviceIds: [...mapping.serviceIds],
      skuIds: [...mapping.skuIds],
      cycleStartsAt: input.cycleStartsAt,
      cycleEndsAt: input.cycleEndsAt,
    });
    validateResult(result, mapping, cycleStartsAt, cycleEndsAt, collectedAt);

    if (result.rows.length === 0) return null;
    const facts = result.rows.map((row) => ({ id: hash(row), ...row }));
    if (new Set(facts.map((fact) => fact.id)).size !== facts.length) {
      throw new Error("Gemini billing export contains duplicate facts.");
    }
    const sourceReportId = hash({
      input,
      mappingId: mapping.id,
      latestExportTime: result.latestExportTime,
      facts,
    });

    return {
      provider: "gemini",
      evidenceKind: "runtime_usage",
      sourceReportId,
      payload: {
        quantities: {},
        source: {
          kind: "cloud_billing_bigquery_export",
          mappingId: mapping.id,
          normalizedBillingView: mapping.normalizedBillingView,
          queryJobId: result.queryJobId,
          queriedAt: result.queriedAt,
          latestExportTime: result.latestExportTime,
        },
        facts,
      },
    };
  }
}

function validateMapping(
  mapping: GeminiCloudBillingProjectMapping,
  input: BillingCycleEvidenceInput,
  cycleStartsAt: number,
) {
  if (required(mapping.id) === "") throw new Error("Gemini billing mapping ID is invalid.");
  if (mapping.organizationId !== input.organizationId) {
    throw new Error("Gemini billing project mapping has the wrong tenant.");
  }
  if (required(mapping.gcpProjectId) === "" || required(mapping.billingAccountId) === "") {
    throw new Error("Gemini billing project mapping is invalid.");
  }
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]\.[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(
    mapping.normalizedBillingView,
  )) {
    throw new Error("Gemini normalized billing view is invalid.");
  }
  if (!validAllowlist(mapping.serviceIds)) {
    throw new Error("Gemini billing service allowlist is invalid.");
  }
  if (!validAllowlist(mapping.skuIds)) {
    throw new Error("Gemini billing SKU allowlist is invalid.");
  }
  if (validTimestamp(mapping.exportEnabledAt, "export coverage start") > cycleStartsAt) {
    throw new Error("Gemini billing export coverage does not include the full cycle.");
  }
}

function validateResult(
  result: GeminiCloudBillingQueryResult,
  mapping: GeminiCloudBillingProjectMapping,
  cycleStartsAt: number,
  cycleEndsAt: number,
  collectedAt: number,
) {
  if (!result.complete) throw new Error("Gemini billing BigQuery query is incomplete.");
  if (required(result.queryJobId) === "") throw new Error("Gemini billing query job ID is invalid.");
  const queriedAt = validTimestamp(result.queriedAt, "query time");
  const latestExportTime = validTimestamp(result.latestExportTime, "latest export time");
  if (latestExportTime < cycleEndsAt) throw new Error("Gemini billing export is not fresh for the cycle.");
  if (latestExportTime > collectedAt || queriedAt > collectedAt || latestExportTime > queriedAt) {
    throw new Error("Gemini billing export contains a future timestamp.");
  }
  for (const row of result.rows) {
    if (row.billingAccountId !== mapping.billingAccountId) {
      throw new Error("Gemini billing export row has the wrong billing account.");
    }
    if (row.projectId !== mapping.gcpProjectId) {
      throw new Error("Gemini billing export row has the wrong project.");
    }
    if (!mapping.serviceIds.includes(row.serviceId)) {
      throw new Error("Gemini billing export row has an unsupported service.");
    }
    if (!mapping.skuIds.includes(row.skuId)) {
      throw new Error("Gemini billing export row has an unsupported SKU.");
    }
    const usageStartTime = validTimestamp(row.usageStartTime, "usage start");
    const usageEndTime = validTimestamp(row.usageEndTime, "usage end");
    const exportTime = validTimestamp(row.exportTime, "row export time");
    if (usageStartTime >= cycleEndsAt || usageEndTime <= cycleStartsAt || usageEndTime <= usageStartTime) {
      throw new Error("Gemini billing export row is outside the requested cycle.");
    }
    if (exportTime > latestExportTime) throw new Error("Gemini billing export row has a future timestamp.");
    if (!Number.isSafeInteger(row.costMicros)) {
      throw new Error("Gemini billing export row cost is invalid.");
    }
    if (required(row.currency) === "" || required(row.usageAmount) === "" || required(row.usageUnit) === "") {
      throw new Error("Gemini billing export row usage is invalid.");
    }
  }
}

function validAllowlist(values: string[]) {
  return values.length > 0
    && values.every((value) => required(value) !== "")
    && new Set(values).size === values.length;
}

function required(value: string) {
  return value.trim();
}

function validTimestamp(value: string, field: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Gemini billing ${field} is invalid.`);
  return parsed;
}

function hash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
