import { describe, expect, it, vi } from "vitest";

import {
  CartesiaAdminUsageClient,
  CartesiaBillingEvidenceSource,
} from "./cartesia-billing-evidence.source";

const cycle = {
  organizationId: "tenant-a",
  catalogId: "catalog-1",
  cycleStartsAt: "2026-08-01T00:00:00.000Z",
  cycleEndsAt: "2026-09-01T00:00:00.000Z",
};

describe("CartesiaBillingEvidenceSource", () => {
  it("collects provider credits for the API key durably mapped to the tenant", async () => {
    const client = {
      getApiKey: vi.fn().mockResolvedValue({ id: "key-1" }),
      getCreditUsage: vi.fn().mockResolvedValue({
        data: [{
          start_ts: cycle.cycleStartsAt,
          end_ts: cycle.cycleEndsAt,
          credits: 840,
        }],
      }),
    };
    const source = new CartesiaBillingEvidenceSource(
      client,
      {
        readDurableTenantApiKeyScope: vi.fn().mockResolvedValue({
          apiKeyId: "key-1",
          mappingId: "tenant-provider-scope-17",
        }),
      },
      () => "2026-09-01T01:00:00.000Z",
    );

    await expect(source.collectCycle(cycle)).resolves.toEqual({
      provider: "cartesia",
      evidenceKind: "runtime_usage",
      sourceReportId: expect.stringMatching(/^cartesia_credits_[a-f0-9]{64}$/),
      payload: {
        quantities: {},
        source: {
          kind: "provider_billing_api",
          apiVersion: "2026-03-01",
          apiKeyId: "key-1",
          tenantScopeMappingId: "tenant-provider-scope-17",
        },
        facts: [{
          id: "cartesia:key-1:2026-08-01T00:00:00.000Z:2026-09-01T00:00:00.000Z",
          apiKeyId: "key-1",
          cycleStartsAt: cycle.cycleStartsAt,
          cycleEndsAt: cycle.cycleEndsAt,
          credits: 840,
        }],
      },
    });
    expect(client.getApiKey).toHaveBeenCalledWith("key-1");
    expect(client.getCreditUsage).toHaveBeenCalledWith({
      apiKeyId: "key-1",
      startTimestamp: cycle.cycleStartsAt,
      endTimestamp: cycle.cycleEndsAt,
    });
  });

  it("returns no evidence when the tenant does not use Cartesia", async () => {
    const source = new CartesiaBillingEvidenceSource(
      { getApiKey: vi.fn(), getCreditUsage: vi.fn() },
      { readDurableTenantApiKeyScope: vi.fn().mockResolvedValue(null) },
      () => "2026-09-01T01:00:00.000Z",
    );

    await expect(source.collectCycle(cycle)).resolves.toBeNull();
  });

  it("rejects an incomplete cycle and returns no evidence for a partial UTC day", async () => {
    const source = new CartesiaBillingEvidenceSource(
      { getApiKey: vi.fn(), getCreditUsage: vi.fn() },
      { readDurableTenantApiKeyScope: vi.fn() },
      () => "2026-08-31T23:59:59.999Z",
    );

    await expect(source.collectCycle(cycle)).rejects.toThrow(
      "Cartesia billing evidence requires a completed cycle.",
    );
    await expect(source.collectCycle({
      ...cycle,
      cycleStartsAt: "2026-08-01T00:00:01.000Z",
    })).resolves.toBeNull();
  });

  it("rejects a mapped key that the Cartesia organization does not own", async () => {
    const source = new CartesiaBillingEvidenceSource(
      {
        getApiKey: vi.fn().mockResolvedValue({ id: "different-key" }),
        getCreditUsage: vi.fn(),
      },
      {
        readDurableTenantApiKeyScope: vi.fn().mockResolvedValue({
          apiKeyId: "key-1",
          mappingId: "mapping-1",
        }),
      },
      () => "2026-09-01T01:00:00.000Z",
    );

    await expect(source.collectCycle(cycle)).rejects.toThrow(
      "Cartesia billing evidence API key scope could not be proved.",
    );
  });

  it("rejects provider usage that does not exactly match the requested cycle", async () => {
    const source = new CartesiaBillingEvidenceSource(
      {
        getApiKey: vi.fn().mockResolvedValue({ id: "key-1" }),
        getCreditUsage: vi.fn().mockResolvedValue({
          data: [{
            start_ts: cycle.cycleStartsAt,
            end_ts: "2026-09-02T00:00:00.000Z",
            credits: 840,
          }],
        }),
      },
      {
        readDurableTenantApiKeyScope: vi.fn().mockResolvedValue({
          apiKeyId: "key-1",
          mappingId: "mapping-1",
        }),
      },
      () => "2026-09-01T01:00:00.000Z",
    );

    await expect(source.collectCycle(cycle)).rejects.toThrow(
      "Cartesia billing evidence does not exactly match the requested cycle.",
    );
  });
});

describe("CartesiaAdminUsageClient", () => {
  it("uses the official admin Usage API and API version", async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ id: "key-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [] }),
      });
    const client = new CartesiaAdminUsageClient({
      adminApiKey: "sk_car_admin_test",
      fetchImplementation,
    });

    await client.getApiKey("key-1");
    await client.getCreditUsage({
      apiKeyId: "key-1",
      startTimestamp: cycle.cycleStartsAt,
      endTimestamp: cycle.cycleEndsAt,
    });

    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      "https://api.cartesia.ai/api-keys/key-1",
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: "Bearer sk_car_admin_test",
          "cartesia-version": "2026-03-01",
        },
      },
    );
    const usageUrl = new URL(fetchImplementation.mock.calls[1]![0]);
    expect(`${usageUrl.origin}${usageUrl.pathname}`).toBe("https://api.cartesia.ai/usage/credits");
    expect(usageUrl.searchParams.get("api_key_id")).toBe("key-1");
    expect(usageUrl.searchParams.get("start_ts")).toBe(cycle.cycleStartsAt);
    expect(usageUrl.searchParams.get("end_ts")).toBe(cycle.cycleEndsAt);
    expect(fetchImplementation.mock.calls[1]![1].headers).toEqual({
      accept: "application/json",
      authorization: "Bearer sk_car_admin_test",
      "cartesia-version": "2026-03-01",
    });
  });
});
