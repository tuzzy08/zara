import { describe, expect, it, vi } from "vitest";

import { AssemblyAiSttProvider } from "./assemblyai-stt.provider";
import { ProviderUsageRecordingRepository } from "../billing/provider-usage-recording.repository";
import { usageRecordingTestPool } from "../billing/provider-usage-recording.test-support";

describe("AssemblyAiSttProvider", () => {
  it("reports readiness only after the provider confirms its session", () => {
    const connection = new FakeAssemblySocketConnection();
    const ready: string[] = [];
    const input = {
      sampleRateHz: 8_000,
      encoding: "pcm_mulaw" as const,
      onFinal() {},
      onReady: (id: string) => ready.push(id),
    };
    const stream = new AssemblyAiSttProvider({ apiKey: "test-key", websocketFactory: () => connection })
      .createStreamingSession(input);
    connection.open();
    expect(ready).toEqual([]);
    connection.message({ type: "Begin", id: "pstn-provider-session" });
    expect(ready).toEqual(["pstn-provider-session"]);
    stream.terminate();
    connection.close();
  });

  it("stores native session duration under the trusted tenant and session without transcript text", async () => {
    const pool = usageRecordingTestPool();
    try {
      const connection = new FakeAssemblySocketConnection();
      const repository = new ProviderUsageRecordingRepository(pool);
      let connected = false;
      const provider = new AssemblyAiSttProvider({ apiKey: "secret-test-key", usageRecorder: repository,
        websocketFactory: () => { connected = true; return connection; } });
      const stream = provider.createStreamingSession({ sampleRateHz: 16_000,
        usageScope: { organizationId: "tenant-a", sessionId: "sandbox-a" }, onFinal() {} });
      await vi.waitFor(() => expect(connected).toBe(true));
      expect(await repository.listTenantConnections("tenant-a")).toMatchObject([{ sessionId: "sandbox-a", result: null }]);
      connection.open();
      connection.message({ type: "Begin", id: "assembly-session-a" });
      connection.message({ type: "Turn", transcript: "Private transcript", end_of_turn: true });
      stream.terminate();
      connection.message({ type: "Termination", audio_duration_seconds: 13, session_duration_seconds: 20 });
      connection.close();
      await vi.waitFor(async () => expect(await repository.listTenantRequests("tenant-a"))
        .toMatchObject([{ provider: "assemblyai", sessionId: "sandbox-a", result: {
          providerRequestId: "assembly-session-a", totals: { audioDurationSeconds: 13, sessionDurationSeconds: 20 },
        } }]));
      await vi.waitFor(async () => expect(await repository.listTenantConnections("tenant-a"))
        .toMatchObject([{ result: { outcome: "closed", providerSessionId: "assembly-session-a" } }]));
      expect(await repository.listTenantRequests("tenant-b")).toEqual([]);
      expect(JSON.stringify(await repository.listTenantRequests("tenant-a"))).not.toMatch(/Private transcript|secret-test-key/);
    } finally { await pool.end(); }
  });

  it("records usage for a scoped one-turn transcription", async () => {
    const pool = usageRecordingTestPool();
    try {
      const connection = new FakeAssemblySocketConnection();
      let connected = false;
      const provider = new AssemblyAiSttProvider({ apiKey: "test-key", usageRecorder: new ProviderUsageRecordingRepository(pool),
        websocketFactory: () => { connected = true; return connection; } });
      const result = provider.transcribeTurn({ audioFramesBase64: [], sampleRateHz: 16_000,
        usageScope: { organizationId: "tenant-a", sessionId: "one-turn-a" } });
      const outcome = result.then(value => value, error => error);
      await vi.waitFor(() => expect(connected).toBe(true));
      connection.open();
      connection.message({ type: "Begin", id: "one-turn-provider" });
      connection.message({ type: "Turn", transcript: "Hello", end_of_turn: true });
      expect(await outcome).toMatchObject({ transcript: "Hello" });
      connection.message({ type: "Termination", audio_duration_seconds: 2, session_duration_seconds: 4 });
      connection.close();
      await vi.waitFor(async () => expect(await new ProviderUsageRecordingRepository(pool).listTenantRequests("tenant-a"))
        .toMatchObject([{ sessionId: "one-turn-a", result: { totals: { sessionDurationSeconds: 4 } } }]));
    } finally { await pool.end(); }
  });

  it.each([undefined, { type: "Termination", audio_duration_seconds: 13 },
    { type: "Termination", audio_duration_seconds: 13, session_duration_seconds: -1 },
    { type: "Termination", audio_duration_seconds: 13, session_duration_seconds: 1.5 }])(
    "keeps missing or invalid native duration unresolved (%j)", async termination => {
      const pool = usageRecordingTestPool();
      try {
        const connection = new FakeAssemblySocketConnection();
        const recorder = new ProviderUsageRecordingRepository(pool);
        let connected = false;
        const stream = new AssemblyAiSttProvider({ apiKey: "test-key", usageRecorder: recorder,
          websocketFactory: () => { connected = true; return connection; } })
          .createStreamingSession({ sampleRateHz: 16_000, usageScope: { organizationId: "tenant-a", sessionId: "failed-session" }, onFinal() {} });
        await vi.waitFor(() => expect(connected).toBe(true));
        connection.open();
        connection.message({ type: "Begin", id: "assembly-failed-session" });
        stream.terminate();
        if (termination !== undefined) connection.message(termination);
        connection.close();
        await vi.waitFor(async () => expect(await recorder.listTenantConnections("tenant-a"))
          .toMatchObject([{ result: { outcome: "failed" } }]));
        expect(await recorder.listTenantRequests("tenant-a")).toMatchObject([{ result: null }]);
      } finally { await pool.end(); }
    });

  it("does not open the provider connection when the start record cannot be saved", async () => {
    const errors: string[] = [];
    let connected = false;
    const recorder = new ProviderUsageRecordingRepository({ query: async () => { throw new Error("private database error"); } });
    new AssemblyAiSttProvider({ apiKey: "test-key", usageRecorder: recorder,
      websocketFactory: () => { connected = true; return new FakeAssemblySocketConnection(); } })
      .createStreamingSession({ sampleRateHz: 16_000, usageScope: { organizationId: "tenant-a", sessionId: "start-failed" },
        onFinal() {}, onError: error => errors.push(error.message) });
    await vi.waitFor(() => expect(errors).toEqual(["AssemblyAI usage recording could not start."]));
    expect(connected).toBe(false);
  });

  it("waits for native termination usage after the caller stops the stream", () => {
    const connection = new FakeAssemblySocketConnection();
    const usage: unknown[] = [];
    const provider = new AssemblyAiSttProvider({
      apiKey: "assembly-test-key",
      websocketFactory: () => connection,
    });
    const stream = provider.createStreamingSession({
      sampleRateHz: 16_000,
      onFinal() {},
      onUsage: (event) => usage.push(event),
    });
    connection.open();
    connection.message({ type: "Begin", id: "assembly-session-1" });
    stream.terminate();
    expect(connection.closed).toBe(false);
    connection.message({ type: "Termination", audio_duration_seconds: 13, session_duration_seconds: 20 });
    expect(usage).toEqual([{
      providerSessionId: "assembly-session-1", audioDurationSeconds: 13, sessionDurationSeconds: 20,
    }]);
    connection.close();
  });

  it("terminates once after opening when stopped before connection establishment", () => {
    const connection = new FakeAssemblySocketConnection();
    const stream = new AssemblyAiSttProvider({ apiKey: "assembly-test-key", websocketFactory: () => connection })
      .createStreamingSession({ sampleRateHz: 16_000, onFinal() {} });
    stream.appendAudioFrame(Buffer.from("discard").toString("base64"));
    stream.forceEndpoint();
    stream.terminate();
    stream.close();
    connection.open();
    stream.appendAudioFrame(Buffer.from("discard-late").toString("base64"));
    stream.forceEndpoint();
    stream.updateConfiguration({ agentContext: "discard" });
    expect(connection.sentMessages).toEqual(['{"type":"Terminate"}']);
    expect(connection.sentBuffers).toEqual([]);
    connection.close();
  });

  it("closes a stopped stream after five seconds without inventing missing usage", () => {
    vi.useFakeTimers();
    try {
      const connection = new FakeAssemblySocketConnection();
      const usage: unknown[] = [];
      const errors: string[] = [];
      const stream = new AssemblyAiSttProvider({ apiKey: "assembly-test-key", websocketFactory: () => connection })
        .createStreamingSession({ sampleRateHz: 16_000, onFinal() {}, onUsage: event => usage.push(event),
          onError: error => errors.push(error.message) });
      connection.open();
      stream.terminate();
      vi.advanceTimersByTime(5_000);
      expect(connection.closed).toBe(true);
      expect(usage).toEqual([]);
      expect(errors).toEqual(["AssemblyAI termination usage was not received."]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not emit new turns while waiting for termination usage", () => {
    const connection = new FakeAssemblySocketConnection();
    const finals: string[] = [];
    const stream = new AssemblyAiSttProvider({ apiKey: "test-key", websocketFactory: () => connection })
      .createStreamingSession({ sampleRateHz: 16_000, onFinal: event => finals.push(event.transcript) });
    connection.open();
    stream.terminate();
    connection.message({ type: "Turn", transcript: "Late final", end_of_turn: true });
    expect(finals).toEqual([]);
    connection.close();
  });

  it("streams buffered audio frames and resolves the final transcript", async () => {
    const connection = new FakeAssemblySocketConnection();
    const provider = new AssemblyAiSttProvider({
      apiKey: "assembly-test-key",
      websocketFactory: () => connection,
    });
    const partials: string[] = [];
    const transcribePromise = provider.transcribeTurn({
      audioFramesBase64: [Buffer.from("frame-1").toString("base64")],
      sampleRateHz: 16_000,
      onPartial(event) {
        partials.push(event.transcript);
      },
    });

    connection.open();
    connection.message({
      type: "Turn",
      transcript: "I need help",
      utterance: "",
      end_of_turn: false,
      words: [{ confidence: 0.9 }],
    });
    connection.message({
      type: "Turn",
      transcript: "I need help with billing",
      utterance: "I need help with billing",
      end_of_turn: true,
      words: [{ confidence: 0.91 }, { confidence: 0.92 }],
    });

    const result = await transcribePromise;

    expect(partials).toEqual(["I need help"]);
    expect(connection.sentBuffers).toHaveLength(1);
    expect(connection.sentMessages).toContain("{\"type\":\"ForceEndpoint\"}");
    expect(connection.sentMessages.at(-1)).toBe("{\"type\":\"Terminate\"}");
    expect(result).toMatchObject({
      transcript: "I need help with billing",
      language: "en",
    });
  });

  it("keeps a live AssemblyAI stream open and emits final turns from provider endpointing", async () => {
    const connection = new FakeAssemblySocketConnection();
    const provider = new AssemblyAiSttProvider({
      apiKey: "assembly-test-key",
      websocketFactory: () => connection,
    });
    const partials: string[] = [];
    const finals: string[] = [];
    const errors: string[] = [];

    const stream = provider.createStreamingSession({
      sampleRateHz: 16_000,
      onPartial(event) {
        partials.push(event.transcript);
      },
      onFinal(event) {
        finals.push(event.transcript);
      },
      onError(error) {
        errors.push(error.message);
      },
    });

    stream.appendAudioFrame(Buffer.from("frame-before-open").toString("base64"));
    expect(connection.sentBuffers).toHaveLength(0);

    connection.open();
    stream.appendAudioFrame(Buffer.from("frame-after-open").toString("base64"));
    connection.message({
      type: "Turn",
      transcript: "I need help",
      utterance: "",
      end_of_turn: false,
      words: [{ confidence: 0.88 }],
    });
    connection.message({
      type: "Turn",
      transcript: "I need help with billing",
      utterance: "I need help with billing",
      end_of_turn: true,
      words: [{ confidence: 0.91 }],
    });

    expect(connection.sentBuffers.map((buffer) => buffer.toString("utf8"))).toEqual([
      "frame-before-open",
      "frame-after-open",
    ]);
    expect(partials).toEqual(["I need help"]);
    expect(finals).toEqual(["I need help with billing"]);
    expect(errors).toEqual([]);

    stream.forceEndpoint();
    expect(connection.sentMessages.at(-1)).toBe("{\"type\":\"ForceEndpoint\"}");

    connection.message({
      type: "Turn",
      transcript: "I need follow-up help",
      utterance: "I need follow-up help",
      end_of_turn: true,
      words: [{ confidence: 0.9 }],
    });

    expect(finals).toEqual(["I need help with billing", "I need follow-up help"]);

    stream.close();
    expect(connection.sentMessages.at(-1)).toBe("{\"type\":\"Terminate\"}");
  });

  it("sends UpdateConfiguration messages while a live stream remains open", () => {
    const connection = new FakeAssemblySocketConnection();
    const provider = new AssemblyAiSttProvider({
      apiKey: "assembly-test-key",
      websocketFactory: () => connection,
    });
    const stream = provider.createStreamingSession({
      sampleRateHz: 16_000,
      config: {
        languageCode: "en",
        keytermsPrompt: ["Zara AI"],
        minTurnSilenceMs: 224,
        maxTurnSilenceMs: 1536,
        continuousPartials: true,
      },
      onFinal() {},
    });

    connection.open();
    stream.updateConfiguration({
      agentContext: "Sure, I can check that ticket.",
      keytermsPrompt: ["ticket", "Zendesk"],
      minTurnSilenceMs: 300,
    });

    expect(connection.sentMessages.at(-1)).toBe(JSON.stringify({
      type: "UpdateConfiguration",
      keyterms_prompt: ["ticket", "Zendesk"],
      min_turn_silence: 300,
      agent_context: "Sure, I can check that ticket.",
    }));
  });


  it("opens PSTN streams with native mu-law 8 kHz metadata", () => {
    const connection = new FakeAssemblySocketConnection();
    const openedUrls: string[] = [];
    const provider = new AssemblyAiSttProvider({
      apiKey: "assembly-test-key",
      websocketFactory: (url) => {
        openedUrls.push(url);
        return connection;
      },
    });

    provider.createStreamingSession({
      sampleRateHz: 8_000,
      encoding: "pcm_mulaw",
      onFinal() {},
    });

    expect(openedUrls[0]).toBe(
      "wss://streaming.assemblyai.com/v3/ws?sample_rate=8000&speech_model=u3-rt-pro&encoding=pcm_mulaw&min_turn_silence=300&max_turn_silence=1000",
    );
  });
});

class FakeAssemblySocketConnection {
  closed = false;
  sentMessages: string[] = [];
  sentBuffers: Buffer[] = [];
  private readonly listeners = new Map<string, Array<(value: unknown, reason?: Buffer) => void>>();

  on(event: string, listener: (value: unknown, reason?: Buffer) => void) {
    const current = this.listeners.get(event) ?? [];
    current.push(listener);
    this.listeners.set(event, current);
  }

  send(message: string | Buffer) {
    if (typeof message === "string") {
      this.sentMessages.push(message);
      return;
    }

    this.sentBuffers.push(message);
  }

  close(code?: number, reason?: string) {
    this.closed = true;
    this.emit("close", code ?? 1000, Buffer.from(reason ?? ""));
  }

  open() {
    this.emit("open", undefined);
  }

  message(payload: Record<string, unknown>) {
    this.emit("message", Buffer.from(JSON.stringify(payload), "utf8"));
  }

  error(error: Error) {
    this.emit("error", error);
  }

  private emit(event: string, value: unknown, reason?: Buffer) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(value, reason);
    }
  }
}
