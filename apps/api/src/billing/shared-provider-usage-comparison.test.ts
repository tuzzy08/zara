import { describe, expect, it } from "vitest";
import { compareSharedProviderUsage } from "./shared-provider-usage-comparison";

const period = { cycleStartsAt: "2026-08-01T00:00:00.000Z", cycleEndsAt: "2026-09-01T00:00:00.000Z" };
const report = { provider: "cartesia", evidenceKind: "runtime_usage" as const, sourceReportId: "report-1",
  payload: { scope: "platform", quantities: {}, source: { apiKeyId: "shared-key" },
    facts: [{ id: "fact-1", apiKeyId: "shared-key", ...period, credits: 40 }] } };

describe("shared provider usage comparison", () => {
  it.each([true, false])("reports unresolved requests even when coverage is %s", complete => {
    const result = compareSharedProviderUsage({ ...period, externalScopeId: "shared-key", report }, {
      ...period, complete, unresolvedRequestCount: 1, observations: [{ id: "r1", organizationId: "tuzzy-test",
        externalScopeId: "shared-key", provider: "cartesia", occurredAt: "2026-08-03T10:00:00.000Z", totals: { credits: 40 } }],
    });
    expect(result).toMatchObject({ status: "incomplete", issues: expect.arrayContaining(["observation_unresolved"]) });
    if (!complete) expect(result.issues).toContain("observation_coverage_missing");
  });
  it.each([
    [{ ...report, provider: "unknown" }, "provider_unsupported"],
    [{ ...report, sourceReportId: "" }, "provider_identity_missing"],
    [{ ...report, payload: { ...report.payload, facts: [{ ...report.payload.facts[0], id: "" }] } }, "provider_identity_missing"],
    [{ ...report, payload: { ...report.payload, facts: [report.payload.facts[0], { ...report.payload.facts[0], id: "fact-2" }] } }, "provider_fact_count_invalid"],
  ])("rejects unverifiable provider identities", (candidate, issue) => {
    expect(compareSharedProviderUsage({ ...period, externalScopeId: "shared-key", report: candidate }, {
      ...period, complete: true, unresolvedRequestCount: 0, observations: [],
    }).issues).toContain(issue);
  });
  it("rejects repeated provider facts instead of doubling a shared total", () => {
    const result = compareSharedProviderUsage({ ...period, externalScopeId: "shared-key", report: {
      ...report, payload: { ...report.payload, facts: [report.payload.facts[0], report.payload.facts[0]] },
    } }, { ...period, complete: true, unresolvedRequestCount: 0, observations: [{ id: "r1", organizationId: "tuzzy-test",
      externalScopeId: "shared-key", provider: "cartesia", occurredAt: "2026-08-03T10:00:00.000Z",
      totals: { credits: 80 } }] });
    expect(result.status).toBe("mismatch");
    expect(result.issues).toContain("provider_fact_duplicate");
  });

  it("rejects an invalid comparison period even when observation coverage copies it", () => {
    const invalid = { cycleStartsAt: "bad", cycleEndsAt: "bad" };
    const result = compareSharedProviderUsage({ ...invalid, externalScopeId: "shared-key", report }, {
      ...invalid, complete: true, unresolvedRequestCount: 0, observations: [],
    });
    expect(result.issues).toContain("comparison_period_invalid");
  });
  it("keeps OpenAI cost currency separate and compares integer micro-units", () => {
    const result = compareSharedProviderUsage({ ...period, externalScopeId: "project-1", report: {
      provider: "openai", evidenceKind: "runtime_usage", sourceReportId: "cost-report", payload: {
        scope: "platform", quantities: {}, projectId: "project-1", facts: [{
          id: "cost-1", kind: "cost", projectId: "project-1", bucketStartsAt: period.cycleStartsAt,
          bucketEndsAt: period.cycleEndsAt, currency: "usd", amount: 0.25,
        }],
      },
    } }, { ...period, complete: true, unresolvedRequestCount: 0, observations: [{
      id: "cost-source-1", organizationId: "tuzzy-test", provider: "openai", externalScopeId: "project-1",
      occurredAt: "2026-08-03T10:00:00.000Z", totals: { "costMicros:usd": 250000 },
    }] });
    expect(result).toMatchObject({ status: "matched", providerTotals: { "costMicros:usd": 250000 }, issues: [] });
  });

  it.each([
    [{ ...period, cycleEndsAt: "2026-10-01T00:00:00.000Z" }, "provider_period_mismatch"],
    [{ ...period, cycleStartsAt: "2026-07-31T00:00:00.000Z" }, "provider_period_mismatch"],
  ])("rejects a provider fact from a different period", (factPeriod, issue) => {
    const result = compareSharedProviderUsage({ ...period, externalScopeId: "shared-key", report: {
      ...report, payload: { ...report.payload, facts: [{ id: "fact-1", apiKeyId: "shared-key", ...factPeriod, credits: 40 }] },
    } }, { ...period, complete: true, unresolvedRequestCount: 0, observations: [] });
    expect(result.issues).toContain(issue);
  });
  it.each([
    [{ ...report, payload: { ...report.payload, facts: [] } }, "provider_facts_missing"],
    [{ ...report, payload: { ...report.payload, scope: "tenant" } }, "provider_scope_mismatch"],
    [{ ...report, payload: { ...report.payload, quantities: { standard_runtime_seconds: 40 } } }, "provider_customer_quantity_forbidden"],
    [{ ...report, payload: { ...report.payload, facts: [{ id: "fact-1", apiKeyId: "other", ...period, credits: 40 }] } }, "provider_scope_mismatch"],
    [{ ...report, payload: { ...report.payload, facts: [{ id: "fact-1", apiKeyId: "shared-key", ...period, credits: -1 }] } }, "provider_quantity_invalid"],
  ])("rejects unsafe provider reports", (candidate, issue) => {
    const result = compareSharedProviderUsage({ ...period, externalScopeId: "shared-key", report: candidate }, {
      ...period, complete: true, unresolvedRequestCount: 0, observations: [],
    });
    expect(result.status).not.toBe("matched");
    expect(result.issues).toContain(issue);
  });
  it("compares OpenAI token and request totals without using a runtime-second estimate", () => {
    const result = compareSharedProviderUsage({ ...period, externalScopeId: "project-1", report: {
      provider: "openai", evidenceKind: "runtime_usage", sourceReportId: "openai-1", payload: {
        scope: "platform", quantities: {}, projectId: "project-1", facts: [{
          id: "openai-fact-1", kind: "usage", projectId: "project-1", bucketStartsAt: period.cycleStartsAt,
          bucketEndsAt: period.cycleEndsAt, inputTokens: 100, outputTokens: 30, requestCount: 2,
        }],
      },
    } }, { ...period, complete: true, unresolvedRequestCount: 0, observations: [{
      id: "provider-request-1", organizationId: "tuzzy-test", provider: "openai", externalScopeId: "project-1",
      occurredAt: "2026-08-03T10:00:00.000Z", totals: { inputTokens: 100, outputTokens: 30, requestCount: 2 },
    }] });
    expect(result).toMatchObject({ status: "matched",
      providerTotals: { inputTokens: 100, outputTokens: 30, requestCount: 2 }, issues: [] });
  });
  it.each([
    [{ externalScopeId: "other-key" }, "observation_scope_mismatch"],
    [{ provider: "openai" }, "observation_scope_mismatch"],
    [{ organizationId: "" }, "observation_identity_missing"],
    [{ occurredAt: period.cycleEndsAt }, "observation_period_mismatch"],
    [{ totals: { credits: -40 } }, "observation_quantity_invalid"],
  ])("rejects unsafe observations: %j", (override, issue) => {
    const result = compareSharedProviderUsage({ ...period, externalScopeId: "shared-key", report }, {
      ...period, complete: true, unresolvedRequestCount: 0, observations: [{ id: "request-1", organizationId: "tuzzy-test",
        externalScopeId: "shared-key", provider: "cartesia", occurredAt: "2026-08-03T10:00:00.000Z",
        totals: { credits: 40 }, ...override }],
    });
    expect(result.status).toBe("mismatch");
    expect(result.issues).toContain(issue);
  });

  it("rejects replayed provider request observations", () => {
    const observation = { id: "request-1", organizationId: "tuzzy-test", externalScopeId: "shared-key",
      provider: "cartesia", occurredAt: "2026-08-03T10:00:00.000Z", totals: { credits: 20 } };
    expect(compareSharedProviderUsage({ ...period, externalScopeId: "shared-key", report }, {
      ...period, complete: true, unresolvedRequestCount: 0, observations: [observation, observation],
    })).toMatchObject({ status: "mismatch", issues: expect.arrayContaining(["observation_duplicate"]) });
  });
  it.each([null, { ...period, complete: false, unresolvedRequestCount: 0, observations: [] },
    { ...period, cycleStartsAt: "2026-08-02T00:00:00.000Z", complete: true, unresolvedRequestCount: 0, observations: [] }])(
    "keeps missing or incomplete recording coverage unqualified", (snapshot) => {
      expect(compareSharedProviderUsage({ ...period, externalScopeId: "shared-key", report }, snapshot))
        .toMatchObject({ status: "incomplete", issues: ["observation_coverage_missing"] });
    });
  it("compares all tenant and non-billable observations without allocating the report to a tenant", () => {
    expect(compareSharedProviderUsage({ ...period, externalScopeId: "shared-key", report }, {
      ...period, complete: true, unresolvedRequestCount: 0, observations: [
        { id: "tuzzy-request", organizationId: "tuzzy-test", externalScopeId: "shared-key",
          provider: "cartesia", occurredAt: "2026-08-03T10:00:00.000Z", totals: { credits: 15 } },
        { id: "zara-ai-sandbox", organizationId: "zara-ai-test", externalScopeId: "shared-key",
          provider: "cartesia", occurredAt: "2026-08-04T10:00:00.000Z", totals: { credits: 25 } },
      ],
    })).toEqual({ scope: "platform", provider: "cartesia", externalScopeId: "shared-key",
      status: "matched", providerTotals: { credits: 40 }, zaraTotals: { credits: 40 }, issues: [] });
  });
});
