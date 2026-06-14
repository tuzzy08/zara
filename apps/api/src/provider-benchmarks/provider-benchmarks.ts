import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import WebSocket from "ws";

import { calculatePercentiles, type RuntimeLatencyPercentiles } from "../runtime-observability/runtime-observability";
import {
  CartesiaStreamingAdapter,
  type CartesiaRawAudioEncoding,
} from "../sandbox-live-sessions/cartesia-streaming.adapter";

export type ProviderBenchmarkKind = "tts" | "realtime";
export type ProviderBenchmarkStatus = "ok" | "skipped" | "error";

export interface ProviderBenchmarkScenario {
  id: string;
  kind: ProviderBenchmarkKind;
  text?: string | undefined;
  targetOutput?: "browser-pcm" | "pstn-mulaw" | "native-audio" | undefined;
}

export interface ProviderBenchmarkCodec {
  name: string;
  sampleRateHz: number;
  channels: number;
}

export interface ProviderBenchmarkTimings {
  connectMs?: number | undefined;
  firstByteMs?: number | undefined;
  firstAudioMs?: number | undefined;
  firstTokenMs?: number | undefined;
  totalMs?: number | undefined;
  generatedAudioMs?: number | undefined;
  transcodeMs?: number | undefined;
}

export interface ProviderBenchmarkOkResult {
  status: "ok";
  provider: string;
  kind: ProviderBenchmarkKind;
  mode?: "dry-run" | "live" | undefined;
  scenarioId: string;
  model: string;
  region?: string | undefined;
  voice?: string | undefined;
  codec?: ProviderBenchmarkCodec | undefined;
  timings: ProviderBenchmarkTimings;
  estimatedCostUsd?: number | undefined;
  requestId?: string | undefined;
  warnings?: string[] | undefined;
  rawAudioBase64?: string | undefined;
}

export interface ProviderBenchmarkSkippedResult {
  status: "skipped";
  provider: string;
  kind: ProviderBenchmarkKind;
  scenarioId: string;
  missingEnv: string[];
  reason: string;
}

export interface ProviderBenchmarkErrorResult {
  status: "error";
  provider: string;
  kind: ProviderBenchmarkKind;
  scenarioId: string;
  errorCode: string;
  message: string;
}

export type ProviderBenchmarkResult =
  | ProviderBenchmarkOkResult
  | ProviderBenchmarkSkippedResult
  | ProviderBenchmarkErrorResult;

export interface ProviderBenchmarkAdapter {
  provider: string;
  kind: ProviderBenchmarkKind;
  requiredEnv: string[];
  run(input: {
    scenario: ProviderBenchmarkScenario;
    env: Record<string, string | undefined>;
    captureAudio: boolean;
  }): Promise<ProviderBenchmarkOkResult>;
}

export interface BenchmarkWebSocketConnection {
  sendJson(payload: unknown): Promise<void>;
  messages(): AsyncIterable<string>;
  close(): Promise<void>;
}

export interface BenchmarkWebSocketTransport {
  connect(url: string, options: {
    headers: Record<string, string>;
  }): Promise<BenchmarkWebSocketConnection>;
}

export interface BenchmarkHttpResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array> | unknown;
}

export interface BenchmarkHttpTransport {
  postJson(url: string, init: {
    headers: Record<string, string>;
    body: string;
  }): Promise<BenchmarkHttpResponse>;
}

export interface ProviderBenchmarkRunInput {
  suite: "tts" | "realtime" | "providers";
  outputDirectory: string;
  env?: Record<string, string | undefined> | undefined;
  now?: (() => string) | undefined;
  gitSha?: string | undefined;
  adapters?: ProviderBenchmarkAdapter[] | undefined;
  scenarios?: ProviderBenchmarkScenario[] | undefined;
}

export interface ProviderBenchmarkRunResult {
  artifactPath: string;
  results: ProviderBenchmarkResult[];
  summary: ProviderBenchmarkSummary;
}

