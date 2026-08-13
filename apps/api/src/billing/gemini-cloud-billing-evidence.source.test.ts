import { describe, expect, it, vi } from "vitest";

import {
  GeminiCloudBillingEvidenceSource,
  type GeminiCloudBillingProjectMappingReader,
  type GeminiCloudBillingQueryClient,
} from "./gemini-cloud-billing-evidence.source";

const cycle = {
  organizationId: "tenant-a",
  catalogId: "catalog-2026",
  cycleStartsAt: "2026-07-01T00:00:00.000Z",
  cycleEndsAt: "2026-08-01T00:00:00.000Z",
};

const mapping = {
  id: "gemini-map-a",
  organizationId: "tenant-a",
  gcpProjectId: "tenant-a-runtime",
  billingAccountId: "ABCDEF-123456-ABCDEF",
  normalizedBillingView: "finops-prod.zara_billing.normalized_usage",
  serviceIds: ["6F81-5844-456A"],
  skuIds: ["sku-gemini-live-audio-in", "sku-gemini-live-audio-out"],
  exportEnabledAt: "2026-06-01T00:00:00.000Z",
};

const queryResult = {
  queryJobId: "bq-job-123",
  complete: true,
  queriedAt: "2026-08-03T12:00:00.000Z",
  latestExportTime: "2026-08-03T11:30:00.000Z",
  rows: [{
    billingAccountId: mapping.billingAccountId,
    projectId: mapping.gcpProjectId,
    serviceId: mapping.serviceIds[0]!,
    skuId: mapping.skuIds[0]!,
    usageStartTime: "2026-07-10T10:00:00.000Z",
    usageEndTime: "2026-07-10T11:00:00.000Z",
    exportTime: "2026-07-11T02:00:00.000Z",
    costMicros: 125000,
    currency: "USD",
    usageAmount: "3000",
    usageUnit: "tokens",
  }],
};

function source(overrides?: {
  mapping?: Partial<typeof mapping> | null;
  result?: Partial<typeof queryResult>;
}) {
  const reader: GeminiCloudBillingProjectMappingReader = {
    readActiveMapping: vi.fn().mockResolvedValue(
      overrides?.mapping === null ? null : { ...mapping, ...overrides?.mapping },
    ),
  };
  const client: GeminiCloudBillingQueryClient = {
    queryCycle: vi.fn().mockResolvedValue({ ...queryResult, ...overrides?.result }),
  };
  return {
    reader,
    client,
    source: new GeminiCloudBillingEvidenceSource(
      reader,
      client,
      () => "2026-08-03T12:05:00.000Z",
    ),
  };
}

describe("GeminiCloudBillingEvidenceSource", () => {
  it("collects direct Google Cloud Billing facts for the exact tenant project and cycle", async () => {
    const test = source();

    const report = await test.source.collectCycle(cycle);
    expect(report).not.toBeNull();
    if (report === null) throw new Error("Expected Gemini evidence.");

    expect(test.reader.readActiveMapping).toHaveBeenCalledWith(cycle);
    expect(test.client.queryCycle).toHaveBeenCalledWith({
      normalizedBillingView: mapping.normalizedBillingView,
      billingAccountId: mapping.billingAccountId,
      projectId: mapping.gcpProjectId,
      serviceIds: mapping.serviceIds,
      skuIds: mapping.skuIds,
      cycleStartsAt: cycle.cycleStartsAt,
      cycleEndsAt: cycle.cycleEndsAt,
    });
    expect(report).toMatchObject({
      provider: "gemini",
      evidenceKind: "runtime_usage",
      payload: {
        quantities: {},
        source: {
          kind: "cloud_billing_bigquery_export",
          mappingId: mapping.id,
          queryJobId: "bq-job-123",
          latestExportTime: queryResult.latestExportTime,
        },
        facts: [{
          billingAccountId: mapping.billingAccountId,
          projectId: mapping.gcpProjectId,
          serviceId: mapping.serviceIds[0],
          skuId: mapping.skuIds[0],
          costMicros: 125000,
          usageAmount: "3000",
          usageUnit: "tokens",
        }],
      },
    });
    const facts = report.payload.facts as Array<{ id: string }>;
    expect(facts[0]?.id).toMatch(/^[a-f0-9]{64}$/);
    expect(report.sourceReportId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns no evidence when the tenant does not use Gemini", async () => {
    await expect(source({ mapping: null }).source.collectCycle(cycle))
      .resolves.toBeNull();
  });

  it.each([
    ["wrong tenant", { organizationId: "tenant-b" }, "tenant"],
    ["blank view", { normalizedBillingView: "" }, "normalized billing view"],
    ["missing service allowlist", { serviceIds: [] }, "service allowlist"],
    ["missing SKU allowlist", { skuIds: [] }, "SKU allowlist"],
    ["export started after cycle", { exportEnabledAt: "2026-07-02T00:00:00.000Z" }, "coverage"],
  ])("rejects an invalid mapping: %s", async (_label, change, message) => {
    await expect(source({ mapping: change }).source.collectCycle(cycle))
      .rejects.toThrow(message);
  });

  it("rejects a cycle that is not complete", async () => {
    const test = source();
    const unfinished = { ...cycle, cycleEndsAt: "2026-08-04T00:00:00.000Z" };

    await expect(test.source.collectCycle(unfinished))
      .rejects.toThrow("Gemini billing cycle is not complete");
    expect(test.client.queryCycle).not.toHaveBeenCalled();
  });

  it.each([
    ["unfinished query", { complete: false }, "query is incomplete"],
    ["stale export", { latestExportTime: "2026-07-31T23:59:59.999Z" }, "export is not fresh"],
    ["future export", { latestExportTime: "2026-08-03T12:06:00.000Z" }, "future"],
  ])("rejects incomplete export evidence: %s", async (_label, change, message) => {
    await expect(source({ result: change }).source.collectCycle(cycle))
      .rejects.toThrow(message);
  });

  it.each([
    ["other billing account", { billingAccountId: "OTHER" }, "billing account"],
    ["other project", { projectId: "tenant-b-runtime" }, "project"],
    ["other service", { serviceId: "other-service" }, "service"],
    ["other SKU", { skuId: "other-sku" }, "SKU"],
    ["before cycle", { usageStartTime: "2026-06-30T23:00:00.000Z", usageEndTime: "2026-07-01T00:00:00.000Z" }, "cycle"],
    ["after cycle", { usageStartTime: "2026-08-01T00:00:00.000Z", usageEndTime: "2026-08-01T00:00:00.001Z" }, "cycle"],
  ])("rejects a cross-scope export row: %s", async (_label, rowChange, message) => {
    await expect(source({
      result: { rows: [{ ...queryResult.rows[0]!, ...rowChange }] },
    }).source.collectCycle(cycle)).rejects.toThrow(message);
  });

  it("returns no evidence when the export contains no scoped usage row", async () => {
    const report = await source({ result: { rows: [] } }).source.collectCycle(cycle);
    expect(report).toBeNull();
  });
});
