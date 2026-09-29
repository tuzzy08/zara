import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { collectSharedProviderBillingEvidence, saveSharedProviderBillingEvidence } from "./shared-provider-billing-evidence";
import { ProviderUsageRecordingRepository } from "./provider-usage-recording.repository";
import { usageRecordingTestPool } from "./provider-usage-recording.test-support";
import { OpenAiOrganizationBillingClient } from "./openai-organization-billing.client";
import { OpenAiDirectBillingEvidenceSource } from "./openai-billing-evidence.source";
import { CartesiaAdminUsageClient, CartesiaBillingEvidenceSource } from "./cartesia-billing-evidence.source";
import { OpenAiRealtimeUsageRecorder } from "./openai-realtime-usage-recorder";

describe("shared provider billing evidence", () => {
  it("collects independent transcription HTTP evidence and durable observations without merging completion totals", async () => {
    const pool = usageRecordingTestPool();
    try {
      const observations = new ProviderUsageRecordingRepository(pool);
      await observations.beginConnection({ organizationId: "tuzzy-test", sessionId: "lost-connection", provider: "openai",
        externalScopeId: "shared-project", model: "gpt-realtime-2.1", occurredAt: "2026-07-31T23:59:00.000Z" });
      await observations.begin({ organizationId: "tuzzy-test", sessionId: "lost-request", provider: "openai",
        externalScopeId: "shared-project", model: "gpt-4.1", occurredAt: "2026-07-31T23:59:00.000Z" });
      const recorder = new OpenAiRealtimeUsageRecorder(observations, { organizationId: "tuzzy-test", sessionId: "call-1",
        externalScopeId: "shared-project", model: "gpt-realtime-2.1", transcriptionModel: "gpt-realtime-whisper" },
      () => "2026-08-01T10:00:00.000Z");
      await recorder.record(JSON.stringify({ type: "session.created", session: { id: "provider-session" } }));
      await recorder.record(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed",
        item_id: "item-1", content_index: 0, transcript: "private words", usage: { type: "duration", seconds: 0.1 } }));
      const client = new OpenAiOrganizationBillingClient({ adminKey: "private-admin-key", fetchImplementation: async url => {
        const transcription = new URL(url).pathname.endsWith("/audio_transcriptions");
        return new Response(JSON.stringify({ object: "page", has_more: false, data: transcription ? [{
          start_time: 1785542400, end_time: 1785628800, results: [{ object: "organization.usage.audio_transcriptions.result",
            project_id: "shared-project", model: "gpt-realtime-whisper", seconds: 0.1, num_model_requests: 1 }],
        }] : [] }));
      } });
      const now = () => "2026-09-06T00:00:00.000Z";
      const result = await collectSharedProviderBillingEvidence({ cycleStartsAt: "2026-08-01T00:00:00.000Z",
        cycleEndsAt: "2026-08-02T00:00:00.000Z", cartesiaApiKeyId: "shared-key", openAiProjectId: "shared-project" }, {
        observations, openaiTranscription: client, now,
        openai: new OpenAiDirectBillingEvidenceSource({ getProjectId: async () => null }, client, now),
        cartesia: new CartesiaBillingEvidenceSource(new CartesiaAdminUsageClient({ adminApiKey: "private-cartesia-key",
          fetchImplementation: async url => new Response(JSON.stringify(new URL(url).pathname.startsWith("/api-keys/")
            ? { id: "shared-key" } : { data: [{ start_ts: "2026-08-01T00:00:00.000Z", end_ts: "2026-08-02T00:00:00.000Z", credits: 0 }] })),
        }), { readDurableTenantApiKeyScope: async () => null }, now),
      });
      expect(result.transcription).toMatchObject({ report: { scope: "platform", sourceKind: "audio_transcriptions",
        projectId: "shared-project", sourceReportId: expect.any(String), facts: [{ seconds: 0.1, requestCount: 1 }] },
      observations: { complete: false, unresolvedRequestCount: 1,
        observations: [{ organizationId: "tuzzy-test", usage: { type: "duration", seconds: 0.1 } }] },
      comparison: { status: "incomplete", issues: ["observation_coverage_missing", "observation_unresolved"],
        groups: [{ providerSeconds: "0.1", observedSeconds: "0.1" }] } });
      expect(result.reports[1]).toMatchObject({ observations: { unresolvedRequestCount: 1 },
        comparison: { status: "incomplete", issues: ["observation_coverage_missing", "observation_unresolved"] } });
      expect(result.reports[1]!.observations?.observations).toEqual([]);
      expect(result.reports[1]!.report.payload.facts).toEqual([]);
      expect(JSON.stringify(result)).not.toMatch(/private words|private-admin-key|private-cartesia-key/);
      expect(result.status).toBe("awaiting_usage_comparison");
      expect(result.reports[1]!.connectionCoverage).toMatchObject({ complete: false, connections: [
        { organizationId: "tuzzy-test", sessionId: "lost-connection", result: null },
      ] });
      expect(result.reports[1]!.usageReview).toMatchObject({ status: "review_required", complete: false,
        items: expect.arrayContaining([{
          kind: "connection", id: expect.any(String), organizationId: "tuzzy-test",
          sessionId: "lost-connection", callSessionId: null, providerSessionId: null,
          model: "gpt-realtime-2.1", occurredAt: "2026-07-31T23:59:00.000Z",
          quantity: null, reason: "connection_unresolved", action: "obtain_original_provider_evidence",
        }, {
          kind: "request", id: expect.any(String), organizationId: "tuzzy-test", sessionId: "lost-request",
          connectionId: null, callSessionId: null, model: "gpt-4.1", occurredAt: "2026-07-31T23:59:00.000Z",
          quantity: null, reason: "usage_result_missing", action: "obtain_original_provider_evidence",
        }]),
      });
    } finally { await pool.end(); }
  });
  it("includes saved observations without calling partial coverage complete", async () => {
    const pool = usageRecordingTestPool();
    try {
      const observations = new ProviderUsageRecordingRepository(pool);
      const id = await observations.begin({ organizationId: "tuzzy-test", sessionId: "call-1", provider: "openai",
        externalScopeId: "shared-project", model: "gpt-4.1", occurredAt: "2026-08-03T10:00:00.000Z" });
      await observations.complete("tuzzy-test", id, { providerRequestId: "chatcmpl-test", occurredAt: "2026-08-03T10:00:01.000Z",
        totals: { inputTokens: 20, outputTokens: 5, requestCount: 1 } });
      const result = await collectSharedProviderBillingEvidence({ cycleStartsAt: "2026-08-01T00:00:00.000Z",
        cycleEndsAt: "2026-09-01T00:00:00.000Z", cartesiaApiKeyId: "shared-key", openAiProjectId: "shared-project" }, {
        observations,
        cartesia: { collectSharedCycle: async () => ({ provider: "cartesia", evidenceKind: "runtime_usage", sourceReportId: "c-1", payload: { scope: "platform", quantities: {} } }) },
        openai: { collectSharedCycle: async () => ({ provider: "openai", evidenceKind: "runtime_usage", sourceReportId: "o-1", payload: { scope: "platform", quantities: {} } }) },
        now: () => "2026-09-06T00:00:00.000Z",
      });
      expect(result.reports[1]).toMatchObject({ observations: { complete: false,
        observations: [{ id: "chatcmpl-test", totals: { inputTokens: 20 } }] }, comparison: { status: "incomplete" } });
    } finally { await pool.end(); }
  });
  it("keeps failed connections and unfinished requests for review without crossing provider scope or period end", async () => {
    const pool = usageRecordingTestPool();
    try {
      const observations = new ProviderUsageRecordingRepository(pool);
      const request = { organizationId: "tenant-a", sessionId: "same-session", provider: "openai",
        externalScopeId: "shared-project", model: "gpt-realtime-2.1", occurredAt: "2026-07-31T23:59:00.000Z" };
      const connectionId = await observations.beginConnection({ ...request, callSessionId: "call-a" });
      await observations.finishConnection("tenant-a", connectionId, { endedAt: "2026-08-01T00:00:01.000Z",
        outcome: "failed", providerSessionId: "provider-session-a" });
      const pending = await observations.beginObserved({ ...request, connectionId }, "response-pending");
      await observations.begin({ ...request, organizationId: "tenant-b", externalScopeId: "other-project" });
      await observations.begin({ ...request, provider: "other-provider" });
      await observations.begin({ ...request, occurredAt: "2026-08-02T00:00:00.000Z" });
      const sources = { observations, now: () => "2026-09-06T00:00:00.000Z",
        cartesia: { collectSharedCycle: async () => ({ provider: "cartesia", evidenceKind: "runtime_usage" as const,
          sourceReportId: "c-1", payload: { scope: "platform", quantities: {} } }) },
        openai: { collectSharedCycle: async () => ({ provider: "openai", evidenceKind: "runtime_usage" as const,
          sourceReportId: "o-1", payload: { scope: "platform", quantities: {} } }) } };
      const cycle = { cycleStartsAt: "2026-08-01T00:00:00.000Z", cycleEndsAt: "2026-08-02T00:00:00.000Z",
        cartesiaApiKeyId: "shared-key", openAiProjectId: "shared-project" };
      const result = await collectSharedProviderBillingEvidence(cycle, sources);
      expect(result.reports[1]!.usageReview.items).toEqual([
        { kind: "connection", id: connectionId, organizationId: "tenant-a", sessionId: "same-session",
          callSessionId: "call-a", providerSessionId: "provider-session-a", model: request.model,
          occurredAt: request.occurredAt, quantity: null, reason: "connection_failed", action: "obtain_original_provider_evidence" },
        { kind: "request", id: pending.id, organizationId: "tenant-a", sessionId: "same-session", connectionId,
          callSessionId: "call-a", model: request.model, occurredAt: request.occurredAt,
          quantity: null, reason: "usage_result_missing", action: "obtain_original_provider_evidence" },
      ]);
      await observations.complete("tenant-a", pending.id, { providerRequestId: "response-pending",
        occurredAt: pending.occurredAt, totals: { inputTokens: 10, outputTokens: 3, requestCount: 1 } });
      const refreshed = await collectSharedProviderBillingEvidence(cycle, sources);
      expect(refreshed.reports[1]!.usageReview.items).toHaveLength(1);
      expect(refreshed.reports[0]!.usageReview).toEqual({ status: "review_required", complete: false, items: [] });
      expect(refreshed.reports[1]!.comparison.status).toBe("incomplete");
      const closedConnection = await observations.beginConnection({ ...request, occurredAt: "2026-08-01T01:00:00.000Z" });
      const closedPending = await observations.beginObserved({ ...request, connectionId: closedConnection,
        occurredAt: "2026-08-01T01:00:00.000Z" }, "closed-response");
      await observations.finishConnection("tenant-a", closedConnection, { endedAt: "2026-08-01T01:01:00.000Z",
        outcome: "closed", providerSessionId: "closed-provider-session" });
      const closedReport = await collectSharedProviderBillingEvidence(cycle, sources);
      expect(closedReport.reports[1]!.usageReview.items).toEqual([
        result.reports[1]!.usageReview.items![0],
        { kind: "request", id: closedPending.id, organizationId: "tenant-a", sessionId: "same-session",
          connectionId: closedConnection, callSessionId: null, model: request.model, occurredAt: "2026-08-01T01:00:00.000Z",
          quantity: null, reason: "usage_result_missing", action: "obtain_original_provider_evidence" },
      ]);
    } finally { await pool.end(); }
  });
  it("rejects a source report that contains a customer charge quantity", async () => {
    const source = { collectSharedCycle: async () => ({ provider: "cartesia",
      evidenceKind: "runtime_usage" as const, sourceReportId: "report-1",
      payload: { scope: "platform", quantities: { standard_runtime_seconds: 840 } },
    }) };
    await expect(collectSharedProviderBillingEvidence({
      cycleStartsAt: "2026-08-01T00:00:00.000Z", cycleEndsAt: "2026-09-01T00:00:00.000Z",
      cartesiaApiKeyId: "shared-key", openAiProjectId: "shared-project",
    }, { cartesia: source, openai: source, now: () => "2026-09-06T00:00:00.000Z" }))
      .rejects.toThrow("Shared provider reports must contain platform supplier facts only.");
  });
  it("requires explicit report scope and dates before the operator command can run", () => {
    const run = spawnSync(process.execPath, ["--import", "tsx",
      "apps/api/src/billing/collect-shared-provider-billing.ts"], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Usage: billing:collect-shared");
    expect(run.stdout).toBe("");
  });
  it.each([
    { cycleStartsAt: "2026-08-01T12:00:00.000Z" },
    { cycleEndsAt: "2026-10-01T00:00:00.000Z" },
    { cartesiaApiKeyId: " " },
    { openAiProjectId: "" },
  ])("rejects an unsafe collection period or scope: %j", async (override) => {
    const source = { collectSharedCycle: async () => ({ provider: "cartesia",
      evidenceKind: "runtime_usage" as const, sourceReportId: "report-1",
      payload: { scope: "platform", quantities: {} },
    }) };
    await expect(collectSharedProviderBillingEvidence({
      cycleStartsAt: "2026-08-01T00:00:00.000Z", cycleEndsAt: "2026-09-01T00:00:00.000Z",
      cartesiaApiKeyId: "shared-key", openAiProjectId: "shared-project", ...override,
    }, { cartesia: source, openai: source, now: () => "2026-09-06T00:00:00.000Z" }))
      .rejects.toThrow("Shared billing collection requires scope IDs and a completed full-UTC-day period.");
  });
  it("keeps both shared supplier reports outside tenant billing and does not claim a match", async () => {
    const result = await collectSharedProviderBillingEvidence({
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
      cartesiaApiKeyId: "shared-key", openAiProjectId: "shared-project",
    }, {
      cartesia: { collectSharedCycle: async () => ({ provider: "cartesia",
        evidenceKind: "runtime_usage", sourceReportId: "cartesia-1",
        payload: { scope: "platform", quantities: {}, facts: [{ credits: 840 }] },
      }) },
      openai: { collectSharedCycle: async () => ({ provider: "openai",
        evidenceKind: "runtime_usage", sourceReportId: "openai-1",
        payload: { scope: "platform", quantities: {}, facts: [{ amount: 3.25 }] },
      }) },
      now: () => "2026-09-06T00:00:00.000Z",
    });
    expect(result).toMatchObject({
      scope: "platform", status: "awaiting_usage_comparison",
      reports: [
        { externalScopeId: "shared-key", report: { provider: "cartesia" } },
        { externalScopeId: "shared-project", report: { provider: "openai" } },
      ],
    });
    expect(result).not.toHaveProperty("organizationId");
    expect(result).not.toHaveProperty("catalogId");
    expect(result.reports.map(item => item.usageReview)).toEqual([
      { status: "unavailable", complete: false, items: null },
      { status: "unavailable", complete: false, items: null },
    ]);
    expect(result.reports.map((item) => item.comparison)).toEqual([
      expect.objectContaining({ status: "incomplete", issues: ["observation_coverage_missing"] }),
      expect.objectContaining({ status: "incomplete", issues: ["observation_coverage_missing"] }),
    ]);
    const directory = await mkdtemp(join(tmpdir(), "zara-shared-billing-"));
    try {
      const path = join(directory, "report.json");
      await saveSharedProviderBillingEvidence(path, result);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(result);
      await expect(saveSharedProviderBillingEvidence(path, result)).rejects.toThrow();
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(result);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
