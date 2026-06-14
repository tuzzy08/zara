import type {
  PstnSandwichTtsInput,
  SandwichStreamingTtsSynthesisInput,
  SandwichTtsProvider,
  SandwichTtsResult,
  SandwichTtsSynthesisInput,
} from "@zara/core";
import { RuntimeProviderFailure } from "@zara/core";
import WebSocket from "ws";

import { CartesiaStreamingAdapter } from "./cartesia-streaming.adapter";

interface WebSocketLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  send(message: string): void;
  close(code?: number, reason?: string): void;
}

export interface CartesiaTtsProviderConfig {
  apiKey: string;
  apiVersion: string;
  websocketFactory?: ((url: string, options?: { headers?: Record<string, string> | undefined }) => WebSocketLike) | undefined;
  resolveVoiceId?: ((input: {
    organizationId: string;
    voiceId: string;
  }) => Promise<string> | string) | undefined;
}

export class CartesiaTtsProvider implements SandwichTtsProvider {
  readonly availability = {
    configured: true,
    missingEnv: [],
  };

  private readonly adapter: CartesiaStreamingAdapter;
  private readonly websocketFactory: (url: string, options?: { headers?: Record<string, string> | undefined }) => WebSocketLike;
  private socketPromise: Promise<WebSocketLike> | null = null;
  private socket: WebSocketLike | null = null;
  private contextCounter = 1;
  private readonly activeContexts = new Map<string, CartesiaContextState>();
  private readonly resolveLibraryVoiceId?: ((input: {
    organizationId: string;
    voiceId: string;
  }) => Promise<string> | string) | undefined;

  constructor(config: CartesiaTtsProviderConfig) {
    this.adapter = new CartesiaStreamingAdapter({
      apiKey: config.apiKey,
      apiVersion: config.apiVersion,
    });
    this.websocketFactory = config.websocketFactory ?? ((url, options) => new WebSocket(url, options));
    this.resolveLibraryVoiceId = config.resolveVoiceId;
  }

  warm(): Promise<void> {
    return this.getOrCreateSocket().then(() => undefined);
  }

  async synthesize(input: SandwichTtsSynthesisInput): Promise<SandwichTtsResult> {
    const output = resolveOutputConfig(input);
    const context = this.createContext(input.abortSignal, output.codec);
    void context.firstAudioResult.catch(() => {});
    const socketPromise = this.getOrCreateSocket();
    const voice = await this.resolveVoiceSettings(input);
    const socket = await socketPromise;

    socket.send(JSON.stringify(this.adapter.createGenerationRequest({
      transcript: input.text,
      contextId: context.contextId,
      voiceId: voice.voiceId,
      language: input.language,
      outputFormat: output.cartesia,
      generationConfig: voice.generationConfig,
      continueGeneration: false,
    })));

    return context.doneResult;
  }

  async synthesizeStreaming(input: SandwichStreamingTtsSynthesisInput): Promise<SandwichTtsResult> {
    const output = resolveOutputConfig(input);
    const context = this.createContext(input.abortSignal, output.codec);
    void context.doneResult.catch(() => {});
    const socket = await this.getOrCreateSocket();

    void this.sendTextContinuations({
      input,
      socket,
      contextId: context.contextId,
      output,
    }).catch((error) => {
      context.fail(error instanceof Error ? error : new Error("Cartesia text streaming failed."));
    });

    return context.firstAudioResult;
  }

  private async sendTextContinuations(input: {
    input: SandwichStreamingTtsSynthesisInput;
    socket: WebSocketLike;
    contextId: string;
    output: ResolvedCartesiaOutputConfig;
  }) {
    const voice = await this.resolveVoiceSettings(input.input);

    for await (const chunk of input.input.textStream) {
      if (chunk.length === 0) {
        continue;
      }

      input.socket.send(JSON.stringify(this.adapter.createGenerationRequest({
        transcript: chunk,
        contextId: input.contextId,
        voiceId: voice.voiceId,
        language: input.input.language,
        outputFormat: input.output.cartesia,
        generationConfig: voice.generationConfig,
        continueGeneration: true,
      })));
    }

    input.socket.send(JSON.stringify(this.adapter.createGenerationRequest({
      transcript: "",
      contextId: input.contextId,
      voiceId: voice.voiceId,
      language: input.input.language,
      outputFormat: input.output.cartesia,
      generationConfig: voice.generationConfig,
      continueGeneration: false,
    })));
  }