export interface ProviderBenchmarkSummary {
  totalRuns: number;
  okCount: number;
  skippedCount: number;
  errorCount: number;
  latency: {
    firstByteMs: RuntimeLatencyPercentiles;
    firstAudioMs: RuntimeLatencyPercentiles;
    totalMs: RuntimeLatencyPercentiles;
  };
  pstn: {
    transcodeRequiredCount: number;
    nonMulawOutputCount: number;
    transcodeLatencyMs: RuntimeLatencyPercentiles;
  };
  estimatedCostUsd: number;
}

export async function runProviderBenchmarks(input: ProviderBenchmarkRunInput): Promise<ProviderBenchmarkRunResult> {
  const env = input.env ?? process.env;
  const now = input.now ?? (() => new Date().toISOString());
  const timestamp = now();
  const adapters = input.adapters ?? createProviderBenchmarkAdapterCatalog();
  const scenarios = input.scenarios ?? createDefaultBenchmarkScenarios(input.suite);
  const captureAudio = env["BENCHMARK_CAPTURE_AUDIO"] === "true";
  const results: ProviderBenchmarkResult[] = [];

  for (const adapter of adapters.filter((candidate) => input.suite === "providers" || candidate.kind === input.suite)) {
    const adapterScenarios = scenarios.filter((candidate) => candidate.kind === adapter.kind);
    const scenariosForAdapter = adapterScenarios.length > 0
      ? adapterScenarios
      : createDefaultBenchmarkScenarios(adapter.kind)[0] === undefined
        ? []
        : [createDefaultBenchmarkScenarios(adapter.kind)[0]!];

    for (const scenario of scenariosForAdapter) {
      const missingEnv = adapter.requiredEnv.filter((key) => (env[key]?.trim().length ?? 0) === 0);
      if (missingEnv.length > 0) {
        results.push({
          status: "skipped",
          provider: adapter.provider,
          kind: adapter.kind,
          scenarioId: scenario.id,
          missingEnv,
          reason: "Provider credentials are not configured.",
        });
        continue;
      }

      try {
        results.push(redactBenchmarkResult(await adapter.run({ scenario, env, captureAudio }), captureAudio));
      } catch (error) {
        results.push({
          status: "error",
          provider: adapter.provider,
          kind: adapter.kind,
          scenarioId: scenario.id,
          errorCode: "provider_benchmark.failed",
          message: error instanceof Error ? error.message : "Provider benchmark failed.",
        });
      }
    }
  }

  const summary = summarizeBenchmarkResults(results);
  await mkdir(input.outputDirectory, { recursive: true });
  const artifactPath = join(input.outputDirectory, `${input.suite}-${timestamp.replace(/[:.]/g, "-")}.json`);
  await writeFile(
    artifactPath,
    `${JSON.stringify({
      schemaVersion: "zara.provider-benchmark.v1",
      suite: input.suite,
      generatedAt: timestamp,
      gitSha: input.gitSha ?? "unknown",
      captureAudio,
      summary,
      results: results.map((result) => redactBenchmarkResult(result, captureAudio)),
    }, null, 2)}\n`,
    "utf8",
  );

  return {
    artifactPath,
    results,
    summary,
  };
}

