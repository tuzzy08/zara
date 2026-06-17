import { describe, expect, it } from "vitest";
import type {
  CompiledRuntimeManifest,
  PstnSandwichTtsInput,
  VoiceAgentRole,
} from "@zara/core";
import { RuntimeProviderFailure } from "@zara/core";

import { CartesiaTtsProvider } from "./cartesia-tts.provider";

describe("CartesiaTtsProvider", () => {
  it("sends a Sonic 3.5 generation request and returns the streamed audio chunks", async () => {
    const connection = new FakeWebSocketConnection();
    const provider = new CartesiaTtsProvider({
      apiKey: "cartesia-test-key",
      apiVersion: "2026-03-01",
      websocketFactory: () => connection,
    });
    const synthesizePromise = provider.synthesize({
      manifest: createManifest(),
      activeRole: createRole(),
      text: "Billing support is ready to help.",
      language: "en",
      voiceProfile: "economy",
      context: {
        callPhase: "discovery",
        language: "en",
      },
    });

    connection.open();
    connection.message({
      type: "chunk",
      data: "YXVkaW8tY2h1bmstMQ==",
      done: false,
      step_time: 84,
      context_id: "ctx-1",
    });
    connection.message({
      type: "timestamps",
      done: false,
      context_id: "ctx-1",
      word_timestamps: {
        words: ["Billing", "support"],
        start: [0, 0.44],
        end: [0.4, 0.91],
      },
    });
    connection.message({
      type: "done",
      done: true,
      context_id: "ctx-1",
    });

    const result = await synthesizePromise;
    const audioChunks: string[] = [];

    for await (const chunk of result.audio) {
      audioChunks.push(chunk);
    }

    expect(connection.sentMessages).toHaveLength(1);
    expect(JSON.parse(connection.sentMessages[0]!)).toMatchObject({
      model_id: "sonic-3.5",
      transcript: "Billing support is ready to help.",
      voice: {
        mode: "id",
        id: "86e30c1d-714b-4074-a1f2-1cb6b552fb49",
      },
    });
    expect(result.firstByteLatencyMs).toBe(84);
    expect(audioChunks).toEqual(["YXVkaW8tY2h1bmstMQ=="]);
    expect(result.wordTimestamps).toEqual([
      {
        word: "Billing",
        start: 0,
        end: 0.4,
      },
      {
        word: "support",
        start: 0.44,
        end: 0.91,
      },
    ]);
  });

  it("uses an approved role voice and tuning configuration when provided", async () => {
    const connection = new FakeWebSocketConnection();
    const provider = new CartesiaTtsProvider({
      apiKey: "cartesia-test-key",
      apiVersion: "2026-03-01",
      websocketFactory: () => connection,
      resolveVoiceId: async (input) => {
        expect(input).toMatchObject({
          organizationId: "tenant-west-africa",
          voiceId: "voice-support-approved",
        });
        return "cartesia-provider-voice-id";
      },
    });
    const synthesizePromise = provider.synthesize({
      manifest: createManifest(),
      activeRole: createRole(),
      text: "Billing support is ready to help.",
      language: "en",
      voiceProfile: "economy",
      voiceConfig: {
        provider: "cartesia",
        voiceId: "voice-support-approved",
        label: "Support voice",
        sourceType: "catalog",
        speed: 1.12,
        volume: 0.95,
        emotion: "calm",
      },
      context: {
        callPhase: "discovery",
        language: "en",
      },
    });

    connection.open();
    connection.message({
      type: "chunk",
      data: "YXVkaW8tY2h1bmstMQ==",
      done: false,
      step_time: 84,
      context_id: "ctx-1",
    });
    connection.message({
      type: "done",
      done: true,
      context_id: "ctx-1",
    });

    await synthesizePromise;

    expect(JSON.parse(connection.sentMessages[0]!)).toMatchObject({
      voice: {
        mode: "id",
        id: "cartesia-provider-voice-id",
      },
      generation_config: {
        speed: 1.12,
        volume: 0.95,
        emotion: "calm",
      },
    });
  });

  it("streams text chunks as Cartesia continuation requests and yields audio before the context is done", async () => {
    const connection = new FakeWebSocketConnection();
    const provider = new CartesiaTtsProvider({
      apiKey: "cartesia-test-key",
      apiVersion: "2026-03-01",
      websocketFactory: () => connection,
    });
    const synthesizePromise = provider.synthesizeStreaming!({
      manifest: createManifest(),
      activeRole: createRole(),
      textStream: streamText("Billing ", "support is ready"),
      language: "en",
      voiceProfile: "economy",
      context: {
        callPhase: "discovery",
        language: "en",
      },
    });

    connection.open();
    await settle();

    expect(connection.sentMessages.map((message) => JSON.parse(message))).toEqual([
      expect.objectContaining({
        transcript: "Billing ",
        context_id: "ctx-1",
        continue: true,
      }),
      expect.objectContaining({
        transcript: "support is ready",
        context_id: "ctx-1",
        continue: true,
      }),
      expect.objectContaining({
        transcript: "",
        context_id: "ctx-1",
        continue: false,
      }),
    ]);

    const firstAudioPromise = synthesizePromise.then(async (result) => {
      const iterator = result.audio[Symbol.asyncIterator]();
      return iterator.next();
    });

    connection.message({
      type: "chunk",
      data: "YXVkaW8tY2h1bmstMQ==",
      done: false,
      step_time: 74,
      context_id: "ctx-1",
    });

    const firstAudio = await firstAudioPromise;
    expect(firstAudio).toEqual({
      done: false,
      value: "YXVkaW8tY2h1bmstMQ==",
    });
  });

  it("requests PSTN-ready mu-law 8 kHz output when a telephony synthesis output is supplied", async () => {
    const connection = new FakeWebSocketConnection();
    const provider = new CartesiaTtsProvider({
      apiKey: "cartesia-test-key",
      apiVersion: "2026-03-01",
      websocketFactory: () => connection,
    });
    const input: PstnSandwichTtsInput = {
      manifest: createManifest(),
      activeRole: createRole(),
      text: "I can help with that.",
      language: "en",
      voiceProfile: "economy",
      context: {
        callPhase: "discovery",
        language: "en",
      },
      output: {
        format: "pcm_mulaw",
        sampleRateHz: 8_000,
        channels: 1,
      },
    };
    const synthesizePromise = provider.synthesize(input);

    connection.open();
    connection.message({
      type: "chunk",
      data: "bXVsYXctYXVkaW8=",
      done: false,
      step_time: 68,
      context_id: "ctx-1",
    });
    connection.message({
      type: "done",
      done: true,
      context_id: "ctx-1",
    });

    const result = await synthesizePromise;

    expect(JSON.parse(connection.sentMessages[0]!).output_format).toEqual({
      container: "raw",
      encoding: "pcm_mulaw",
      sample_rate: 8000,
    });
    expect(result.codec).toEqual({
      name: "g711_mulaw",
      sampleRateHz: 8000,
      channels: 1,
    });
  });

  it("warms and reuses a Cartesia websocket across generations", async () => {
    const connection = new FakeWebSocketConnection();
    const openedUrls: string[] = [];
    const provider = new CartesiaTtsProvider({
      apiKey: "cartesia-test-key",
      apiVersion: "2026-03-01",
      websocketFactory: (url) => {
        openedUrls.push(url);
        return connection;
      },
    });
    const warmPromise = provider.warm();

    connection.open();
    await warmPromise;

    const synthesizePromise = provider.synthesize({
      manifest: createManifest(),
      activeRole: createRole(),
      text: "Billing support is ready to help.",
      language: "en",
      voiceProfile: "economy",
      context: {
        callPhase: "discovery",
        language: "en",
      },
    });
    await settle();
    connection.message({
      type: "chunk",
      data: "YXVkaW8tY2h1bms=",
      done: false,
      step_time: 90,
      context_id: "ctx-1",
    });
    connection.message({
      type: "done",
      done: true,
      context_id: "ctx-1",
    });

    await synthesizePromise;
    expect(openedUrls).toHaveLength(1);
  });

  it("cancels an active Cartesia stream with a structured interrupted failure", async () => {
    const connection = new FakeWebSocketConnection();
    const abortController = new AbortController();
    const provider = new CartesiaTtsProvider({
      apiKey: "cartesia-test-key",
      apiVersion: "2026-03-01",
      websocketFactory: () => connection,
    });
    const synthesizePromise = provider.synthesize({
      manifest: createManifest(),
      activeRole: createRole(),
      text: "Billing support is ready to help.",
      language: "en",
      voiceProfile: "economy",
      abortSignal: abortController.signal,
      context: {
        callPhase: "discovery",
        language: "en",
      },
    });

    connection.open();
    abortController.abort();

    await expect(synthesizePromise).rejects.toMatchObject({
      stage: "tts",
      code: "interrupted",
    } satisfies Partial<RuntimeProviderFailure>);
    expect(connection.closeEvents).toContainEqual({
      code: 1000,
      reason: "tts_interrupted",
    });
  });
});

