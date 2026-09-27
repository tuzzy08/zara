import { describe, expect, it } from "vitest";
import { OpenAiRealtimeUsageRecorder } from "./openai-realtime-usage-recorder";
import { ProviderUsageRecordingRepository } from "./provider-usage-recording.repository";
import { usageRecordingTestPool } from "./provider-usage-recording.test-support";

const scope = { organizationId: "tuzzy-test", sessionId: "call-1", externalScopeId: "proj-shared",
  model: "gpt-realtime-2.1" };
const startedAt = "2026-09-06T10:00:00.000Z";

function responseEvent(type: string, status = "completed", usage: unknown = {
  input_tokens: 30, output_tokens: 7, total_tokens: 37,
}) {
  return JSON.stringify({ type, response: { id: "resp-1", status, usage,
    output: [{ content: [{ transcript: "Private caller text" }] }] } });
}

describe("OpenAI Realtime usage recording", () => {
  it.each([undefined, "23505"])("does not retry unclassified or permanent storage errors (%s)", async code => {
    const pool = usageRecordingTestPool();
    try {
      let failFirst = true;
      const database = { query: async (...args: Parameters<typeof pool.query>) => {
        if (failFirst && String(args[0]).startsWith("insert into provider_usage_requests")) {
          failFirst = false;
          throw Object.assign(new Error("permanent failure"), { code });
        }
        return pool.query(...args);
      } } as Pick<typeof pool, "query">;
      const recorder = new OpenAiRealtimeUsageRecorder(new ProviderUsageRecordingRepository(database), scope);
      await expect(recorder.record(responseEvent("response.done"))).rejects.toThrow("permanent failure");
      await expect(recorder.drain()).rejects.toThrow("Realtime usage capture is incomplete.");
      expect(await new ProviderUsageRecordingRepository(pool).listTenantRequests(scope.organizationId)).toEqual([]);
    } finally { await pool.end(); }
  });
  it("stops after one failed retry and permits later pending work to settle", async () => {
    const pool = usageRecordingTestPool();
    try {
      let failures = 2;
      const database = { query: async (...args: Parameters<typeof pool.query>) => {
        if (String(args[0]).startsWith("insert into provider_usage_requests") && failures-- > 0) {
          throw Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
        }
        return pool.query(...args);
      } } as Pick<typeof pool, "query">;
      const recorder = new OpenAiRealtimeUsageRecorder(new ProviderUsageRecordingRepository(database), scope, () => startedAt);
      await expect(recorder.record(responseEvent("response.done"))).rejects.toThrow("connection reset");
      await expect(recorder.drain()).rejects.toThrow("Realtime usage capture is incomplete.");
      const restarted = new ProviderUsageRecordingRepository(pool);
      expect(await restarted.listTenantRequests(scope.organizationId)).toEqual([]);
      await recorder.record(responseEvent("response.done"));
      await expect(recorder.drain()).rejects.toThrow("Realtime usage capture is incomplete.");
      expect(await restarted.listTenantRequests(scope.organizationId)).toHaveLength(1);
    } finally { await pool.end(); }
  });
  it("retries retained usage once after a transient storage failure while reporting incomplete capture", async () => {
    const pool = usageRecordingTestPool();
    try {
      let failFirst = true;
      const database = { query: async (...args: Parameters<typeof pool.query>) => {
        if (failFirst && String(args[0]).startsWith("insert into provider_usage_requests")) {
          failFirst = false;
          throw Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
        }
        return pool.query(...args);
      } } as Pick<typeof pool, "query">;
      const recorder = new OpenAiRealtimeUsageRecorder(new ProviderUsageRecordingRepository(database), scope, () => startedAt);
      await expect(recorder.record(responseEvent("response.done"))).rejects.toThrow("connection reset");
      await expect(recorder.drain()).rejects.toThrow("Realtime usage capture is incomplete.");
      expect(await new ProviderUsageRecordingRepository(pool).listTenantRequests(scope.organizationId)).toMatchObject([{ result: {
        providerRequestId: "resp-1", occurredAt: startedAt, totals: { inputTokens: 30, outputTokens: 7, requestCount: 1 },
      } }]);
    } finally { await pool.end(); }
  });
  it("saves independent responses while preserving receipt order for a blocked response", async () => {
    const pool = usageRecordingTestPool();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let blockFirst = true;
    const database = { query: async (...args: Parameters<typeof pool.query>) => {
      if (blockFirst && String(args[0]).startsWith("insert into provider_usage_requests")) {
        blockFirst = false;
        await gate;
      }
      return pool.query(...args);
    } } as Pick<typeof pool, "query">;
    let receipt = startedAt;
    const recorder = new OpenAiRealtimeUsageRecorder(new ProviderUsageRecordingRepository(database), scope, () => receipt);
    const first = recorder.record(responseEvent("response.created", "in_progress", null));
    receipt = "2026-09-07T00:00:00.000Z";
    const final = recorder.record(responseEvent("response.done"));
    const independent = recorder.record(responseEvent("response.done").replace('"resp-1"', '"resp-2"'));
    try {
      await new Promise(resolve => setImmediate(resolve));
      expect(await new ProviderUsageRecordingRepository(pool).listTenantRequests(scope.organizationId))
        .toMatchObject([{ result: { providerRequestId: "resp-2" } }]);
    } finally {
      release();
      await Promise.all([first, final, independent]);
    }
    try {
      await recorder.drain();
      const rows = await new ProviderUsageRecordingRepository(pool).listTenantRequests(scope.organizationId);
      expect(rows.find(row => row.result?.providerRequestId === "resp-1")?.result?.occurredAt).toBe(startedAt);
      expect(rows).toHaveLength(2);
    } finally { await pool.end(); }
  });
  it("retains final usage after a committed insert loses its acknowledgement", async () => {
    const pool = usageRecordingTestPool();
    try {
      let loseAcknowledgement = true;
      const database = { query: async (...args: Parameters<typeof pool.query>) => {
        const result = await pool.query(...args);
        if (loseAcknowledgement && String(args[0]).startsWith("insert into provider_usage_requests")) {
          loseAcknowledgement = false;
          throw new Error("connection closed after commit");
        }
        return result;
      } } as Pick<typeof pool, "query">;
      const recorder = new OpenAiRealtimeUsageRecorder(new ProviderUsageRecordingRepository(database), scope, () => startedAt);
      await expect(recorder.record(responseEvent("response.done"))).rejects.toThrow("connection closed after commit");
      const restarted = new ProviderUsageRecordingRepository(pool);
      expect(await restarted.listTenantRequests(scope.organizationId)).toMatchObject([{ result: {
        providerRequestId: "resp-1", occurredAt: startedAt,
        totals: { inputTokens: 30, outputTokens: 7, requestCount: 1 },
      } }]);
      const replay = new OpenAiRealtimeUsageRecorder(restarted, scope, () => "2026-09-07T12:00:00.000Z");
      await replay.record(responseEvent("response.done"));
      expect(await restarted.listTenantRequests(scope.organizationId)).toHaveLength(1);
    } finally { await pool.end(); }
  });
  it("can replay a retained usage event after a failed final write without moving it across midnight", async () => {
    const pool = usageRecordingTestPool();
    try {
      const firstReceipt = "2026-09-08T23:59:59.999Z";
      const repository = new ProviderUsageRecordingRepository(pool);
      const connectionId = await repository.beginConnection({ ...scope, provider: "openai", occurredAt: firstReceipt,
        callSessionId: "phone-call-1" });
      let failWrite = true;
      const database = { query: async (...args: Parameters<typeof pool.query>) => {
        if (failWrite && String(args[0]).startsWith("update provider_usage_requests")) {
          failWrite = false;
          throw new Error("database unavailable");
        }
        return pool.query(...args);
      } } as Pick<typeof pool, "query">;
      const recorder = new OpenAiRealtimeUsageRecorder(new ProviderUsageRecordingRepository(database),
        { ...scope, connectionId }, () => firstReceipt);
      await recorder.record(responseEvent("response.created", "in_progress", null));
      const retainedEvent = responseEvent("response.done");
      await expect(recorder.record(retainedEvent)).rejects.toThrow("database unavailable");
      await expect(recorder.drain()).rejects.toThrow("Realtime usage capture is incomplete.");

      const restarted = new ProviderUsageRecordingRepository(pool);
      const nextDay = { provider: "openai", externalScopeId: "proj-shared",
        cycleStartsAt: "2026-09-09T00:00:00.000Z", cycleEndsAt: "2026-09-10T00:00:00.000Z" };
      expect(await restarted.loadSharedCycle(nextDay))
        .toMatchObject({ complete: false, unresolvedRequestCount: 1, observations: [] });
      // The test retains the original provider event. Production does not have a durable event replay source.
      const replay = new OpenAiRealtimeUsageRecorder(restarted, { ...scope, connectionId }, () => nextDay.cycleStartsAt);
      await replay.record(retainedEvent);
      await replay.record(retainedEvent);
      expect(await restarted.loadSharedCycle({ ...nextDay, cycleStartsAt: "2026-09-08T00:00:00.000Z",
        cycleEndsAt: nextDay.cycleStartsAt })).toMatchObject({ complete: false, unresolvedRequestCount: 0, observations: [
        { id: "resp-1", occurredAt: firstReceipt, connectionId, callSessionId: "phone-call-1",
          totals: { inputTokens: 30, outputTokens: 7, requestCount: 1 } },
      ] });
      expect(await restarted.loadSharedCycle(nextDay))
        .toMatchObject({ complete: false, unresolvedRequestCount: 0, observations: [] });
      expect(await restarted.loadSharedConnectionCycle(nextDay))
        .toMatchObject({ complete: false, connections: [{ id: connectionId, result: null }] });
      expect(await restarted.listTenantRequests("zara-ai-test")).toEqual([]);
    } finally { await pool.end(); }
  });
  it("does not certify a drained queue after a storage or parsing failure", async () => {
    const repository = new ProviderUsageRecordingRepository({ query: async () => { throw new Error("storage failure"); } });
    const recorder = new OpenAiRealtimeUsageRecorder(repository, { organizationId: "tuzzy-test", sessionId: "session-1",
      externalScopeId: "proj-shared", model: "gpt-realtime-2.1" });
    await expect(recorder.record(JSON.stringify({ type: "response.created", response: { id: "resp-1" } }))).rejects.toThrow();
    await expect(recorder.drain()).rejects.toThrow("Realtime usage capture is incomplete.");
    const invalid = new OpenAiRealtimeUsageRecorder(repository, { organizationId: "tuzzy-test", sessionId: "session-1",
      externalScopeId: "proj-shared", model: "gpt-realtime-2.1" });
    await expect(invalid.record(JSON.stringify({ type: "session.created", session: {} }))).rejects.toThrow();
    await expect(invalid.drain()).rejects.toThrow("Realtime usage capture is incomplete.");
  });
  it("keeps content parts distinct and rejects changed usage, tenant, or model on replay", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const recorderScope = { ...scope, transcriptionModel: "gpt-realtime-whisper" };
      const sessionCreated = JSON.stringify({ type: "session.created", session: { id: "sess-1" } });
      const event = (contentIndex: number, seconds = 2.5) => JSON.stringify({
        type: "conversation.item.input_audio_transcription.completed", item_id: "item-1", content_index: contentIndex,
        usage: { type: "duration", seconds }, transcript: "Private caller text",
      });
      const recorder = new OpenAiRealtimeUsageRecorder(repository, recorderScope, () => startedAt);
      await recorder.record(sessionCreated);
      await recorder.record(event(0));
      await recorder.record(event(1));
      const replay = new OpenAiRealtimeUsageRecorder(repository, recorderScope, () => "2026-09-07T12:00:00.000Z");
      await replay.record(sessionCreated);
      await replay.record(event(0));
      await expect(replay.record(event(0, 3.5))).rejects.toThrow("Provider usage result changed.");
      for (const changed of [{ ...recorderScope, organizationId: "zara-ai-test" },
        { ...recorderScope, transcriptionModel: "different-model" }]) {
        const changedRecorder = new OpenAiRealtimeUsageRecorder(repository, changed);
        await changedRecorder.record(sessionCreated);
        await expect(changedRecorder.record(event(0))).rejects.toThrow("Provider usage request identity changed.");
      }
      const rows = await repository.listTenantRequests(scope.organizationId);
      expect(rows).toHaveLength(2);
      expect(rows.every(row => row.result?.occurredAt === startedAt)).toBe(true);
    } finally { await pool.end(); }
  });
  it("rejects transcription without server-owned model and provider session identity", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const raw = JSON.stringify({ type: "conversation.item.input_audio_transcription.completed",
        item_id: "item-1", content_index: 0, usage: { type: "duration", seconds: 2.5 } });
      await expect(new OpenAiRealtimeUsageRecorder(repository, scope).record(raw))
        .rejects.toThrow("Realtime transcription model is missing.");
      const recorder = new OpenAiRealtimeUsageRecorder(repository, { ...scope, transcriptionModel: "gpt-realtime-whisper" });
      await expect(recorder.record(raw)).rejects.toThrow("Realtime provider session identity is missing.");
      await recorder.record(JSON.stringify({ type: "session.created", session: { id: "sess-1" } }));
      await expect(recorder.record(JSON.stringify({ type: "session.created", session: { id: "sess-changed" } })))
        .rejects.toThrow("Invalid Realtime provider session identity.");
      expect(await repository.listTenantRequests(scope.organizationId)).toEqual([]);
    } finally { await pool.end(); }
  });
  it("keeps missing or malformed transcription usage unresolved", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const recorder = new OpenAiRealtimeUsageRecorder(repository, { ...scope, transcriptionModel: "gpt-realtime-whisper" });
      await recorder.record(JSON.stringify({ type: "session.created", session: { id: "sess-1" } }));
      const tokens = { type: "tokens", input_tokens: 24, output_tokens: 6, total_tokens: 30 };
      const invalidUsage = [undefined, null, {}, { type: "duration", seconds: -0.5 },
        { type: "duration", seconds: "2.5" }, { ...tokens, input_tokens: 1.5 },
        { ...tokens, total_tokens: 99 }, { ...tokens, input_token_details: "private-text" },
        { ...tokens, input_token_details: { audio_tokens: -1 } },
        { ...tokens, input_token_details: { audio_tokens: 25 } },
        { ...tokens, input_token_details: { audio_tokens: 20, text_tokens: 10 } }];
      for (const [index, usage] of invalidUsage.entries()) {
        await recorder.record(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed",
          item_id: `item-invalid-${index}`, content_index: 0, usage }));
      }
      const rows = await repository.listTenantRequests(scope.organizationId);
      expect(rows).toHaveLength(11);
      expect(rows.every(row => row.result === null)).toBe(true);
    } finally { await pool.end(); }
  });
  it("keeps failed transcription unresolved without storing its error or making zero usage", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const recorder = new OpenAiRealtimeUsageRecorder(repository, { ...scope, transcriptionModel: "gpt-realtime-whisper" });
      await recorder.record(JSON.stringify({ type: "session.created", session: { id: "sess-1" } }));
      await recorder.record(JSON.stringify({ type: "conversation.item.input_audio_transcription.failed",
        item_id: "item-failed", content_index: 0, error: { message: "private-secret" },
        usage: { type: "duration", seconds: 0 } }));
      const rows = await repository.listTenantRequests(scope.organizationId);
      expect(rows).toMatchObject([{ model: "gpt-realtime-whisper", result: null }]);
      expect(JSON.stringify(rows)).not.toContain("private-secret");
    } finally { await pool.end(); }
  });
  it("separates reused item IDs across provider sessions and deduplicates a session replay", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const raw = JSON.stringify({ type: "conversation.item.input_audio_transcription.completed",
        item_id: "item-reused", content_index: 0, usage: { type: "duration", seconds: 2.5 } });
      for (const providerSessionId of ["sess-1", "sess-2", "sess-1"]) {
        const recorder = new OpenAiRealtimeUsageRecorder(repository,
          { ...scope, transcriptionModel: "gpt-realtime-whisper" }, () => startedAt);
        await recorder.record(JSON.stringify({ type: "session.created", session: { id: providerSessionId } }));
        await recorder.record(raw);
      }
      expect(await repository.listTenantRequests(scope.organizationId)).toHaveLength(2);
    } finally { await pool.end(); }
  });
  it("preserves fractional transcription seconds without rounding or deriving tokens", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const recorder = new OpenAiRealtimeUsageRecorder(repository,
        { ...scope, transcriptionModel: "gpt-realtime-whisper" }, () => startedAt);
      await recorder.record(JSON.stringify({ type: "session.created", session: { id: "sess-1" } }));
      await recorder.record(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed",
        item_id: "item-duration", content_index: 0, usage: { type: "duration", seconds: 1.23456789 } }));
      const rows = await repository.listTenantRequests(scope.organizationId);
      expect(rows[0]?.result).toEqual({ providerRequestId: 'realtime-transcription:["sess-1","item-duration",0]',
        occurredAt: startedAt, sourceKind: "realtime_transcription", totals: { transcriptionRequestCount: 1 },
        transcription: { providerSessionId: "sess-1", itemId: "item-duration", contentIndex: 0,
          usage: { type: "duration", seconds: 1.23456789 } },
      });
    } finally { await pool.end(); }
  });
  it("stores transcription tokens separately from voice responses without storing caller text", async () => {
    const pool = usageRecordingTestPool();
    try {
      const repository = new ProviderUsageRecordingRepository(pool);
      const recorder = new OpenAiRealtimeUsageRecorder(repository,
        { ...scope, transcriptionModel: "gpt-realtime-whisper" }, () => startedAt);
      await recorder.record(JSON.stringify({ type: "session.created", session: { id: "sess-1" } }));
      await recorder.record(JSON.stringify({
        type: "conversation.item.input_audio_transcription.completed", event_id: "event-transcription-1",
        item_id: "item-1", content_index: 0, transcript: "Private caller text", logprobs: [{ token: "private" }],
        usage: { type: "tokens", input_tokens: 24, output_tokens: 6, total_tokens: 30,
          input_token_details: { audio_tokens: 20, text_tokens: 4, secret: "do-not-store" } },
      }));
      const rows = await repository.listTenantRequests(scope.organizationId);
      expect(rows).toMatchObject([{ provider: "openai", model: "gpt-realtime-whisper", sessionId: "call-1",
        result: { sourceKind: "realtime_transcription", totals: { transcriptionRequestCount: 1 },
          transcription: { itemId: "item-1", contentIndex: 0,
            usage: { type: "tokens", input_tokens: 24, output_tokens: 6, total_tokens: 30,
              input_token_details: { audio_tokens: 20, text_tokens: 4 } } },
        },
      }]);
      expect(JSON.stringify(rows)).not.toMatch(/Private caller text|do-not-store|logprobs/);
      expect(await repository.listTenantRequests("zara-ai-test")).toEqual([]);
      expect(await repository.loadSharedCycle({ provider: "openai", externalScopeId: "proj-shared",
        cycleStartsAt: "2026-09-06T00:00:00.000Z", cycleEndsAt: "2026-09-07T00:00:00.000Z" }))
        .toMatchObject({ complete: false, observations: [] });
    } finally { await pool.end(); }
  });
  it("bounds pending writes when the database is slow", async () => {
    const pool = usageRecordingTestPool();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const database = { query: async (...args: Parameters<typeof pool.query>) => {
      await gate;
      return pool.query(...args);
    } } as Pick<typeof pool, "query">;
    const recorder = new OpenAiRealtimeUsageRecorder(new ProviderUsageRecordingRepository(database), scope);
    const pending = Array.from({ length: 128 }, (_, index) => recorder.record(JSON.stringify({
      type: "response.created", response: { id: `resp-${index}` },
    })));
    let outcome = "pending";
    const overflow = recorder.record(responseEvent("response.created"))
      .then(() => { outcome = "accepted"; }, error => { outcome = error.message; });
    try {
      await new Promise(resolve => setImmediate(resolve));
      expect(outcome).toBe("Realtime usage queue is full.");
    } finally {
      release();
      await Promise.all([...pending, overflow]);
      await pool.end();
    }
  });
  it("ignores unrelated messages and rejects usage messages without a bounded response identity", async () => {
    const pool = usageRecordingTestPool();
    try {
      const recorder = new OpenAiRealtimeUsageRecorder(new ProviderUsageRecordingRepository(pool), scope);
      for (const raw of ["null", "{", responseEvent("response.output_audio.delta")]) {
        await expect(recorder.record(raw)).resolves.toBeUndefined();
      }
      for (const id of [undefined, "", " ", 123, "r".repeat(513)]) {
        await expect(recorder.record(JSON.stringify({ type: "response.done", response: { id } })))
          .rejects.toThrow("Invalid Realtime usage identity.");
      }
      expect(await new ProviderUsageRecordingRepository(pool).listTenantRequests(scope.organizationId)).toEqual([]);
    } finally { await pool.end(); }
  });
  it("leaves invalid status or native detail counters unresolved", async () => {
    const pool = usageRecordingTestPool();
    try {
      const recorder = new OpenAiRealtimeUsageRecorder(new ProviderUsageRecordingRepository(pool), scope, () => startedAt);
      await recorder.record(responseEvent("response.done", "in_progress"));
      expect(await new ProviderUsageRecordingRepository(pool).listTenantRequests(scope.organizationId))
        .toMatchObject([{ result: null }]);
      await recorder.record(responseEvent("response.done", "completed", {
        input_tokens: 30, output_tokens: 7, total_tokens: 37,
        input_token_details: { cached_tokens: -1 },
      }));
      expect(await new ProviderUsageRecordingRepository(pool).listTenantRequests(scope.organizationId))
        .toMatchObject([{ result: null }]);
    } finally { await pool.end(); }
  });
  it.each(["completed", "cancelled", "failed", "incomplete"])("retains native details for a %s response without adding cached tokens twice", async status => {
    const pool = usageRecordingTestPool();
    try {
      const recorder = new OpenAiRealtimeUsageRecorder(new ProviderUsageRecordingRepository(pool), scope, () => startedAt);
      await recorder.record(responseEvent("response.done", status, {
        input_tokens: 30, output_tokens: 7, total_tokens: 37,
        input_token_details: { text_tokens: 20, audio_tokens: 10, cached_tokens: 12,
          cached_tokens_details: { text_tokens: 8, audio_tokens: 4 }, secret: "do-not-store" },
        output_token_details: { text_tokens: 2, audio_tokens: 5 },
      }));
      const rows = await new ProviderUsageRecordingRepository(pool).listTenantRequests("tuzzy-test");
      expect(rows[0]?.result).toMatchObject({ responseStatus: status,
        totals: { inputTokens: 30, outputTokens: 7, requestCount: 1 },
        breakdown: { inputTextTokens: 20, inputAudioTokens: 10, cachedInputTokens: 12,
          cachedInputTextTokens: 8, cachedInputAudioTokens: 4, outputTextTokens: 2, outputAudioTokens: 5 },
      });
      expect(rows[0]?.result?.totals).toEqual({ inputTokens: 30, outputTokens: 7, requestCount: 1 });
      expect(JSON.stringify(rows)).not.toContain("do-not-store");
    } finally { await pool.end(); }
  });
  it.each([undefined, null, {}, { input_tokens: -1, output_tokens: 7, total_tokens: 6 },
    { input_tokens: 30, output_tokens: 7, total_tokens: 99 }, { input_tokens: 0.5, output_tokens: 1, total_tokens: 1.5 }])(
    "keeps missing or invalid provider usage unresolved (%j)", async usage => {
      const pool = usageRecordingTestPool();
      try {
        const recorder = new OpenAiRealtimeUsageRecorder(new ProviderUsageRecordingRepository(pool), scope, () => startedAt);
        await recorder.record(JSON.stringify({ type: "response.done", response: { id: "resp-1", status: "completed", usage } }));
        expect(await new ProviderUsageRecordingRepository(pool).listTenantRequests("tuzzy-test"))
          .toMatchObject([{ result: null }]);
      } finally { await pool.end(); }
    });
  it("does not duplicate a replay after the recorder is recreated", async () => {
    const pool = usageRecordingTestPool();
    try {
      await new OpenAiRealtimeUsageRecorder(new ProviderUsageRecordingRepository(pool), scope, () => startedAt)
        .record(responseEvent("response.done"));
      const replay = new OpenAiRealtimeUsageRecorder(new ProviderUsageRecordingRepository(pool), scope,
        () => "2026-09-07T12:00:00.000Z");
      await replay.record(responseEvent("response.done"));
      const rows = await new ProviderUsageRecordingRepository(pool).listTenantRequests("tuzzy-test");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.result?.occurredAt).toBe(startedAt);
      await expect(replay.record(responseEvent("response.done", "completed",
        { input_tokens: 99, output_tokens: 7, total_tokens: 106 }))).rejects.toThrow("Provider usage result changed.");
    } finally { await pool.end(); }
  });
  it("saves native response usage under the server tenant and session", async () => {
    const pool = usageRecordingTestPool();
    try {
      const recorder = new OpenAiRealtimeUsageRecorder(new ProviderUsageRecordingRepository(pool), scope, () => startedAt);
      await recorder.record(responseEvent("response.created", "in_progress", null));
      await recorder.record(responseEvent("response.done"));
      const rows = await new ProviderUsageRecordingRepository(pool).listTenantRequests("tuzzy-test");
      expect(rows).toMatchObject([{ sessionId: "call-1", externalScopeId: "proj-shared", result: {
        providerRequestId: "resp-1", occurredAt: startedAt,
        totals: { inputTokens: 30, outputTokens: 7, requestCount: 1 }, responseStatus: "completed",
      } }]);
      expect(JSON.stringify(rows)).not.toContain("Private caller text");
      expect(await new ProviderUsageRecordingRepository(pool).listTenantRequests("zara-ai-test")).toEqual([]);
    } finally { await pool.end(); }
  });
});