export function summarizeBenchmarkResults(results: ProviderBenchmarkResult[]): ProviderBenchmarkSummary {
  const okResults = results.filter((result): result is ProviderBenchmarkOkResult => result.status === "ok");
  const firstByteValues = okResults.flatMap((result) =>
    result.timings.firstByteMs === undefined ? [] : [result.timings.firstByteMs],
  );
  const firstAudioValues = okResults.flatMap((result) =>
    result.timings.firstAudioMs === undefined ? [] : [result.timings.firstAudioMs],
  );
  const totalValues = okResults.flatMap((result) =>
    result.timings.totalMs === undefined ? [] : [result.timings.totalMs],
  );
  const transcodeValues = okResults.flatMap((result) =>
    result.timings.transcodeMs === undefined ? [] : [result.timings.transcodeMs],
  );

  return {
    totalRuns: results.length,
    okCount: okResults.length,
    skippedCount: results.filter((result) => result.status === "skipped").length,
    errorCount: results.filter((result) => result.status === "error").length,
    latency: {
      firstByteMs: calculatePercentiles(firstByteValues),
      firstAudioMs: calculatePercentiles(firstAudioValues),
      totalMs: calculatePercentiles(totalValues),
    },
    pstn: {
      transcodeRequiredCount: okResults.filter((result) =>
        result.warnings?.includes("tts_pstn_transcode_required") === true
        || result.timings.transcodeMs !== undefined,
      ).length,
      nonMulawOutputCount: okResults.filter((result) =>
        result.scenarioId.includes("pstn")
        && result.codec !== undefined
        && !isMulawCodec(result.codec),
      ).length,
      transcodeLatencyMs: calculatePercentiles(transcodeValues),
    },
    estimatedCostUsd: roundUsd(okResults.reduce((total, result) => total + (result.estimatedCostUsd ?? 0), 0)),
  };
}

export function createProviderBenchmarkAdapterCatalog(): ProviderBenchmarkAdapter[] {
  return [
    createCartesiaTtsBenchmarkAdapter(),
    createGeminiTtsBenchmarkAdapter(),
    createConfiguredPlaceholderAdapter("deepgram", "tts", ["DEEPGRAM_API_KEY"], "aura-2"),
    createOpenAiTtsBenchmarkAdapter(),
    createConfiguredPlaceholderAdapter("openai-realtime", "realtime", ["OPENAI_API_KEY"], "gpt-4o-realtime"),
    createConfiguredPlaceholderAdapter("gemini-live", "realtime", ["GEMINI_API_KEY"], "gemini-live-2.5-flash-native-audio"),
  ];
}

export function createOpenAiTtsBenchmarkAdapter(input: {
  baseUrl?: string | undefined;
  transport?: BenchmarkHttpTransport | undefined;
  clock?: (() => number) | undefined;
} = {}): ProviderBenchmarkAdapter {
  const clock = input.clock ?? (() => performance.now());
  const transport = input.transport ?? new FetchBenchmarkHttpTransport();

  return {
    provider: "openai",
    kind: "tts",
    requiredEnv: ["OPENAI_API_KEY"],
    async run({ scenario, env, captureAudio }) {
      const apiKey = requiredEnvValue(env, "OPENAI_API_KEY");
      const model = env["OPENAI_TTS_MODEL"]?.trim() || "gpt-4o-mini-tts";
      const voice = env["OPENAI_TTS_VOICE"]?.trim() || "coral";
      const baseUrl = trimTrailingSlash(input.baseUrl ?? env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1");
      const target = resolveOpenAiBenchmarkTarget(scenario);
      const startedAt = clock();
      const response = await transport.postJson(`${baseUrl}/audio/speech`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: scenario.text ?? "",
          voice,
          response_format: "pcm",
        }),
      });
      if (!response.ok) {
        throw new Error(`OpenAI TTS benchmark failed with HTTP ${response.status}.`);
      }

      const { firstByteAt, finishedAt, audioBuffers } = await collectAudioResponse(response.body, clock);
      return {
        status: "ok",
        provider: "openai",
        kind: "tts",
        mode: "live",
        scenarioId: scenario.id,
        model,
        voice,
        requestId: response.headers["x-request-id"],
        codec: target.codec,
        timings: {
          firstByteMs: firstByteAt === undefined ? undefined : firstByteAt - startedAt,
          totalMs: finishedAt - startedAt,
          generatedAudioMs: estimateGeneratedAudioMs(bufferLength(audioBuffers), target.codec),
          ...(target.requiresTranscode ? { transcodeMs: 0 } : {}),
        },
        estimatedCostUsd: 0,
        ...(target.requiresTranscode ? { warnings: ["tts_pstn_transcode_required"] } : {}),
        ...(captureAudio ? { rawAudioBase64: Buffer.concat(audioBuffers).toString("base64") } : {}),
      };
    },
  };
}

