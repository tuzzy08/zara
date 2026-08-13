import { describe, expect, it, vi } from "vitest";

import {
  BillingProviderEvidenceCollector,
  PolarBillingReconciliationReader,
  PostgresProviderEvidenceRepository,
  reconcileProviderNativeReport,
} from "./billing-production-reconciliation-evidence";

const cycle = {
  organizationId: "tenant-a",
  catalogId: "catalog-1",
  cycleStartsAt: "2026-08-01T00:00:00.000Z",
  cycleEndsAt: "2026-09-01T00:00:00.000Z",
};

describe("PostgresProviderEvidenceRepository", () => {
  it("reads tenant-cycle usage only from immutable provider reports", async () => {
    const database = {
      query: vi.fn().mockResolvedValue({ rows: [{
        id: "evidence-runtime",
        provider: "assemblyai",
        evidence_kind: "runtime_usage",
        source_report_id: "assembly-cycle-1",
        source_hash: "7f4012ed889d1bc1fb9f6de3bf6b74e8da82a433844aecb974f121c75a0e252e",
        cycle_starts_at: cycle.cycleStartsAt,
        cycle_ends_at: cycle.cycleEndsAt,
        fetched_at: "2026-09-01T02:00:00.000Z",
        payload: {
          quantities: { standard_runtime_seconds: 60 },
          facts: [{ id: "session-1", durationSeconds: 60 }],
        },
      }, {
        id: "evidence-telephony",
        provider: "twilio",
        evidence_kind: "telephony_usage",
        source_report_id: "twilio-cycle-1",
        source_hash: "4916d34c0c69eb1511dcd563455377ab27e99a4b099d2c6bd7e427eb727f4b9d",
        cycle_starts_at: cycle.cycleStartsAt,
        cycle_ends_at: cycle.cycleEndsAt,
        fetched_at: "2026-09-01T02:00:00.000Z",
        payload: {
          quantities: { platform_telephony_charge_minor: 55 },
          facts: [{ id: "CA1", durationSeconds: 55 }],
        },
      }] }),
    };
    const reader = new PostgresProviderEvidenceRepository(database);

    await expect(reader.readProviderUsage(cycle)).resolves.toEqual({
      evidenceId: expect.stringMatching(/^provider_usage_/),
      sourceId: "provider-reports:assemblyai/assembly-cycle-1,twilio/twilio-cycle-1",
      fetchedAt: "2026-09-01T02:00:00.000Z",
      organizationId: "tenant-a",
      catalogId: "catalog-1",
      cycleStartsAt: cycle.cycleStartsAt,
      cycleEndsAt: cycle.cycleEndsAt,
      quantities: {
        standard_runtime_seconds: 60,
        platform_telephony_charge_minor: 55,
      },
    });
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("billing_provider_evidence_reports"),
      ["tenant-a", "catalog-1", cycle.cycleStartsAt, cycle.cycleEndsAt],
    );
  });

  it("returns missing when Zara has no independent provider report", async () => {
    const database = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const reader = new PostgresProviderEvidenceRepository(database);

    await expect(reader.readProviderUsage(cycle)).resolves.toBeNull();
    expect(database.query).toHaveBeenCalledWith(
      expect.not.stringContaining("billing_terminal_recovery_jobs"),
      ["tenant-a", "catalog-1", cycle.cycleStartsAt, cycle.cycleEndsAt],
    );
  });

  it("keeps the provider collection time instead of refreshing evidence during a read", async () => {
    const database = { query: vi.fn().mockResolvedValue({ rows: [{
      id: "evidence-1",
      provider: "twilio",
      evidence_kind: "telephony_usage",
      source_report_id: "twilio-cycle-1",
      source_hash: "4916d34c0c69eb1511dcd563455377ab27e99a4b099d2c6bd7e427eb727f4b9d",
      cycle_starts_at: cycle.cycleStartsAt,
      cycle_ends_at: cycle.cycleEndsAt,
      fetched_at: "2026-08-31T23:59:59.000Z",
      payload: {
        quantities: { platform_telephony_charge_minor: 55 },
        facts: [{ id: "CA1", durationSeconds: 55 }],
      },
    }] }) };
    const reader = new PostgresProviderEvidenceRepository(database);

    await expect(reader.readProviderUsage(cycle)).resolves.toMatchObject({
      fetchedAt: "2026-08-31T23:59:59.000Z",
    });
  });

  it("collects authenticated source reports into the append-only evidence store", async () => {
    const repository = { appendProviderReport: vi.fn().mockResolvedValue(undefined) };
    const source = {
      collectCycle: vi.fn().mockResolvedValue({
        provider: "twilio",
        evidenceKind: "telephony_usage",
        sourceReportId: "twilio-cycle-1",
        payload: { quantities: { platform_telephony_charge_minor: 55 } },
      }),
    };
    const collector = new BillingProviderEvidenceCollector(
      repository,
      [source],
      () => "2026-09-01T02:00:00.000Z",
    );

    await expect(collector.collectTenantCycle(cycle)).resolves.toEqual({ imported: 1 });
    expect(repository.appendProviderReport).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "tenant-a",
      provider: "twilio",
      sourceReportId: "twilio-cycle-1",
      sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      fetchedAt: "2026-09-01T02:00:00.000Z",
    }));
  });

  it("continues with later providers when one provider fails", async () => {
    const repository = { appendProviderReport: vi.fn().mockResolvedValue(undefined) };
    const collector = new BillingProviderEvidenceCollector(repository, [{
      collectCycle: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    }, {
      collectCycle: vi.fn().mockResolvedValue({
        provider: "twilio",
        evidenceKind: "telephony_usage",
        sourceReportId: "twilio-cycle-1",
        payload: { quantities: { platform_telephony_charge_minor: 55 } },
      }),
    }], () => "2026-09-01T02:00:00.000Z");

    await expect(collector.collectTenantCycle(cycle)).resolves.toEqual({ imported: 1, failed: 1 });
    expect(repository.appendProviderReport).toHaveBeenCalledTimes(1);
  });

  it("rejects a supplier report that claims another provider class", async () => {
    const database = { query: vi.fn().mockResolvedValue({ rows: [{
      id: "evidence-1",
      provider: "twilio",
      evidence_kind: "telephony_usage",
      source_report_id: "twilio-cycle-1",
      source_hash: "unused-after-class-validation",
      fetched_at: "2026-09-01T02:00:00.000Z",
      payload: { quantities: { standard_runtime_seconds: 60 } },
    }] }) };

    await expect(new PostgresProviderEvidenceRepository(database).readProviderUsage(cycle))
      .rejects.toThrow("does not match its evidence kind");
  });

  it("rejects duplicate premium session evidence across providers", async () => {
    const database = { query: vi.fn().mockResolvedValue({ rows: [{
      id: "evidence-openai",
      provider: "openai",
      evidence_kind: "runtime_usage",
      source_report_id: "openai-cycle-1",
      source_hash: "cd6c27817c2276c7f4e9f61ec0a60ae27edfd8febc872cdbae7e91d5a7576523",
      cycle_starts_at: cycle.cycleStartsAt,
      cycle_ends_at: cycle.cycleEndsAt,
      fetched_at: "2026-09-01T02:00:00.000Z",
      payload: {
        quantities: { premium_runtime_seconds: 60 },
        facts: [{ id: "session-shared", durationSeconds: 60 }],
      },
    }, {
      id: "evidence-gemini",
      provider: "gemini",
      evidence_kind: "runtime_usage",
      source_report_id: "gemini-cycle-1",
      source_hash: "bc5cef5af1d04ec6a7bcf03a641e19728daa3a0b38ecf5aa47ac061c911a0933",
      cycle_starts_at: cycle.cycleStartsAt,
      cycle_ends_at: cycle.cycleEndsAt,
      fetched_at: "2026-09-01T02:00:00.000Z",
      payload: {
        quantities: { premium_runtime_seconds: 60 },
        facts: [{ id: "session-shared", durationSeconds: 60 }],
      },
    }] }) };

    await expect(new PostgresProviderEvidenceRepository(database).readProviderUsage(cycle))
      .rejects.toThrow("duplicate provider session");
  });

  it("rejects a reused provider report ID with different source facts", async () => {
    const database = {
      query: vi.fn()
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rows: [{ source_hash: "different-hash" }] }),
    };
    const repository = new PostgresProviderEvidenceRepository(database);

    await expect(repository.appendProviderReport({
      ...cycle,
      id: "provider-evidence-1",
      provider: "twilio",
      evidenceKind: "telephony_usage",
      sourceReportId: "twilio-cycle-1",
      sourceHash: "expected-hash",
      fetchedAt: "2026-09-01T02:00:00.000Z",
      payload: { quantities: { platform_telephony_charge_minor: 55 } },
    })).rejects.toThrow("different source facts");
    expect(database.query.mock.calls[0]?.[0]).toContain(
      "on conflict (tenant_id, catalog_id, cycle_starts_at, cycle_ends_at, provider, source_report_id)",
    );
    expect(database.query.mock.calls[1]?.[0]).toContain("tenant_id = $1");
    expect(database.query.mock.calls[1]?.[0]).toContain("catalog_id = $2");
    expect(database.query.mock.calls[1]?.[1]).toEqual([
      "tenant-a",
      "catalog-1",
      cycle.cycleStartsAt,
      cycle.cycleEndsAt,
      "twilio",
      "twilio-cycle-1",
    ]);
  });
});

