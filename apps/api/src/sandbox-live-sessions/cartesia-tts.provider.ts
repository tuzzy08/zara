import type {
  SandwichTtsProvider,
  SandwichTtsResult,
} from "@zara/core";
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

    return new Promise<SandwichTtsResult>((resolve, reject) => {
      const socket = this.websocketFactory(session.websocketUrl);
      let firstByteLatencyMs = 0;
      let done = false;

      socket.on("open", () => {
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
          reject(parsed);
          return;
        }

        if (parsed.kind === "chunk") {
          if (firstByteLatencyMs === 0) {
            firstByteLatencyMs = parsed.stepTimeMs;
          }

          audioChunks.push(parsed.audioBase64);
          return;
        }

        if (parsed.kind === "done") {
          done = true;
          socket.close(1000, "done");
          resolve({
            firstByteLatencyMs,
            audio: arrayToAsyncIterable(audioChunks),
          });
        }
      });
      socket.on("close", (code, reason) => {
        if (done) {
          return;
        }

        reject(this.adapter.mapCloseToRuntimeFailure({
          code: Number(code ?? 1006),
          reason: reason instanceof Buffer ? reason.toString("utf8") : String(reason ?? ""),
        }));
      });
      socket.on("error", (error) => {
        reject(error instanceof Error ? error : new Error("Cartesia websocket error."));
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
