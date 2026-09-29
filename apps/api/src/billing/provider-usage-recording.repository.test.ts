import { describe, expect, it } from "vitest";
import { ProviderUsageRecordingRepository } from "./provider-usage-recording.repository";

import { usageRecordingTestPool } from "./provider-usage-recording.test-support";

describe("provider usage recording", () => {
  it("saves final observed usage with a canonical first receipt time", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const scope = { organizationId: "tuzzy-test", sessionId: "call-1", provider: "openai",
        externalScopeId: "proj-shared", model: "gpt-realtime-2.1", occurredAt: "2026-09-06T11:00:00+01:00" };
      const result = { providerRequestId: "resp-1", totals: { inputTokens: 30, outputTokens: 7, requestCount: 1 } };
      const request = await repository.beginObserved(scope, "realtime-response:resp-1", result);
      expect(request.occurredAt).toBe("2026-09-06T10:00:00.000Z");
      expect(await repository.beginObserved({ ...scope, occurredAt: "2026-09-07T10:00:00Z" }, "realtime-response:resp-1", result))
        .toEqual(request);
      expect(await repository.listTenantRequests(scope.organizationId)).toMatchObject([{ result: {
        occurredAt: "2026-09-06T10:00:00.000Z", totals: result.totals,
      } }]);
    } finally { await pool.end(); }
  });
  it("uses the stored result time with an inclusive UTC start and exclusive UTC end", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      for (const [providerRequestId, occurredAt] of [
        ["before-start", "2026-09-07T23:59:59.999Z"], ["at-start", "2026-09-08T00:00:00.000Z"],
        ["before-end", "2026-09-08T23:59:59.999Z"], ["at-end", "2026-09-09T00:00:00.000Z"],
      ] as const) {
        const id = await repository.begin({ organizationId: "tuzzy-test", sessionId: "call-1", provider: "openai",
          externalScopeId: "proj-shared", model: "gpt-4.1", occurredAt: "2026-09-09T01:00:00.000Z" });
        await repository.complete("tuzzy-test", id, { providerRequestId, occurredAt,
          totals: { inputTokens: 20, outputTokens: 5, requestCount: 1 } });
      }
      const report = await repository.loadSharedCycle({ provider: "openai", externalScopeId: "proj-shared",
        cycleStartsAt: "2026-09-08T00:00:00.000Z", cycleEndsAt: "2026-09-09T00:00:00.000Z" });
      expect(report.observations.map(row => row.id).sort()).toEqual(["at-start", "before-end"]);
      expect(report).toMatchObject({ complete: false, unresolvedRequestCount: 0 });
    } finally { await pool.end(); }
  });
  it.each([
    { provider: " " }, { externalScopeId: " " }, { cycleStartsAt: "invalid" }, { cycleEndsAt: "invalid" },
    { cycleStartsAt: "2026-09-08T12:00:00.000Z" }, { cycleEndsAt: "2026-09-09T12:00:00.000Z" },
    { cycleStartsAt: "2026-09-09T00:00:00.000Z" }, { cycleEndsAt: "2026-09-07T00:00:00.000Z" },
  ])("rejects an unsafe shared completion read: %j", async override => {
    const pool = usageRecordingTestPool();
    try {
      await expect(new ProviderUsageRecordingRepository(pool).loadSharedCycle({ provider: "openai", externalScopeId: "proj-shared",
        cycleStartsAt: "2026-09-08T00:00:00.000Z", cycleEndsAt: "2026-09-09T00:00:00.000Z", ...override }))
        .rejects.toThrow("Shared usage read requires scope and full UTC days.");
    } finally { await pool.end(); }
  });
  it("keeps earlier unresolved requests visible after restart without inventing completion usage", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      for (const [organizationId, provider, externalScopeId, occurredAt] of [
        ["tuzzy-test", "openai", "proj-shared", "2026-09-07T23:59:59.999Z"],
        ["zara-ai-test", "openai", "proj-shared", "2026-09-08T00:00:00.000Z"],
        ["tuzzy-test", "openai", "other-project", "2026-09-08T10:00:00.000Z"],
        ["tuzzy-test", "other-provider", "proj-shared", "2026-09-08T10:00:00.000Z"],
        ["tuzzy-test", "openai", "proj-shared", "2026-09-09T00:00:00.000Z"],
      ] as const) {
        await repository.begin({ organizationId, provider, externalScopeId,
          occurredAt, sessionId: "same-call", model: "gpt-4.1" });
      }
      const restarted = new ProviderUsageRecordingRepository(pool);
      expect(await restarted.loadSharedCycle({ provider: "openai", externalScopeId: "proj-shared",
        cycleStartsAt: "2026-09-08T00:00:00.000Z", cycleEndsAt: "2026-09-09T00:00:00.000Z" }))
        .toMatchObject({ complete: false, unresolvedRequestCount: 2, observations: [] });
      expect(await restarted.loadSharedTranscriptionCycle({ externalScopeId: "proj-shared",
        cycleStartsAt: "2026-09-08T00:00:00.000Z", cycleEndsAt: "2026-09-09T00:00:00.000Z" }))
        .toMatchObject({ complete: false, unresolvedRequestCount: 2, observations: [] });
      expect(await restarted.listTenantRequests("unknown-tenant")).toEqual([]);
    } finally { await pool.end(); }
  });
  it("includes stored attribution in platform reports without claiming complete coverage", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const scope = { organizationId: "tuzzy-test", sessionId: "premium-1", externalScopeId: "proj-shared",
        provider: "openai", model: "gpt-realtime-2.1", occurredAt: "2026-09-08T10:00:00.000Z" };
      const connectionId = await repository.beginConnection({ ...scope, callSessionId: "call-1" });
      const response = await repository.beginObserved({ ...scope, connectionId }, "response-1");
      await repository.complete(scope.organizationId, response.id, { providerRequestId: "response-1", occurredAt: scope.occurredAt,
        totals: { inputTokens: 1, outputTokens: 2, requestCount: 1 } });
      const transcription = await repository.beginObserved({ ...scope, connectionId, model: "gpt-realtime-whisper" }, "transcription-1");
      await repository.complete(scope.organizationId, transcription.id, { providerRequestId: "transcription-1", occurredAt: scope.occurredAt,
        sourceKind: "realtime_transcription", totals: { transcriptionRequestCount: 1 },
        transcription: { providerSessionId: "provider-1", itemId: "item-1", contentIndex: 0, usage: { type: "duration", seconds: 0.5 } } });
      const period = { provider: "openai", externalScopeId: "proj-shared",
        cycleStartsAt: "2026-09-08T00:00:00.000Z", cycleEndsAt: "2026-09-09T00:00:00.000Z" };
      const attribution = { organizationId: "tuzzy-test", sessionId: "premium-1", connectionId, callSessionId: "call-1" };
      expect(await repository.loadSharedCycle(period)).toMatchObject({ complete: false, observations: [attribution] });
      expect(await repository.loadSharedTranscriptionCycle(period)).toMatchObject({ complete: false, observations: [attribution] });
      expect(await repository.loadSharedConnectionCycle(period))
        .toMatchObject({ complete: false, connections: [{ id: connectionId, callSessionId: "call-1" }] });
    } finally { await pool.end(); }
  });
  it("preserves the first connection on replay and rejects reassignment or invented historical links", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const scope = { organizationId: "tuzzy-test", sessionId: "premium-1", externalScopeId: "proj-shared",
        provider: "openai", model: "gpt-realtime-2.1", occurredAt: "2026-09-08T10:00:00.000Z" };
      const first = await repository.beginConnection({ ...scope, callSessionId: "call-1" });
      const second = await repository.beginConnection({ ...scope, callSessionId: "call-1" });
      const original = await repository.beginObserved({ ...scope, connectionId: first }, "response-1");
      expect(await repository.beginObserved({ ...scope, connectionId: first, occurredAt: "2026-09-09T10:00:00.000Z" }, "response-1"))
        .toEqual(original);
      await expect(repository.beginObserved({ ...scope, connectionId: second }, "response-1"))
        .rejects.toThrow("Provider usage request identity changed.");
      await expect(repository.beginObserved(scope, "response-1")).rejects.toThrow("Provider usage request identity changed.");
      await repository.beginObserved(scope, "historical-response");
      await expect(repository.beginObserved({ ...scope, connectionId: first }, "historical-response"))
        .rejects.toThrow("Provider usage request identity changed.");
    } finally { await pool.end(); }
  });
  it.each([{ organizationId: "other" }, { sessionId: "other" }, { provider: "other" },
    { externalScopeId: "other" }, { connectionId: "missing" }])("rejects a connection link with different scope: %j", async override => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const scope = { organizationId: "tuzzy-test", sessionId: "premium-1", externalScopeId: "proj-shared",
        provider: "openai", model: "gpt-realtime-2.1", occurredAt: "2026-09-08T10:00:00.000Z" };
      const connectionId = await repository.beginConnection(scope);
      await expect(repository.beginObserved({ ...scope, connectionId, ...override }, "response-1"))
        .rejects.toThrow("Provider usage connection scope does not match.");
      expect(await repository.listTenantRequests(scope.organizationId)).toEqual([]);
    } finally { await pool.end(); }
  });
  it("retains the trusted phone call identity on a connection across repository instances", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const connectionId = await repository.beginConnection({ organizationId: "tuzzy-test", sessionId: "premium-1",
        callSessionId: "call-1", externalScopeId: "proj-shared", provider: "openai",
        model: "gpt-realtime-2.1", occurredAt: "2026-09-08T10:00:00.000Z" });
      expect(await new ProviderUsageRecordingRepository(pool).listTenantConnections("tuzzy-test"))
        .toMatchObject([{ sessionId: "premium-1", callSessionId: "call-1" }]);
      await repository.beginObserved({ organizationId: "tuzzy-test", sessionId: "premium-1",
        connectionId, externalScopeId: "proj-shared", provider: "openai", model: "gpt-realtime-2.1",
        occurredAt: "2026-09-08T10:00:01.000Z" }, "response-1");
      expect(await new ProviderUsageRecordingRepository(pool).listTenantRequests("tuzzy-test"))
        .toMatchObject([{ sessionId: "premium-1", connectionId, callSessionId: "call-1" }]);
    } finally { await pool.end(); }
  });
  it.each([{ externalScopeId: " " }, { cycleStartsAt: "invalid" }, { cycleEndsAt: "2026-09-08T12:00:00.000Z" }])(
    "rejects unsafe shared connection report input: %j", async override => {
      const pool = usageRecordingTestPool();
      try {
        await expect(new ProviderUsageRecordingRepository(pool).loadSharedConnectionCycle({ provider: "openai", externalScopeId: "proj-shared",
          cycleStartsAt: "2026-09-08T00:00:00.000Z", cycleEndsAt: "2026-09-09T00:00:00.000Z", ...override }))
          .rejects.toThrow("Shared connection read requires scope and full UTC days.");
      } finally { await pool.end(); }
    });
  it("includes unresolved and overlapping connections in the shared report without claiming complete coverage", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      for (const [tenant, project, start, end] of [
        ["tuzzy-test", "proj-shared", "2026-09-07T23:59:00.000Z", null],
        ["zara-ai-test", "proj-shared", "2026-09-07T23:59:00.000Z", "2026-09-08T00:01:00.000Z"],
        ["tuzzy-test", "other", "2026-09-08T10:00:00.000Z", null],
        ["tuzzy-test", "proj-shared", "2026-09-07T10:00:00.000Z", "2026-09-08T00:00:00.000Z"],
        ["tuzzy-test", "proj-shared", "2026-09-09T00:00:00.000Z", null],
      ] as const) {
        const id = await repository.beginConnection({ organizationId: tenant, sessionId: "same-session", externalScopeId: project,
          provider: "openai", model: "gpt-realtime-2.1", occurredAt: start });
        if (end) await repository.finishConnection(tenant, id, { endedAt: end, outcome: "closed", providerSessionId: "sess-1" });
      }
      const report = await new ProviderUsageRecordingRepository(pool).loadSharedConnectionCycle({ provider: "openai", externalScopeId: "proj-shared",
        cycleStartsAt: "2026-09-08T00:00:00.000Z", cycleEndsAt: "2026-09-09T00:00:00.000Z" });
      expect(report).toMatchObject({ complete: false, connections: expect.arrayContaining([
        expect.objectContaining({ organizationId: "tuzzy-test", result: null }),
        expect.objectContaining({ organizationId: "zara-ai-test", result: expect.objectContaining({ outcome: "closed" }) }),
      ]) });
      expect(report.connections).toHaveLength(2);
    } finally { await pool.end(); }
  });
  it("finalizes a connection once under its tenant and rejects invalid or changed results", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const id = await repository.beginConnection({ organizationId: "tuzzy-test", sessionId: "session-1",
        externalScopeId: "proj-shared", provider: "openai", model: "gpt-realtime-2.1", occurredAt: "2026-09-08T10:00:00.000Z" });
      const result = { endedAt: "2026-09-08T10:01:00.000Z", outcome: "closed" as const, providerSessionId: "sess-1" };
      await expect(repository.finishConnection("other", id, result)).rejects.toThrow("Provider connection not found.");
      await expect(repository.finishConnection("tuzzy-test", id, { ...result, endedAt: "2026-09-08T09:00:00.000Z" }))
        .rejects.toThrow("Invalid provider connection result.");
      await repository.finishConnection("tuzzy-test", id, result);
      await repository.finishConnection("tuzzy-test", id, result);
      await expect(repository.finishConnection("tuzzy-test", id, { ...result, outcome: "failed" }))
        .rejects.toThrow("Provider connection result changed.");
      expect(await repository.listTenantConnections("tuzzy-test")).toMatchObject([{ result }]);
    } finally { await pool.end(); }
  });
  it("retains an unresolved provider connection across repository instances without inventing usage", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const id = await repository.beginConnection({ organizationId: "tuzzy-test", sessionId: "session-1",
        externalScopeId: "proj-shared", provider: "openai", model: "gpt-realtime-2.1", occurredAt: "2026-09-08T10:00:00.000Z" });
      const restarted = new ProviderUsageRecordingRepository(pool);
      expect(await restarted.listTenantConnections("tuzzy-test")).toEqual([{ id, sessionId: "session-1", callSessionId: null,
        externalScopeId: "proj-shared", provider: "openai", model: "gpt-realtime-2.1",
        startedAt: "2026-09-08T10:00:00.000Z", result: null }]);
      expect(await restarted.listTenantConnections("zara-ai-test")).toEqual([]);
      expect(await restarted.listTenantRequests("tuzzy-test")).toEqual([]);
    } finally { await pool.end(); }
  });
  it.each([
    { externalScopeId: " " }, { cycleStartsAt: "invalid" },
    { cycleStartsAt: "2026-08-01T12:00:00.000Z" }, { cycleStartsAt: "2026-08-02T00:00:00.000Z" },
  ])("rejects an unsafe shared transcription read: %j", async override => {
    const pool = usageRecordingTestPool();
    try {
      await expect(new ProviderUsageRecordingRepository(pool).loadSharedTranscriptionCycle({ externalScopeId: "proj-shared",
        cycleStartsAt: "2026-08-01T00:00:00.000Z", cycleEndsAt: "2026-08-02T00:00:00.000Z", ...override }))
        .rejects.toThrow("Shared transcription read requires a project and full UTC days.");
    } finally { await pool.end(); }
  });
  it("reads transcription separately by shared project and period, keeping partial coverage", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const expectedIds: string[] = [];
      for (const [organizationId, externalScopeId, occurredAt, kind] of [
        ["tuzzy-test", "proj-shared", "2026-08-01T00:00:00.000Z", "duration"],
        ["zara-ai-test", "proj-shared", "2026-08-01T23:59:59.999Z", "tokens"],
        ["tuzzy-test", "other-project", "2026-08-01T10:00:00.000Z", "duration"],
        ["tuzzy-test", "proj-shared", "2026-08-02T00:00:00.000Z", "duration"],
        ["tuzzy-test", "proj-shared", "2026-08-01T10:00:00.000Z", "response"],
        ["tuzzy-test", "proj-shared", "2026-08-01T10:00:00.000Z", "unresolved"],
        ["tuzzy-test", "proj-shared", "2026-07-31T23:59:59.999Z", "duration"],
      ] as const) {
        const id = await repository.begin({ organizationId, sessionId: "same-call", externalScopeId,
          provider: "openai", model: "gpt-realtime-whisper", occurredAt });
        if (kind === "unresolved") continue;
        const transcription = kind === "response" ? {} : { sourceKind: "realtime_transcription" as const,
          transcription: { providerSessionId: id, itemId: "item-1", contentIndex: 0,
            usage: kind === "duration" ? { type: "duration" as const, seconds: 0.1 }
              : { type: "tokens" as const, input_tokens: 2, output_tokens: 1, total_tokens: 3 } } };
        await repository.complete(organizationId, id, { providerRequestId: id, occurredAt,
          totals: { requestCount: 1 }, ...transcription });
        if (expectedIds.length < 2) expectedIds.push(id);
      }
      const result = await new ProviderUsageRecordingRepository(pool).loadSharedTranscriptionCycle({
        externalScopeId: "proj-shared", cycleStartsAt: "2026-08-01T00:00:00.000Z", cycleEndsAt: "2026-08-02T00:00:00.000Z" });
      expect(result).toMatchObject({ complete: false, unresolvedRequestCount: 1, observations: [
        { id: expectedIds[0], organizationId: "tuzzy-test", model: "gpt-realtime-whisper", usage: { type: "duration", seconds: 0.1 } },
        { id: expectedIds[1], organizationId: "zara-ai-test", usage: { type: "tokens", total_tokens: 3 } },
      ] });
      expect(result.observations).toHaveLength(2);
    } finally { await pool.end(); }
  });
  it("rejects an observed request without a source identity", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      await expect(repository.beginObserved({ organizationId: "tuzzy-test", sessionId: "session-1",
        externalScopeId: "proj-shared", provider: "openai", model: "gpt-realtime-2.1",
        occurredAt: "2026-09-06T10:00:00.000Z" }, " ")).rejects.toThrow("Invalid observed provider usage request.");
      expect(await repository.listTenantRequests("tuzzy-test")).toEqual([]);
    } finally { await pool.end(); }
  });
  it("rejects invalid native counts before changing the stored result", async () => {
    const pool = usageRecordingTestPool();
    try {
      const recorder = new ProviderUsageRecordingRepository(pool);
      const id = await recorder.begin({ organizationId: "tuzzy-test", sessionId: "call-1", externalScopeId: "proj-shared",
        provider: "openai", model: "gpt-4.1", occurredAt: "2026-09-06T10:00:00.000Z" });
      for (const totals of [{ inputTokens: -1 }, { inputTokens: 0.5 }, {}]) {
        await expect(recorder.complete("tuzzy-test", id, { providerRequestId: "chatcmpl-1",
          occurredAt: "2026-09-06T10:00:01.000Z", totals })).rejects.toThrow("Invalid provider usage result.");
      }
      expect(await recorder.listTenantRequests("tuzzy-test")).toMatchObject([{ result: null }]);
    } finally { await pool.end(); }
  });
  it("rejects changed results and cross-tenant completion but permits exact retry", async () => {
    const pool = usageRecordingTestPool();
    try {
      const recorder = new ProviderUsageRecordingRepository(pool);
      const id = await recorder.begin({ organizationId: "tuzzy-test", sessionId: "call-1",
        externalScopeId: "proj-shared", provider: "openai", model: "gpt-4.1", occurredAt: "2026-09-06T10:00:00.000Z" });
      const result = { providerRequestId: "chatcmpl-1", occurredAt: "2026-09-06T10:00:01.000Z", totals: { inputTokens: 20 } };
      await expect(recorder.complete("other", id, result)).rejects.toThrow("Provider usage request not found.");
      expect(await recorder.listTenantRequests("tuzzy-test")).toMatchObject([{ result: null }]);
      await recorder.complete("tuzzy-test", id, result);
      await recorder.complete("tuzzy-test", id, result);
      await expect(recorder.complete("tuzzy-test", id, { ...result, totals: { inputTokens: 99 } }))
        .rejects.toThrow("Provider usage result changed.");
    } finally { await pool.end(); }
  });
  it("keeps a request and its provider counts across repository instances", async () => {
    const pool = usageRecordingTestPool();
    try {
      const recorder = new ProviderUsageRecordingRepository(pool);
      const id = await recorder.begin({ organizationId: "tuzzy-test", sessionId: "call-1",
        externalScopeId: "proj-shared", provider: "openai", model: "gpt-4.1", occurredAt: "2026-09-06T10:00:00.000Z" });
      await recorder.complete("tuzzy-test", id, { providerRequestId: "chatcmpl-1",
        occurredAt: "2026-09-06T10:00:01.000Z", totals: { inputTokens: 20, outputTokens: 5, requestCount: 1 } });
      expect(await new ProviderUsageRecordingRepository(pool).listTenantRequests("tuzzy-test"))
        .toMatchObject([{ id, sessionId: "call-1", result: { totals: { inputTokens: 20, outputTokens: 5, requestCount: 1 } } }]);
      expect(await recorder.listTenantRequests("zara-ai-test")).toEqual([]);
      const snapshot = await recorder.loadSharedCycle({ provider: "openai", externalScopeId: "proj-shared",
        cycleStartsAt: "2026-09-06T00:00:00.000Z", cycleEndsAt: "2026-09-07T00:00:00.000Z" });
      expect(snapshot).toMatchObject({ complete: false, observations: [{ id: "chatcmpl-1", organizationId: "tuzzy-test",
        totals: { inputTokens: 20, outputTokens: 5, requestCount: 1 } }] });
      expect((await recorder.loadSharedCycle({ provider: "openai", externalScopeId: "another-project",
        cycleStartsAt: "2026-09-06T00:00:00.000Z", cycleEndsAt: "2026-09-07T00:00:00.000Z" })).observations).toEqual([]);
    } finally { await pool.end(); }
  });
});