describe("provider-native reconciliation", () => {
  it("reconciles one exact Cartesia cycle without converting credits to runtime seconds", () => {
    expect(reconcileProviderNativeReport(cycle, {
      provider: "cartesia",
      evidenceKind: "runtime_usage",
      sourceReportId: "cartesia-cycle-1",
      payload: {
        quantities: {},
        source: { apiKeyId: "key-1", tenantScopeMappingId: "mapping-1" },
        facts: [{ id: "fact-1", apiKeyId: "key-1", cycleStartsAt: cycle.cycleStartsAt,
          cycleEndsAt: cycle.cycleEndsAt, credits: 42 }],
      },
    })).toEqual({
      provider: "cartesia", sourceReportId: "cartesia-cycle-1", status: "matched",
      factCount: 1, scopeId: "key-1", coverageStartsAt: cycle.cycleStartsAt,
      coverageEndsAt: cycle.cycleEndsAt, totals: { credits: 42 }, issues: [],
    });
  });

  it("rejects Zara meter quantities in a direct provider-native report", () => {
    expect(reconcileProviderNativeReport(cycle, {
      provider: "cartesia", evidenceKind: "runtime_usage", sourceReportId: "cartesia-cycle-quantity",
      payload: {
        quantities: { standard_runtime_seconds: 42 },
        source: { apiKeyId: "key-1", tenantScopeMappingId: "mapping-1" },
        facts: [{ id: "fact-1", apiKeyId: "key-1", cycleStartsAt: cycle.cycleStartsAt,
          cycleEndsAt: cycle.cycleEndsAt, credits: 42 }],
      },
    })).toMatchObject({ status: "mismatch", issues: ["provider_native_zara_quantity_forbidden"] });
  });

  it("returns a mismatch for wrongly scoped OpenAI facts", () => {
    expect(reconcileProviderNativeReport(cycle, {
      provider: "openai", evidenceKind: "runtime_usage", sourceReportId: "openai-cycle-1",
      payload: { quantities: {}, projectId: "project-1", facts: [{
        id: "usage-1", kind: "usage", projectId: "project-other",
        bucketStartsAt: cycle.cycleStartsAt, bucketEndsAt: cycle.cycleEndsAt,
        inputTokens: 10, outputTokens: 5, inputCachedTokens: 0,
        inputAudioTokens: 0, outputAudioTokens: 0, requestCount: 1,
      }] },
    })).toMatchObject({ status: "mismatch", issues: ["provider_fact_scope_mismatch"] });
  });

  it("returns a mismatch for Gemini boundary overlap instead of inventing an allocation", () => {
    expect(reconcileProviderNativeReport(cycle, {
      provider: "gemini", evidenceKind: "runtime_usage", sourceReportId: "gemini-cycle-1",
      payload: { quantities: {}, source: { mappingId: "mapping-1" }, facts: [{
        id: "gemini-1", projectId: "project-1", usageStartTime: cycle.cycleStartsAt,
        usageEndTime: cycle.cycleEndsAt, costMicros: 10, currency: "usd",
        usageAmount: "2", usageUnit: "requests", allocationStatus: "boundary_overlap",
      }] },
    })).toMatchObject({ status: "mismatch", issues: ["provider_fact_cycle_overlap"] });
  });

  it("rejects Gemini boundary overlap from timestamps when the status claims containment", () => {
    expect(reconcileProviderNativeReport(cycle, {
      provider: "gemini", evidenceKind: "runtime_usage", sourceReportId: "gemini-cycle-2",
      payload: { quantities: {}, source: { mappingId: "mapping-1" }, facts: [{
        id: "gemini-2", projectId: "project-1", usageStartTime: "2026-07-31T23:00:00.000Z",
        usageEndTime: "2026-08-01T01:00:00.000Z", costMicros: 10, currency: "usd",
        usageAmount: "2", usageUnit: "requests", allocationStatus: "contained",
      }] },
    })).toMatchObject({ status: "mismatch", issues: ["provider_fact_cycle_overlap"] });
  });
});

