import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  createCartesiaTtsBenchmarkAdapter,
  createGeminiTtsBenchmarkAdapter,
  createOpenAiTtsBenchmarkAdapter,
  createProviderBenchmarkAdapterCatalog,
  runProviderBenchmarks,
  summarizeBenchmarkResults,
  type BenchmarkHttpTransport,
  type BenchmarkWebSocketConnection,
  type BenchmarkWebSocketTransport,
  type ProviderBenchmarkAdapter,
} from "./provider-benchmarks";

describe("provider benchmark harness", () => {
  it("skips unconfigured providers, normalizes results, writes redacted artifacts, and summarizes latency", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "zara-provider-bench-"));
    const adapters: ProviderBenchmarkAdapter[] = [
      {
        provider: "cartesia",
        kind: "tts",
        requiredEnv: ["CARTESIA_API_KEY"],
        async run() {
          return {
            status: "ok",
            provider: "cartesia",
            kind: "tts",
            model: "sonic-3.5",
            scenarioId: "short-greeting",
            timings: {
              firstByteMs: 90,
              totalMs: 240,
              generatedAudioMs: 1300,
            },
            codec: {
              name: "pcm_s16le",
              sampleRateHz: 16000,
              channels: 1,
            },
            estimatedCostUsd: 0.00045,
            rawAudioBase64: "AUDIO_BASE64_PAYLOAD",
          };
        },
      },
      {
        provider: "gemini-live",
        kind: "realtime",
        requiredEnv: ["GEMINI_API_KEY"],
        async run() {
          throw new Error("should be skipped before run");
        },
      },
    ];

    const result = await runProviderBenchmarks({
      suite: "providers",
      outputDirectory,
      env: {
        CARTESIA_API_KEY: "test-cartesia-key",
      },
      now: () => "2026-06-13T10:00:00.000Z",
      gitSha: "abc123",
      adapters,
      scenarios: [
        {
          id: "short-greeting",
          kind: "tts",
          text: "Thanks for calling Zara.",
          targetOutput: "browser-pcm",
        },
      ],
    });

    expect(result.results).toEqual([
      expect.objectContaining({
        status: "ok",
        provider: "cartesia",
        scenarioId: "short-greeting",
      }),
      expect.objectContaining({
        status: "skipped",
        provider: "gemini-live",
        missingEnv: ["GEMINI_API_KEY"],
      }),
    ]);
    expect(result.summary).toMatchObject({
      totalRuns: 2,
      okCount: 1,
      skippedCount: 1,
      errorCount: 0,
      latency: {
        firstByteMs: {
          p50: 90,
          p95: 90,
          p99: 90,
        },
      },
    });

    const artifact = JSON.parse(await readFile(result.artifactPath, "utf8")) as unknown;
    expect(JSON.stringify(artifact)).not.toContain("AUDIO_BASE64_PAYLOAD");
    expect(JSON.stringify(artifact)).not.toContain("test-cartesia-key");

    await rm(outputDirectory, { recursive: true, force: true });
  });

  it("provides the requested default providers for TTS and premium realtime benchmarking", () => {
    const catalog = createProviderBenchmarkAdapterCatalog();

    expect(catalog.map((adapter) => `${adapter.kind}:${adapter.provider}`)).toEqual([
      "tts:cartesia",
      "tts:gemini",
      "tts:deepgram",
      "tts:openai",
      "realtime:openai-realtime",
      "realtime:gemini-live",
    ]);
  });

  it("marks default catalog adapter output as dry-run until live provider adapters are wired", async () => {
    const deepgram = createProviderBenchmarkAdapterCatalog().find((adapter) => adapter.provider === "deepgram");

    await expect(deepgram?.run({
      scenario: {
        id: "short-greeting",
        kind: "tts",
        text: "Thanks for calling Zara.",
        targetOutput: "browser-pcm",
      },
      env: {
        DEEPGRAM_API_KEY: "test-key",
      },
      captureAudio: false,
    })).resolves.toEqual(expect.objectContaining({
      mode: "dry-run",
      warnings: expect.arrayContaining(["provider_benchmark.dry_run_placeholder"]),
    }));
  });

  it("runs the OpenAI TTS adapter through an injectable HTTP transport", async () => {
    const requests: Array<{ url: string; init: { headers: Record<string, string>; body: unknown } }> = [];
    const adapter = createOpenAiTtsBenchmarkAdapter({
      baseUrl: "https://openai.test/v1",
      transport: {
        async postJson(url, init) {
          requests.push({
            url,
            init: {
              headers: init.headers,
              body: JSON.parse(init.body),
            },
          });
          return {
            ok: true,
            status: 200,
            headers: {
              "x-request-id": "req_openai_123",
            },
            body: asyncIterableFromBuffers([Buffer.from("first"), Buffer.from("second")]),
          };
        },
      },
      clock: createAdvancingClock([2000, 2045, 2080]),
    });

    await expect(adapter.run({
      scenario: {
        id: "short-greeting",
        kind: "tts",
        text: "Thanks for calling Zara.",
        targetOutput: "browser-pcm",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
        OPENAI_TTS_VOICE: "marin",
      },
      captureAudio: false,
    })).resolves.toEqual(expect.objectContaining({
      status: "ok",
      provider: "openai",
      kind: "tts",
      mode: "live",
      model: "gpt-4o-mini-tts",
      voice: "marin",
      requestId: "req_openai_123",
      codec: {
        name: "pcm_s16le",
        sampleRateHz: 24000,
        channels: 1,
      },
      timings: expect.objectContaining({
        firstByteMs: 45,
        totalMs: 80,
      }),
    }));
    expect(requests).toEqual([
      {
        url: "https://openai.test/v1/audio/speech",
        init: {
          headers: {
            Authorization: "Bearer openai-secret",
            "Content-Type": "application/json",
          },
          body: {
            model: "gpt-4o-mini-tts",
            input: "Thanks for calling Zara.",
            voice: "marin",
            response_format: "pcm",
          },
        },
      },
    ]);
  });

  it("flags OpenAI TTS PSTN output as requiring transcode from 24 kHz PCM", async () => {
    const adapter = createOpenAiTtsBenchmarkAdapter({
      transport: createHttpAudioTransport([Buffer.from("audio")]),
      clock: createAdvancingClock([0, 20, 40]),
    });

    const result = await adapter.run({
      scenario: {
        id: "pstn-mulaw",
        kind: "tts",
        text: "I am connecting you now.",
        targetOutput: "pstn-mulaw",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
      },
      captureAudio: false,
    });

    expect(result.codec).toEqual({
      name: "pcm_s16le",
      sampleRateHz: 24000,
      channels: 1,
    });
    expect(result.timings.transcodeMs).toBe(0);
    expect(result.warnings).toContain("tts_pstn_transcode_required");
  });

  it("runs the Gemini TTS adapter through an injectable HTTP transport", async () => {
    const requests: Array<{ url: string; init: { headers: Record<string, string>; body: unknown } }> = [];
    const adapter = createGeminiTtsBenchmarkAdapter({
      baseUrl: "https://gemini.test/v1beta",
      transport: {
        async postJson(url, init) {
          requests.push({
            url,
            init: {
              headers: init.headers,
              body: JSON.parse(init.body),
            },
          });
          return {
            ok: true,
            status: 200,
            headers: {},
            body: {
              candidates: [{
                content: {
                  parts: [{
                    inlineData: {
                      mimeType: "audio/pcm",
                      data: Buffer.from("gemini-audio").toString("base64"),
                    },
                  }],
                },
              }],
            },
          };
        },
      },
      clock: createAdvancingClock([3000, 3075]),
    });

    await expect(adapter.run({
      scenario: {
        id: "short-greeting",
        kind: "tts",
        text: "Thanks for calling Zara.",
        targetOutput: "browser-pcm",
      },
      env: {
        GEMINI_API_KEY: "gemini-secret",
        GEMINI_TTS_VOICE: "Puck",
      },
      captureAudio: false,
    })).resolves.toEqual(expect.objectContaining({
      status: "ok",
      provider: "gemini",
      kind: "tts",
      mode: "live",
      model: "gemini-3.1-flash-tts-preview",
      voice: "Puck",
      codec: {
        name: "pcm_s16le",
        sampleRateHz: 24000,
        channels: 1,
      },
      timings: expect.objectContaining({
        firstByteMs: 75,
        totalMs: 75,
      }),
    }));
    expect(requests).toEqual([
      {
        url: "https://gemini.test/v1beta/models/gemini-3.1-flash-tts-preview:generateContent",
        init: {
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": "gemini-secret",
          },
          body: {
            contents: [{
              parts: [{
                text: "Thanks for calling Zara.",
              }],
            }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: "Puck",
                  },
                },
              },
            },
          },
        },
      },
    ]);
  });

  it("flags PSTN transcode overhead and non-mu-law provider output in summaries", () => {
    const summary = summarizeBenchmarkResults([
      {
        status: "ok",
        provider: "gemini",
        kind: "tts",
        scenarioId: "pstn-mulaw",
        model: "gemini-live-2.5-flash-native-audio",
        timings: {
          firstByteMs: 180,
          totalMs: 420,
          transcodeMs: 16,
        },
        codec: {
          name: "pcm_s16le",
          sampleRateHz: 24000,
          channels: 1,
        },
        warnings: ["tts_pstn_transcode_required"],
      },
    ]);

    expect(summary.pstn).toEqual({
      transcodeRequiredCount: 1,
      nonMulawOutputCount: 1,
      transcodeLatencyMs: {
        p50: 16,
        p95: 16,
        p99: 16,
      },
    });
  });

  it("runs the Cartesia TTS live adapter through an injectable websocket transport", async () => {
    const sentMessages: unknown[] = [];
    const transport: BenchmarkWebSocketTransport = {
      async connect(url, options) {
        expect(url).toBe("wss://cartesia.test/tts/websocket?cartesia_version=2026-03-01");
        expect(options.headers).toEqual({
          "X-API-Key": "cartesia-secret",
        });

        return {
          async sendJson(payload) {
            sentMessages.push(payload);
          },
          async *messages() {
            yield JSON.stringify({
              type: "chunk",
              data: Buffer.from("first").toString("base64"),
              done: false,
              status_code: 206,
              step_time: 35,
              context_id: "bench-short-greeting",
            });
            yield JSON.stringify({
              type: "done",
              done: true,
              status_code: 206,
              context_id: "bench-short-greeting",
            });
          },
          async close() {
            // No-op fake close.
          },
        } satisfies BenchmarkWebSocketConnection;
      },
    };

    const adapter = createCartesiaTtsBenchmarkAdapter({
      websocketUrl: "wss://cartesia.test/tts/websocket",
      transport,
      clock: createAdvancingClock([1000, 1025, 1065, 1110]),
      contextIdFactory: (scenarioId) => `bench-${scenarioId}`,
    });

    await expect(adapter.run({
      scenario: {
        id: "short-greeting",
        kind: "tts",
        text: "Thanks for calling Zara.",
        targetOutput: "browser-pcm",
      },
      env: {
        CARTESIA_API_KEY: "cartesia-secret",
        CARTESIA_API_VERSION: "2026-03-01",
        CARTESIA_VOICE_ID: "voice-123",
      },
      captureAudio: false,
    })).resolves.toEqual(expect.objectContaining({
      status: "ok",
      provider: "cartesia",
      kind: "tts",
      mode: "live",
      scenarioId: "short-greeting",
      model: "sonic-3.5",
      voice: "voice-123",
      codec: {
        name: "pcm_s16le",
        sampleRateHz: 16000,
        channels: 1,
      },
      timings: expect.objectContaining({
        connectMs: 25,
        firstByteMs: 65,
        totalMs: 110,
      }),
    }));
    expect(sentMessages).toEqual([
      expect.objectContaining({
        model_id: "sonic-3.5",
        transcript: "Thanks for calling Zara.",
        voice: {
          mode: "id",
          id: "voice-123",
        },
        context_id: "bench-short-greeting",
        output_format: {
          container: "raw",
          encoding: "pcm_s16le",
          sample_rate: 16000,
        },
      }),
    ]);
  });

  it("requests native Cartesia mu-law output for PSTN benchmark scenarios", async () => {
    const sentMessages: unknown[] = [];
    const adapter = createCartesiaTtsBenchmarkAdapter({
      transport: createSingleChunkTransport(sentMessages),
      clock: createAdvancingClock([0, 5, 15, 20]),
      contextIdFactory: (scenarioId) => `bench-${scenarioId}`,
    });

    const result = await adapter.run({
      scenario: {
        id: "pstn-mulaw",
        kind: "tts",
        text: "I am connecting you now.",
        targetOutput: "pstn-mulaw",
      },
      env: {
        CARTESIA_API_KEY: "cartesia-secret",
        CARTESIA_VOICE_ID: "voice-123",
      },
      captureAudio: false,
    });

    expect(result.codec).toEqual({
      name: "g711_mulaw",
      sampleRateHz: 8000,
      channels: 1,
    });
    expect(sentMessages).toEqual([
      expect.objectContaining({
        output_format: {
          container: "raw",
          encoding: "pcm_mulaw",
          sample_rate: 8000,
        },
      }),
    ]);
    expect(result.warnings ?? []).not.toContain("tts_pstn_transcode_required");
  });
});

function createAdvancingClock(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

function createSingleChunkTransport(sentMessages: unknown[]): BenchmarkWebSocketTransport {
  return {
    async connect() {
      return {
        async sendJson(payload) {
          sentMessages.push(payload);
        },
        async *messages() {
          yield JSON.stringify({
            type: "chunk",
            data: Buffer.from("first").toString("base64"),
            done: false,
            status_code: 206,
            step_time: 8,
            context_id: "bench-pstn-mulaw",
          });
          yield JSON.stringify({
            type: "done",
            done: true,
            status_code: 206,
            context_id: "bench-pstn-mulaw",
          });
        },
        async close() {
          // No-op fake close.
        },
      };
    },
  };
}

function createHttpAudioTransport(chunks: Buffer[]): BenchmarkHttpTransport {
  return {
    async postJson() {
      return {
        ok: true,
        status: 200,
        headers: {},
        body: asyncIterableFromBuffers(chunks),
      };
    },
  };
}

async function* asyncIterableFromBuffers(chunks: Buffer[]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) {
    yield chunk;
  }
}
