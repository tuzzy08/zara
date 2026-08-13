import { describe, expect, it, vi } from "vitest";

import { OpenAiDirectBillingEvidenceSource } from "./openai-billing-evidence.source";

const cycle = {
  organizationId: "tenant-a",
  catalogId: "catalog-a",
  cycleStartsAt: "2026-08-01T00:00:00.000Z",
  cycleEndsAt: "2026-09-01T00:00:00.000Z",
};

describe("OpenAI direct billing evidence source", () => {
  it("returns no evidence when the tenant does not use OpenAI", async () => {
    const source = new OpenAiDirectBillingEvidenceSource(
      { getProjectId: vi.fn(async () => null) },
      { getProjectCycleEvidence: vi.fn() },
      () => "2026-09-02T00:00:00.000Z",
    );

    await expect(source.collectCycle(cycle)).resolves.toBeNull();
  });

  it("keeps direct provider usage and cost facts without inventing runtime seconds", async () => {
    const source = new OpenAiDirectBillingEvidenceSource(
      { getProjectId: vi.fn(async () => "proj_tenant_a") },
      { getProjectCycleEvidence: vi.fn(async () => ({
        usage: [{
          bucketStartsAt: "2026-08-01T00:00:00.000Z",
          bucketEndsAt: "2026-08-02T00:00:00.000Z",
          projectId: "proj_tenant_a",
          model: "gpt-realtime",
          serviceTier: "default",
          inputTokens: 10,
          outputTokens: 4,
          inputCachedTokens: 2,
          inputAudioTokens: 8,
          outputAudioTokens: 6,
          requestCount: 1,
        }],
        costs: [{
          bucketStartsAt: "2026-08-01T00:00:00.000Z",
          bucketEndsAt: "2026-08-02T00:00:00.000Z",
          projectId: "proj_tenant_a",
          lineItem: "Realtime models",
          amount: 0.06,
          currency: "usd",
        }],
      })) },
      () => "2026-09-02T00:00:00.000Z",
    );

    const report = await source.collectCycle(cycle);

    expect(report).toMatchObject({
      provider: "openai",
      evidenceKind: "runtime_usage",
      sourceReportId: expect.stringMatching(/^openai-organization:[a-f0-9]{64}$/),
      payload: {
        quantities: {},
        projectId: "proj_tenant_a",
        source: {
          kind: "organization_usage_and_costs",
          generatedAt: "2026-09-02T00:00:00.000Z",
        },
        facts: [
          expect.objectContaining({ id: expect.stringMatching(/^openai-usage:/), kind: "usage" }),
          expect.objectContaining({ id: expect.stringMatching(/^openai-cost:/), kind: "cost" }),
        ],
      },
    });
  });

  it("rejects a cycle that is not complete", async () => {
    const source = new OpenAiDirectBillingEvidenceSource(
      { getProjectId: vi.fn(async () => "proj_tenant_a") },
      { getProjectCycleEvidence: vi.fn() },
      () => "2026-08-31T23:59:59.999Z",
    );

    await expect(source.collectCycle(cycle)).rejects.toThrow(
      "OpenAI billing evidence cycle is not complete.",
    );
  });
});