  private createContext(
    abortSignal?: AbortSignal | undefined,
    codec?: NonNullable<SandwichTtsResult["codec"]> | undefined,
  ) {
    const contextId = `ctx-${this.contextCounter}`;
    this.contextCounter += 1;
    const audio = new AsyncIterableQueue<string>();
    const wordTimestamps: NonNullable<SandwichTtsResult["wordTimestamps"]> = [];
    let firstByteLatencyMs: number | undefined;
    let done = false;
    let cleanupAbortListener = () => {};
    let resolveFirstAudioResult!: (result: SandwichTtsResult) => void;
    let rejectFirstAudioResult!: (error: Error) => void;
    let resolveDoneResult!: (result: SandwichTtsResult) => void;
    let rejectDoneResult!: (error: Error) => void;
    const firstAudioResult = new Promise<SandwichTtsResult>((resolve, reject) => {
      resolveFirstAudioResult = resolve;
      rejectFirstAudioResult = reject;
    });
    const doneResult = new Promise<SandwichTtsResult>((resolve, reject) => {
      resolveDoneResult = resolve;
      rejectDoneResult = reject;
    });
    const buildResult = (): SandwichTtsResult => ({
      firstByteLatencyMs: firstByteLatencyMs ?? 0,
      ...(codec !== undefined ? { codec } : {}),
      audio,
      ...(wordTimestamps.length > 0 ? { wordTimestamps } : {}),
    });
    const complete = () => {
      if (done) {
        return;
      }

      done = true;
      cleanupAbortListener();
      audio.close();
      this.activeContexts.delete(contextId);
      const result = buildResult();
      resolveFirstAudioResult(result);
      resolveDoneResult(result);
    };
    const fail = (error: Error) => {
      if (done) {
        return;
      }

      done = true;
      cleanupAbortListener();
      audio.fail(error);
      this.activeContexts.delete(contextId);
      rejectFirstAudioResult(error);
      rejectDoneResult(error);
    };
    const abort = () => {
      const failure = new RuntimeProviderFailure(
        "tts",
        "interrupted",
        "Cartesia streaming session was interrupted.",
      );

      this.socket?.close(1000, "tts_interrupted");
      fail(failure);
    };

    if (abortSignal?.aborted) {
      abort();
    } else {
      abortSignal?.addEventListener("abort", abort, { once: true });
      cleanupAbortListener = () => {
        abortSignal?.removeEventListener("abort", abort);
      };
    }

    const context: CartesiaContextState = {
      contextId,
      pushAudio: (chunk, latencyMs) => {
        if (firstByteLatencyMs === undefined) {
          firstByteLatencyMs = latencyMs;
          audio.push(chunk);
          resolveFirstAudioResult(buildResult());
          return;
        }

        audio.push(chunk);
      },
      pushTimestamps: (timestamps) => {
        wordTimestamps.push(...timestamps);
      },
      complete,
      fail,
      firstAudioResult,
      doneResult,
    };
    this.activeContexts.set(contextId, context);
    return context;
  }

  private getOrCreateSocket() {
    if (this.socketPromise !== null) {
      return this.socketPromise;
    }

    const session = this.adapter.createSession();
    this.socketPromise = new Promise<WebSocketLike>((resolve, reject) => {
      const socket = this.websocketFactory(session.websocketUrl, { headers: session.headers });
      this.socket = socket;

      socket.on("open", () => {
        resolve(socket);
      });
      socket.on("message", (buffer) => {
        this.handleMessage(String(buffer));
      });
      socket.on("close", (code, reason) => {
        const failure = this.adapter.mapCloseToRuntimeFailure({
          code: Number(code ?? 1006),
          reason: reason instanceof Buffer ? reason.toString("utf8") : String(reason ?? ""),
        });
        this.failActiveContexts(failure);
        this.socket = null;
        this.socketPromise = null;
      });
      socket.on("error", (error) => {
        const failure = error instanceof Error ? error : new Error("Cartesia websocket error.");
        this.failActiveContexts(failure);
        this.socket = null;
        this.socketPromise = null;
        reject(failure);
      });
    });

    return this.socketPromise;
  }

  private handleMessage(raw: string) {
    const parsed = this.adapter.parseMessage(raw);

    if (parsed === null) {
      return;
    }

    if ("stage" in parsed) {
      this.failActiveContexts(parsed);
      return;
    }

    const context = this.activeContexts.get(parsed.contextId);

    if (context === undefined) {
      return;
    }

    if (parsed.kind === "chunk") {
      context.pushAudio(parsed.audioBase64, parsed.stepTimeMs);
      return;
    }

    if (parsed.kind === "timestamps") {
      context.pushTimestamps(readWordTimestamps(parsed));
      return;
    }

    if (parsed.kind === "done") {
      context.complete();
    }
  }