export function createGeminiTtsBenchmarkAdapter(input: {
  baseUrl?: string | undefined;
  transport?: BenchmarkHttpTransport | undefined;
  clock?: (() => number) | undefined;
} = {}): ProviderBenchmarkAdapter {
  const clock = input.clock ?? (() => performance.now());
  const transport = input.transport ?? new FetchBenchmarkHttpTransport();

  return {
    provider: "gemini",
    kind: "tts",
    requiredEnv: ["GEMINI_API_KEY"],
    async run({ scenario, env, captureAudio }) {
      const apiKey = requiredEnvValue(env, "GEMINI_API_KEY");
      const model = env["GEMINI_TTS_MODEL"]?.trim() || "gemini-3.1-flash-tts-preview";
      const voice = env["GEMINI_TTS_VOICE"]?.trim() || "Kore";
      const baseUrl = trimTrailingSlash(input.baseUrl ?? env["GEMINI_BASE_URL"] ?? "https://generativelanguage.googleapis.com/v1beta");
      const target = resolveGeminiBenchmarkTarget(scenario);
      const startedAt = clock();
      const response = await transport.postJson(`${baseUrl}/models/${model}:generateContent`, {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: scenario.text ?? "",
            }],
          }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voice,
                },
              },
            },
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`Gemini TTS benchmark failed with HTTP ${response.status}.`);
      }

      const finishedAt = clock();
      const audioBase64 = extractGeminiAudioBase64(response.body);
      const audioBuffer = Buffer.from(audioBase64, "base64");
      return {
        status: "ok",
        provider: "gemini",
        kind: "tts",
        mode: "live",
        scenarioId: scenario.id,
        model,
        voice,
        codec: target.codec,
        timings: {
          firstByteMs: finishedAt - startedAt,
          totalMs: finishedAt - startedAt,
          generatedAudioMs: estimateGeneratedAudioMs(audioBuffer.byteLength, target.codec),
          ...(target.requiresTranscode ? { transcodeMs: 0 } : {}),
        },
        estimatedCostUsd: 0,
        ...(target.requiresTranscode ? { warnings: ["tts_pstn_transcode_required"] } : {}),
        ...(captureAudio ? { rawAudioBase64: audioBuffer.toString("base64") } : {}),
      };
    },
  };
}

