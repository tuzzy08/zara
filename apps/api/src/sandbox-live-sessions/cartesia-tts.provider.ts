import type {
  SandwichTtsProvider,
  SandwichTtsResult,
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

  constructor(config: CartesiaTtsProviderConfig) {
    this.adapter = new CartesiaStreamingAdapter({
      apiKey: config.apiKey,
      apiVersion: config.apiVersion,
    });
    this.websocketFactory = config.websocketFactory ?? ((url) => new WebSocket(url));
  }

  async synthesize(input: Parameters<SandwichTtsProvider["synthesize"]>[0]): Promise<SandwichTtsResult> {
    const session = this.adapter.createSession();
    const audioChunks: string[] = [];
    const wordTimestamps: NonNullable<SandwichTtsResult["wordTimestamps"]> = [];

    return new Promise<SandwichTtsResult>((resolve, reject) => {
      const socket = this.websocketFactory(session.websocketUrl);
      let firstByteLatencyMs = 0;
      let done = false;
      let opened = false;
      const cleanupAbortListener = () => {
        input.abortSignal?.removeEventListener("abort", abort);
      };
      const fail = (error: Error) => {
        if (done) {
          return;
        }

        done = true;
        cleanupAbortListener();
        reject(error);
      };
      const abort = () => {
        const failure = new RuntimeProviderFailure(
          "tts",
          "interrupted",
          "Cartesia streaming session was interrupted.",
        );

        if (opened) {
          socket.close(1000, "tts_interrupted");
        }
        fail(failure);
      };

      if (input.abortSignal?.aborted) {
        abort();
        return;
      }

      input.abortSignal?.addEventListener("abort", abort, { once: true });

      socket.on("open", () => {
        opened = true;
        socket.send(JSON.stringify(this.adapter.createGenerationRequest({
          transcript: input.text,
          contextId: "ctx-1",
          voiceId: resolveVoiceId(input.voiceProfile),
          language: input.language,
          sampleRateHz: 16_000,
        })));
      });
      socket.on("message", (buffer) => {
        const parsed = this.adapter.parseMessage(String(buffer));

        if (parsed === null) {
          return;
        }

        if ("stage" in parsed) {
          fail(parsed);
          return;
        }

        if (parsed.kind === "chunk") {
          if (firstByteLatencyMs === 0) {
            firstByteLatencyMs = parsed.stepTimeMs;
          }

          audioChunks.push(parsed.audioBase64);
          return;
        }

        if (parsed.kind === "timestamps") {
          parsed.words.forEach((word, index) => {
            const start = parsed.start[index];
            const end = parsed.end[index];

            if (typeof start === "number" && typeof end === "number") {
              wordTimestamps.push({ word, start, end });
            }
          });
          return;
        }

        if (parsed.kind === "done") {
          done = true;
          cleanupAbortListener();
          socket.close(1000, "done");
          resolve({
            firstByteLatencyMs,
            audio: arrayToAsyncIterable(audioChunks),
            ...(wordTimestamps.length > 0 ? { wordTimestamps } : {}),
          });
        }
      });
      socket.on("close", (code, reason) => {
        if (done) {
          return;
        }

        fail(this.adapter.mapCloseToRuntimeFailure({
          code: Number(code ?? 1006),
          reason: reason instanceof Buffer ? reason.toString("utf8") : String(reason ?? ""),
        }));
      });
      socket.on("error", (error) => {
        fail(error instanceof Error ? error : new Error("Cartesia websocket error."));
      });
    });
  }
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

async function* arrayToAsyncIterable(chunks: string[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}
