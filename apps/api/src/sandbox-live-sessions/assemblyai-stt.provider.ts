import { RuntimeProviderFailure } from "@zara/core";
import WebSocket from "ws";

import {
  AssemblyAiStreamingAdapter,
  type AssemblyAiTranscriptEvent,
} from "./assemblyai-streaming.adapter";

interface WebSocketLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  send(message: string | Buffer): void;
  close(code?: number, reason?: string): void;
}

export interface AssemblyAiSttProviderConfig {
  apiKey: string;
  websocketFactory?: ((url: string, headers: Record<string, string>) => WebSocketLike) | undefined;
}

export interface LiveSandboxTranscriptionResult {
  transcript: string;
  confidence: number;
  language: string;
}

export class AssemblyAiSttProvider {
  private readonly adapter: AssemblyAiStreamingAdapter;
  private readonly websocketFactory: (url: string, headers: Record<string, string>) => WebSocketLike;

  constructor(config: AssemblyAiSttProviderConfig) {
    this.adapter = new AssemblyAiStreamingAdapter({
      apiKey: config.apiKey,
    });
    this.websocketFactory = config.websocketFactory ?? ((url, headers) => new WebSocket(url, { headers }));
  }

  async transcribeTurn(input: {
    audioFramesBase64: string[];
    sampleRateHz: number;
    onPartial?: ((event: AssemblyAiTranscriptEvent) => void) | undefined;
  }): Promise<LiveSandboxTranscriptionResult> {
    const session = this.adapter.createSession({
      sampleRateHz: input.sampleRateHz,
      formatTurns: true,
      endOfTurnConfidenceThreshold: 0.5,
    });

    return new Promise<LiveSandboxTranscriptionResult>((resolve, reject) => {
      const socket = this.websocketFactory(session.websocketUrl, session.headers);
      let done = false;

      socket.on("open", () => {
        input.audioFramesBase64.forEach((frame) => {
          socket.send(Buffer.from(frame, "base64"));
        });
        socket.send(session.terminateMessage);
      });
      socket.on("message", (buffer) => {
        const parsed = this.adapter.parseMessage(String(buffer));

        if (parsed === null) {
          return;
        }

        if (parsed.kind === "partial") {
          input.onPartial?.(parsed);
          return;
        }

        done = true;
        socket.close(1000, "done");
        resolve({
          transcript: parsed.transcript,
          confidence: parsed.confidence,
          language: "en",
        });
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
        reject(error instanceof RuntimeProviderFailure ? error : new Error("AssemblyAI websocket error."));
      });
    });
  }
}