export function createCartesiaTtsBenchmarkAdapter(input: {
  websocketUrl?: string | undefined;
  transport?: BenchmarkWebSocketTransport | undefined;
  clock?: (() => number) | undefined;
  contextIdFactory?: ((scenarioId: string) => string) | undefined;
} = {}): ProviderBenchmarkAdapter {
  const clock = input.clock ?? (() => performance.now());
  const transport = input.transport ?? new WsBenchmarkWebSocketTransport();

  return {
    provider: "cartesia",
    kind: "tts",
    requiredEnv: ["CARTESIA_API_KEY", "CARTESIA_VOICE_ID"],
    async run({ scenario, env, captureAudio }) {
      const apiKey = requiredEnvValue(env, "CARTESIA_API_KEY");
      const voiceId = requiredEnvValue(env, "CARTESIA_VOICE_ID");
      const model = env["CARTESIA_MODEL_ID"]?.trim() || "sonic-3.5";
      const apiVersion = env["CARTESIA_API_VERSION"]?.trim() || "2026-03-01";
      const target = resolveCartesiaBenchmarkTarget(scenario);
      const provider = new CartesiaStreamingAdapter({
        apiKey,
        apiVersion,
        websocketUrl: input.websocketUrl ?? env["CARTESIA_WEBSOCKET_URL"],
        modelId: model,
      });
      const session = provider.createSession();
      const startedAt = clock();
      const connection = await transport.connect(session.websocketUrl, { headers: session.headers });
      const connectedAt = clock();
      const contextId = input.contextIdFactory?.(scenario.id) ?? `bench-${scenario.id}-${Date.now()}`;
      const chunks: string[] = [];
      let firstByteAt: number | undefined;
      let doneAt: number | undefined;

      try {
        await connection.sendJson(provider.createGenerationRequest({
          transcript: scenario.text ?? "",
          contextId,
          voiceId,
          language: resolveScenarioLanguage(scenario),
          outputFormat: {
            encoding: target.encoding,
            sampleRateHz: target.sampleRateHz,
          },
          continueGeneration: false,
        }));

        for await (const rawMessage of connection.messages()) {
          const message = provider.parseMessage(rawMessage);
          if (message === null) {
            continue;
          }
          if (message instanceof Error) {
            throw message;
          }
          if (message.contextId !== contextId) {
            continue;
          }
          if (message.kind === "chunk") {
            if (firstByteAt === undefined) {
              firstByteAt = clock();
            }
            chunks.push(message.audioBase64);
            if (message.done) {
              doneAt = clock();
              break;
            }
          }
          if (message.kind === "done") {
            doneAt = clock();
            break;
          }
        }
      } finally {
        await connection.close();
      }

      const finishedAt = doneAt ?? clock();
      const audioBuffers = chunks.map((chunk) => Buffer.from(chunk, "base64"));
      const audioBytes = audioBuffers.reduce((total, chunk) => total + chunk.byteLength, 0);
      return {
        status: "ok",
        provider: "cartesia",
        kind: "tts",
        mode: "live",
        scenarioId: scenario.id,
        model,
        voice: voiceId,
        codec: target.codec,
        timings: {
          connectMs: connectedAt - startedAt,
          firstByteMs: firstByteAt === undefined ? undefined : firstByteAt - startedAt,
          totalMs: finishedAt - startedAt,
          generatedAudioMs: estimateGeneratedAudioMs(audioBytes, target.codec),
        },
        estimatedCostUsd: 0,
        ...(captureAudio ? { rawAudioBase64: Buffer.concat(audioBuffers).toString("base64") } : {}),
      };
    },
  };
}

export function createDefaultBenchmarkScenarios(suite: ProviderBenchmarkRunInput["suite"]): ProviderBenchmarkScenario[] {
  const ttsScenarios: ProviderBenchmarkScenario[] = [
    { id: "short-greeting", kind: "tts", text: "Thanks for calling Zara.", targetOutput: "browser-pcm" },
    {
      id: "support-reply",
      kind: "tts",
      text: "I can help with that. I will check the order and explain the next step clearly.",
      targetOutput: "browser-pcm",
    },
    {
      id: "numbers-email-order",
      kind: "tts",
      text: "Your appointment is June 14 at 2:30 PM. The order ID is ZA-1049 and the email is caller@example.com.",
      targetOutput: "browser-pcm",
    },
    {
      id: "pstn-mulaw",
      kind: "tts",
      text: "I am connecting you to the right specialist now.",
      targetOutput: "pstn-mulaw",
    },
  ];
  const realtimeScenarios: ProviderBenchmarkScenario[] = [
    { id: "cold-session-connect", kind: "realtime", targetOutput: "native-audio" },
    { id: "warm-turn-first-audio", kind: "realtime", targetOutput: "native-audio" },
    { id: "barge-in-interruption", kind: "realtime", targetOutput: "native-audio" },
  ];

  if (suite === "tts") {
    return ttsScenarios;
  }
  if (suite === "realtime") {
    return realtimeScenarios;
  }
  return [...ttsScenarios, ...realtimeScenarios];
}

