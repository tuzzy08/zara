import type {
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
  websocketFactory?: ((url: string) => WebSocketLike) | undefined;
}

export class CartesiaTtsProvider implements SandwichTtsProvider {
  readonly availability = {
    configured: true,
    missingEnv: [],
  };

  private readonly adapter: CartesiaStreamingAdapter;
  private readonly websocketFactory: (url: string) => WebSocketLike;
  private socketPromise: Promise<WebSocketLike> | null = null;
  private socket: WebSocketLike | null = null;
  private contextCounter = 1;
  private readonly activeContexts = new Map<string, CartesiaContextState>();

  constructor(config: CartesiaTtsProviderConfig) {
    this.adapter = new CartesiaStreamingAdapter({
      apiKey: config.apiKey,
      apiVersion: config.apiVersion,
    });
    this.websocketFactory = config.websocketFactory ?? ((url) => new WebSocket(url));
  }

  warm(): Promise<void> {
    return this.getOrCreateSocket().then(() => undefined);
  }

  async synthesize(input: SandwichTtsSynthesisInput): Promise<SandwichTtsResult> {
    const context = this.createContext(input.abortSignal);
    void context.firstAudioResult.catch(() => {});
    const socket = await this.getOrCreateSocket();

    socket.send(JSON.stringify(this.adapter.createGenerationRequest({
      transcript: input.text,
      contextId: context.contextId,
      voiceId: resolveVoiceId(input.voiceProfile),
      language: input.language,
      sampleRateHz: 16_000,
      continueGeneration: false,
    })));

    return context.doneResult;
  }

  async synthesizeStreaming(input: SandwichStreamingTtsSynthesisInput): Promise<SandwichTtsResult> {
    const context = this.createContext(input.abortSignal);
    void context.doneResult.catch(() => {});
    const socket = await this.getOrCreateSocket();

    void this.sendTextContinuations({
      input,
      socket,
      contextId: context.contextId,
    }).catch((error) => {
      context.fail(error instanceof Error ? error : new Error("Cartesia text streaming failed."));
    });

    return context.firstAudioResult;
  }

  private async sendTextContinuations(input: {
    input: SandwichStreamingTtsSynthesisInput;
    socket: WebSocketLike;
    contextId: string;
  }) {
    for await (const chunk of input.input.textStream) {
      if (chunk.length === 0) {
        continue;
      }

      input.socket.send(JSON.stringify(this.adapter.createGenerationRequest({
        transcript: chunk,
        contextId: input.contextId,
        voiceId: resolveVoiceId(input.input.voiceProfile),
        language: input.input.language,
        sampleRateHz: 16_000,
        continueGeneration: true,
      })));
    }

    input.socket.send(JSON.stringify(this.adapter.createGenerationRequest({
      transcript: "",
      contextId: input.contextId,
      voiceId: resolveVoiceId(input.input.voiceProfile),
      language: input.input.language,
      sampleRateHz: 16_000,
      continueGeneration: false,
    })));
  }

  private createContext(abortSignal?: AbortSignal | undefined) {
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
      const socket = this.websocketFactory(session.websocketUrl);
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
      return "694f9389-aac1-45b6-b726-9d9369183238";
    case "expressive":
      return "f786b574-daa5-4673-aa0c-cbe3e8534c02";
    case "economy":
    default:
      return "694f9389-aac1-45b6-b726-9d9369183238";
  }
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