class FakeWebSocketConnection {
  sentMessages: string[] = [];
  closeEvents: Array<{ code: number; reason: string }> = [];
  private readonly listeners = new Map<string, Array<(value: unknown, reason?: Buffer) => void>>();

  on(event: string, listener: (value: unknown, reason?: Buffer) => void) {
    const current = this.listeners.get(event) ?? [];
    current.push(listener);
    this.listeners.set(event, current);
  }

  send(message: string) {
    this.sentMessages.push(message);
  }

  close(code?: number, reason?: string) {
    this.closeEvents.push({
      code: code ?? 1000,
      reason: reason ?? "",
    });
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

async function* streamText(...chunks: string[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createManifest(): CompiledRuntimeManifest {
  return {
    manifestId: "manifest-live-sandbox",
    publishedVersionId: "published-1",
    workflowId: "workflow-live-sandbox",
    version: 1,
    tenantId: "tenant-west-africa",
    environment: "production",
    workspaceId: "workspace-default",
    runtime: "sandwich-pipeline",
    runtimeProfile: "cost-optimized",
    telephonyProvider: "browser-webrtc",
    telephonyOwnership: "platform",
    entryNodeId: "entry",
    entryRoleId: "agent-front-desk",
    roles: [createRole()],
    tools: [],
    graph: {
      id: "workflow-live-sandbox",
      name: "Live sandbox",
      nodes: [],
      edges: [],
    },
    modelRouting: [],
    escalation: {
      enabled: false,
      fallbackMode: "ticket",
      triggers: [],
      fallbackMessage: "",
    },
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor"],
    },
    toolBindings: [],
    agentToolAssignments: [],
    handoffs: [],
    conditions: [],
    routePolicies: [],
    exitNodes: [],
    escalationNode: null,
    memory: {
      mode: "scoped",
      retrievalScopes: ["session"],
      approvalRequired: true,
    },
    budget: {
      monthlyCapUsd: 1000,
      currentSpendUsd: 100,
      projectedCostPerMinuteUsd: 0.3,
      blockOnLimit: true,
    },
    serializedGraph: "{\"nodes\":[],\"edges\":[]}",
    compiledDefinitionHash: "hash-live-sandbox",
  };
}

function createRole(): VoiceAgentRole {
  return {
    id: "agent-front-desk",
    kind: "receptionist",
    name: "Front desk triage",
    businessName: "Tuzzy Labs",
    instructions: "Help the caller and keep the tone concise.",
    defaultModelTier: "cheap",
    toolIds: [],
    languagePolicy: {
      defaultLanguage: "en",
      supportedLanguages: ["en"],
      allowMidCallSwitching: true,
    },
  };
}