function createConfiguredPlaceholderAdapter(
  provider: string,
  kind: ProviderBenchmarkKind,
  requiredEnv: string[],
  model: string,
): ProviderBenchmarkAdapter {
  return {
    provider,
    kind,
    requiredEnv,
    async run({ scenario }) {
      const isPstn = scenario.targetOutput === "pstn-mulaw";
      const nativeMulaw = provider === "cartesia";
      return {
        status: "ok",
        provider,
        kind,
        mode: "dry-run",
        scenarioId: scenario.id,
        model,
        timings: {
          connectMs: kind === "realtime" ? 100 : undefined,
          firstByteMs: kind === "tts" ? 1 : undefined,
          firstAudioMs: kind === "realtime" ? 1 : undefined,
          totalMs: 1,
          ...(isPstn && !nativeMulaw ? { transcodeMs: 0 } : {}),
        },
        codec: isPstn && nativeMulaw
          ? { name: "g711_mulaw", sampleRateHz: 8000, channels: 1 }
          : { name: "pcm_s16le", sampleRateHz: kind === "tts" ? 24000 : 16000, channels: 1 },
        estimatedCostUsd: 0,
        warnings: [
          "provider_benchmark.dry_run_placeholder",
          ...(isPstn && !nativeMulaw ? ["tts_pstn_transcode_required"] : []),
        ],
      };
    },
  };
}

class WsBenchmarkWebSocketTransport implements BenchmarkWebSocketTransport {
  async connect(url: string, options: {
    headers: Record<string, string>;
  }): Promise<BenchmarkWebSocketConnection> {
    const socket = new WebSocket(url, { headers: options.headers });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    return {
      async sendJson(payload: unknown) {
        await new Promise<void>((resolve, reject) => {
          socket.send(JSON.stringify(payload), (error) => {
            if (error === undefined) {
              resolve();
              return;
            }
            reject(error);
          });
        });
      },
      messages() {
        return websocketMessages(socket);
      },
      async close() {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close(1000, "benchmark complete");
        }
      },
    };
  }
}

