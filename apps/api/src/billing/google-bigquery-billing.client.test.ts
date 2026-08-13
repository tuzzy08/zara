import { describe, expect, it, vi } from "vitest";

import {
  GoogleCloudBigQueryExecutor,
  GoogleBigQueryBillingClient,
  type GoogleBigQueryExecutor,
} from "./google-bigquery-billing.client";

const input = {
  normalizedBillingView: "finops-prod.zara_billing.normalized_usage",
  billingAccountId: "ABCDEF-123456-ABCDEF",
  projectId: "tenant-a-runtime",
  serviceIds: ["service-gemini"],
  skuIds: ["sku-audio-in", "sku-audio-out"],
  cycleStartsAt: "2026-07-01T00:00:00.000Z",
  cycleEndsAt: "2026-08-01T00:00:00.000Z",
};

describe("GoogleBigQueryBillingClient", () => {
  it("runs the query with authenticated BigQuery application credentials", async () => {
    const getQueryResults = vi.fn().mockResolvedValue([[{ value: 1 }]]);
    const createQueryJob = vi.fn().mockResolvedValue([{ id: "job-1", getQueryResults }]);
    const executor = new GoogleCloudBigQueryExecutor(
      { createQueryJob } as never,
      () => "2026-08-03T12:00:00.000Z",
    );

    await expect(executor.query({
      query: "select @projectId",
      parameters: {
        ...input,
      },
    })).resolves.toEqual({
      jobId: "job-1",
      complete: true,
      completedAt: "2026-08-03T12:00:00.000Z",
      rows: [{ value: 1 }],
    });
    expect(createQueryJob).toHaveBeenCalledWith(expect.objectContaining({
      query: "select @projectId",
      params: expect.objectContaining({ projectId: input.projectId }),
      useLegacySql: false,
    }));
  });

  it("queries the normalized billing view with exact scope parameters", async () => {
    const executor: GoogleBigQueryExecutor = {
      query: vi.fn().mockResolvedValue({
        jobId: "job-1",
        complete: true,
        completedAt: "2026-08-03T12:00:00.000Z",
        rows: [{
          latest_export_time: "2026-08-03T11:30:00.000Z",
          billing_account_id: input.billingAccountId,
          project_id: input.projectId,
          service_id: input.serviceIds[0],
          sku_id: input.skuIds[0],
          usage_start_time: "2026-07-10T10:00:00.000Z",
          usage_end_time: "2026-07-10T11:00:00.000Z",
          export_time: "2026-07-11T02:00:00.000Z",
          cost_micros: "125000",
          currency: "USD",
          usage_amount: "3000",
          usage_unit: "tokens",
        }],
      }),
    };

    const result = await new GoogleBigQueryBillingClient(executor).queryCycle(input);

    expect(executor.query).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.stringContaining("`finops-prod.zara_billing.normalized_usage`"),
      parameters: {
        billingAccountId: input.billingAccountId,
        projectId: input.projectId,
        serviceIds: input.serviceIds,
        skuIds: input.skuIds,
        cycleStartsAt: input.cycleStartsAt,
        cycleEndsAt: input.cycleEndsAt,
      },
    }));
    const query = vi.mocked(executor.query).mock.calls[0]![0].query;
    expect(query).toContain("project.id = @projectId");
    expect(query).toContain("service.id IN UNNEST(@serviceIds)");
    expect(query).toContain("sku.id IN UNNEST(@skuIds)");
    expect(query).toContain("usage_start_time < TIMESTAMP(@cycleEndsAt)");
    expect(query).toContain("usage_end_time > TIMESTAMP(@cycleStartsAt)");
    expect(result).toEqual({
      queryJobId: "job-1",
      complete: true,
      queriedAt: "2026-08-03T12:00:00.000Z",
      latestExportTime: "2026-08-03T11:30:00.000Z",
      rows: [{
        billingAccountId: input.billingAccountId,
        projectId: input.projectId,
        serviceId: input.serviceIds[0],
        skuId: input.skuIds[0],
        usageStartTime: "2026-07-10T10:00:00.000Z",
        usageEndTime: "2026-07-10T11:00:00.000Z",
        exportTime: "2026-07-11T02:00:00.000Z",
        costMicros: 125000,
        currency: "USD",
        usageAmount: "3000",
        usageUnit: "tokens",
        allocationStatus: "contained",
      }],
    });
  });

  it("normalizes timestamp values returned by the BigQuery SDK", async () => {
    const executor: GoogleBigQueryExecutor = {
      query: vi.fn().mockResolvedValue({
        jobId: "job-sdk-time",
        complete: true,
        completedAt: "2026-08-03T12:00:00.000Z",
        rows: [{
          latest_export_time: { value: "2026-08-03T11:30:00.000Z" },
          billing_account_id: input.billingAccountId,
          project_id: input.projectId,
          service_id: input.serviceIds[0],
          sku_id: input.skuIds[0],
          usage_start_time: { value: "2026-07-10T10:00:00.000Z" },
          usage_end_time: { value: "2026-07-10T11:00:00.000Z" },
          export_time: { value: "2026-07-11T02:00:00.000Z" },
          cost_micros: 1,
          currency: "USD",
          usage_amount: "1",
          usage_unit: "token",
        }],
      }),
    };

    const result = await new GoogleBigQueryBillingClient(executor).queryCycle(input);

    expect(result.latestExportTime).toBe("2026-08-03T11:30:00.000Z");
    expect(result.rows[0]?.usageStartTime).toBe("2026-07-10T10:00:00.000Z");
  });

  it("returns zero facts when the watermark row has no scoped usage", async () => {
    const executor: GoogleBigQueryExecutor = {
      query: vi.fn().mockResolvedValue({
        jobId: "job-zero",
        complete: true,
        completedAt: "2026-08-03T12:00:00.000Z",
        rows: [{
          latest_export_time: "2026-08-03T11:30:00.000Z",
          billing_account_id: null,
        }],
      }),
    };

    await expect(new GoogleBigQueryBillingClient(executor).queryCycle(input))
      .resolves.toMatchObject({ rows: [], latestExportTime: "2026-08-03T11:30:00.000Z" });
  });

  it("rejects an unsafe view identifier before it runs a query", async () => {
    const executor: GoogleBigQueryExecutor = { query: vi.fn() };

    await expect(new GoogleBigQueryBillingClient(executor).queryCycle({
      ...input,
      normalizedBillingView: "view`; DELETE FROM billing; --",
    })).rejects.toThrow("normalized billing view");
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("rejects a result without an export watermark", async () => {
    const executor: GoogleBigQueryExecutor = {
      query: vi.fn().mockResolvedValue({
        jobId: "job-missing-watermark",
        complete: true,
        completedAt: "2026-08-03T12:00:00.000Z",
        rows: [{ latest_export_time: null, billing_account_id: null }],
      }),
    };

    await expect(new GoogleBigQueryBillingClient(executor).queryCycle(input))
      .rejects.toThrow("export watermark");
  });
});