  private failActiveContexts(error: Error) {
    for (const context of this.activeContexts.values()) {
      context.fail(error);
    }
    this.activeContexts.clear();
  }

  private async resolveVoiceSettings(input: SandwichTtsSynthesisInput | SandwichStreamingTtsSynthesisInput) {
    const voiceConfig = input.voiceConfig;
    if (voiceConfig !== undefined) {
      if (voiceConfig.sourceType === "cloned" && voiceConfig.cloneStatus !== "approved") {
        throw new RuntimeProviderFailure("tts", "failed", "Selected cloned voice is not approved for use.");
      }

      return {
        voiceId: this.resolveLibraryVoiceId === undefined
          ? voiceConfig.voiceId
          : await this.resolveLibraryVoiceId({
              organizationId: input.manifest.tenantId,
              voiceId: voiceConfig.voiceId,
            }),
        generationConfig: {
          ...(voiceConfig.speed !== undefined ? { speed: voiceConfig.speed } : {}),
          ...(voiceConfig.volume !== undefined ? { volume: voiceConfig.volume } : {}),
          ...(voiceConfig.emotion !== undefined ? { emotion: voiceConfig.emotion } : {}),
        },
      };
    }

    return {
      voiceId: resolveVoiceId(input.voiceProfile),
      generationConfig: undefined,
    };
  }
}

interface CartesiaContextState {
  contextId: string;
  pushAudio(chunk: string, latencyMs: number): void;
  pushTimestamps(timestamps: NonNullable<SandwichTtsResult["wordTimestamps"]>): void;
  complete(): void;
  fail(error: Error): void;
  firstAudioResult: Promise<SandwichTtsResult>;
  doneResult: Promise<SandwichTtsResult>;
}

function resolveVoiceId(voiceProfile: Parameters<SandwichTtsProvider["synthesize"]>[0]["voiceProfile"]) {
  switch (voiceProfile) {
    case "neural-hd":
      return "5ee9feff-1265-424a-9d7f-8e4d431a12c7";
    case "expressive":
      return "f786b574-daa5-4673-aa0c-cbe3e8534c02";
    case "economy":
    default:
      return "86e30c1d-714b-4074-a1f2-1cb6b552fb49";
  }
}

interface ResolvedCartesiaOutputConfig {
  cartesia: {
    encoding: "pcm_s16le" | "pcm_mulaw";
    sampleRateHz: number;
  };
  codec?: NonNullable<SandwichTtsResult["codec"]> | undefined;
}

function resolveOutputConfig(
  input: SandwichTtsSynthesisInput | SandwichStreamingTtsSynthesisInput,
): ResolvedCartesiaOutputConfig {
  const telephonyOutput = (input as Partial<PstnSandwichTtsInput>).output;
  if (telephonyOutput?.format === "pcm_mulaw") {
    return {
      cartesia: {
        encoding: "pcm_mulaw",
        sampleRateHz: telephonyOutput.sampleRateHz,
      },
      codec: {
        name: "g711_mulaw",
        sampleRateHz: telephonyOutput.sampleRateHz,
        channels: telephonyOutput.channels,
      },
    };
  }

  return {
    cartesia: {
      encoding: "pcm_s16le",
      sampleRateHz: 16_000,
    },
  };
}

function readWordTimestamps(parsed: {
  words: string[];
  start: number[];
  end: number[];
}) {
  const wordTimestamps: NonNullable<SandwichTtsResult["wordTimestamps"]> = [];

  parsed.words.forEach((word, index) => {
    const start = parsed.start[index];
    const end = parsed.end[index];

    if (typeof start === "number" && typeof end === "number") {
      wordTimestamps.push({ word, start, end });
    }
  });

  return wordTimestamps;
}

class AsyncIterableQueue<TValue> implements AsyncIterable<TValue> {
  private readonly values: TValue[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<TValue>) => void;
    reject: (error: Error) => void;
  }> = [];
  private closed = false;
  private failure: Error | null = null;

  push(value: TValue) {
    const waiter = this.waiters.shift();

    if (waiter !== undefined) {
      waiter.resolve({ done: false, value });
      return;
    }

    this.values.push(value);
  }

  close() {
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.resolve({ done: true, value: undefined });
    }
  }

  fail(error: Error) {
    this.failure = error;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.reject(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<TValue> {
    return {
      next: () => this.next(),
    };
  }

  private next(): Promise<IteratorResult<TValue>> {
    const value = this.values.shift();

    if (value !== undefined) {
      return Promise.resolve({ done: false, value });
    }

    if (this.failure !== null) {
      return Promise.reject(this.failure);
    }

    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }

    return new Promise<IteratorResult<TValue>>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }
}