class FetchBenchmarkHttpTransport implements BenchmarkHttpTransport {
  async postJson(url: string, init: {
    headers: Record<string, string>;
    body: string;
  }): Promise<BenchmarkHttpResponse> {
    const response = await fetch(url, {
      method: "POST",
      headers: init.headers,
      body: init.body,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      ok: response.ok,
      status: response.status,
      headers,
      body: response.body === null ? undefined : streamToAsyncIterable(response.body),
    };
  }
}

async function* streamToAsyncIterable(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function collectAudioResponse(body: unknown, clock: () => number): Promise<{
  firstByteAt?: number | undefined;
  finishedAt: number;
  audioBuffers: Buffer[];
}> {
  if (!isAsyncIterable(body)) {
    const finishedAt = clock();
    return {
      finishedAt,
      audioBuffers: [],
    };
  }

  const audioBuffers: Buffer[] = [];
  let firstByteAt: number | undefined;
  for await (const chunk of body) {
    if (firstByteAt === undefined) {
      firstByteAt = clock();
    }
    audioBuffers.push(Buffer.from(chunk));
  }
  return {
    firstByteAt,
    finishedAt: clock(),
    audioBuffers,
  };
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return typeof value === "object"
    && value !== null
    && Symbol.asyncIterator in value;
}

async function* websocketMessages(socket: WebSocket): AsyncIterable<string> {
  const queue: string[] = [];
  let done = false;
  let failure: Error | undefined;
  let notify: (() => void) | undefined;

  const wake = () => {
    notify?.();
    notify = undefined;
  };
  socket.on("message", (data) => {
    queue.push(data.toString());
    wake();
  });
  socket.once("error", (error) => {
    failure = error;
    wake();
  });
  socket.once("close", () => {
    done = true;
    wake();
  });

  while (!done || queue.length > 0) {
    const next = queue.shift();
    if (next !== undefined) {
      yield next;
      continue;
    }
    if (failure !== undefined) {
      throw failure;
    }
    await new Promise<void>((resolve) => {
      notify = resolve;
    });
  }
}

function resolveCartesiaBenchmarkTarget(scenario: ProviderBenchmarkScenario): {
  encoding: CartesiaRawAudioEncoding;
  sampleRateHz: number;
  codec: ProviderBenchmarkCodec;
} {
  if (scenario.targetOutput === "pstn-mulaw") {
    return {
      encoding: "pcm_mulaw",
      sampleRateHz: 8000,
      codec: {
        name: "g711_mulaw",
        sampleRateHz: 8000,
        channels: 1,
      },
    };
  }

  return {
    encoding: "pcm_s16le",
    sampleRateHz: 16000,
    codec: {
      name: "pcm_s16le",
      sampleRateHz: 16000,
      channels: 1,
    },
  };
}

function resolveOpenAiBenchmarkTarget(scenario: ProviderBenchmarkScenario): {
  codec: ProviderBenchmarkCodec;
  requiresTranscode: boolean;
} {
  const codec = {
    name: "pcm_s16le",
    sampleRateHz: 24000,
    channels: 1,
  };
  return {
    codec,
    requiresTranscode: scenario.targetOutput === "pstn-mulaw",
  };
}

function resolveGeminiBenchmarkTarget(scenario: ProviderBenchmarkScenario): {
  codec: ProviderBenchmarkCodec;
  requiresTranscode: boolean;
} {
  const codec = {
    name: "pcm_s16le",
    sampleRateHz: 24000,
    channels: 1,
  };
  return {
    codec,
    requiresTranscode: scenario.targetOutput === "pstn-mulaw",
  };
}

function extractGeminiAudioBase64(body: unknown): string {
  const response = body as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: {
            data?: string | undefined;
          } | undefined;
          inline_data?: {
            data?: string | undefined;
          } | undefined;
        }> | undefined;
      } | undefined;
    }> | undefined;
  };
  const audioBase64 = response.candidates?.[0]?.content?.parts?.find((part) =>
    part.inlineData?.data !== undefined || part.inline_data?.data !== undefined
  );
  const data = audioBase64?.inlineData?.data ?? audioBase64?.inline_data?.data;
  if (data === undefined || data.length === 0) {
    throw new Error("Gemini TTS benchmark response did not include inline audio data.");
  }
  return data;
}

function estimateGeneratedAudioMs(audioBytes: number, codec: ProviderBenchmarkCodec): number {
  if (audioBytes <= 0) {
    return 0;
  }
  const bytesPerSecond = codec.name === "g711_mulaw"
    ? codec.sampleRateHz * codec.channels
    : codec.sampleRateHz * codec.channels * 2;
  return Math.round((audioBytes / bytesPerSecond) * 1000);
}

function bufferLength(buffers: Buffer[]): number {
  return buffers.reduce((total, chunk) => total + chunk.byteLength, 0);
}

function resolveScenarioLanguage(scenario: ProviderBenchmarkScenario): string {
  if (scenario.id.includes("multilingual")) {
    return "es";
  }
  return "en";
}

function requiredEnvValue(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${key} is required for live provider benchmarking.`);
  }
  return value;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function redactBenchmarkResult(result: ProviderBenchmarkResult, captureAudio: boolean): ProviderBenchmarkResult {
  if (result.status !== "ok" || captureAudio) {
    return result;
  }

  const { rawAudioBase64, ...safeResult } = result;
  void rawAudioBase64;
  return safeResult;
}

function isMulawCodec(codec: ProviderBenchmarkCodec) {
  return codec.name === "g711_mulaw" && codec.sampleRateHz === 8000 && codec.channels === 1;
}

function roundUsd(value: number): number {
  return Number(value.toFixed(6));
}