describe("PolarBillingReconciliationReader", () => {
  it("reads authenticated meter quantities and order invoice totals with source freshness", async () => {
    const polar = {
      getMeterQuantity: vi.fn()
        .mockResolvedValueOnce({ total: 60 })
        .mockResolvedValueOnce({ total: 20 }),
      getCustomerMeterBalance: vi.fn().mockResolvedValue({ balance: 402 }),
      listCycleOrders: vi.fn().mockResolvedValue([
        { id: "order-1", totalAmount: 100, currency: "usd", createdAt: "2026-08-20T00:00:00.000Z" },
      ]),
    };
    const mappings = {
      listPolarMappings: vi.fn().mockResolvedValue([
        { mappingType: "meter", internalKey: "standard_runtime_seconds", providerId: "meter-standard" },
        { mappingType: "meter", internalKey: "payg_charge_minor", providerId: "meter-payg" },
      ]),
    };
    const reader = new PolarBillingReconciliationReader(
      polar,
      mappings,
      "production",
      () => "2026-09-01T02:00:00.000Z",
    );

    await expect(reader.readPolarMeters(cycle)).resolves.toMatchObject({
      sourceId: "polar:meters.quantities",
      fetchedAt: "2026-09-01T02:00:00.000Z",
      organizationId: "tenant-a",
      catalogId: "catalog-1",
      quantities: { standard_runtime_seconds: 60, payg_charge_minor: 20 },
      polarBalanceMinor: 402,
    });
    await expect(reader.readDraftInvoice(cycle)).resolves.toMatchObject({
      sourceId: "polar:orders.list",
      fetchedAt: "2026-09-01T02:00:00.000Z",
      organizationId: "tenant-a",
      catalogId: "catalog-1",
      amountMinor: 100,
      currency: "usd",
    });
    expect(polar.getMeterQuantity).toHaveBeenCalledWith(expect.objectContaining({
      externalCustomerId: "tenant-a",
      startTimestamp: cycle.cycleStartsAt,
      endTimestamp: cycle.cycleEndsAt,
    }));
    expect(polar.getCustomerMeterBalance).toHaveBeenCalledWith({
      externalCustomerId: "tenant-a",
      meterId: "meter-payg",
    });
    expect(polar.listCycleOrders).toHaveBeenCalledWith(cycle);

    polar.getMeterQuantity.mockResolvedValue({ total: 0 });
    polar.getCustomerMeterBalance.mockResolvedValue(null);
    await expect(reader.readPolarMeters(cycle)).resolves.not.toHaveProperty("polarBalanceMinor");
  });
});
