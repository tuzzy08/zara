import { RuntimeProviderFailure } from "@zara/core";
import WebSocket from "ws";

import {
  CartesiaSttAdapter,
  type CartesiaSttAudioEncoding,
} from "./cartesia-stt.adapter";
import type { LiveSandboxSttStreamingSession } from "./sandbox-live-sessions.providers";

interface WebSocketLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  send(message: string | Buffer): void;
  close(code?: number, reason?: string): void;
}

export interface CartesiaInkSttProviderConfig {
  apiKey: string;
  apiVersion: string;
  websocketFactory?: ((url: string, headers: Record<string, string>) => WebSocketLike) | undefined;
}

export class CartesiaInkSttProvider {
  readonly providerId = "cartesia-ink-2" as const;
  readonly availability = {
    configured: true,
    missingEnv: [],
  };

  private readonly adapter: CartesiaSttAdapter;
  private readonly websocketFactory: (url: string, headers: Record<string, string>) => WebSocketLike;

  constructor(config: CartesiaInkSttProviderConfig) {
    this.adapter = new CartesiaSttAdapter({
      apiKey: config.apiKey,
      apiVersion: config.apiVersion,
    });
    this.websocketFactory = config.websocketFactory ?? ((url, headers) => new WebSocket(url, { headers }));
  }

  createStreamingSession(input: {
    sampleRateHz: number;
    encoding?: CartesiaSttAudioEncoding | undefined;
    config?: { languageCode?: string | undefined } | undefined;
    onPartial?: ((event: { transcript: string; confidence: number; language: string }) => void) | undefined;
    onFinal: (event: { transcript: string; confidence: number; language: string }) => void;
    onError?: ((error: Error) => void) | undefined;
    onTelemetry?: ((event: {
      event: "turn.start" | "turn.update" | "turn.eager_end" | "turn.resume" | "turn.end";
      transcript?: string | undefined;
      requestId?: string | undefined;
    }) => void) | undefined;
  }): LiveSandboxSttStreamingSession {
    const session = this.adapter.createSession({
      sampleRateHz: input.sampleRateHz,
      encoding: input.encoding,
      languageCode: input.config?.languageCode ?? "en",
    });
    const socket = this.websocketFactory(session.websocketUrl, session.headers);
    const queuedFrames: string[] = [];
    let opened = false;
    let closed = false;
    let terminating = false;

    const flushQueuedFrames = () => {
      while (queuedFrames.length > 0 && opened && !closed) {
        const frame = queuedFrames.shift();

        if (frame !== undefined) {
          socket.send(Buffer.from(frame, "base64"));
        }
      }
    };

    socket.on("open", () => {
      opened = true;
      flushQueuedFrames();
    });
    socket.on("message", (buffer) => {
      if (closed) {
        return;
      }

      const parsed = this.adapter.parseMessage(String(buffer));

      if (parsed === null) {
        return;
      }

      if (parsed instanceof RuntimeProviderFailure) {
        input.onError?.(parsed);
        return;
      }

      input.onTelemetry?.({
        event: parsed.event,
        ...(parsed.transcript !== undefined ? { transcript: parsed.transcript } : {}),
        ...(parsed.requestId !== undefined ? { requestId: parsed.requestId } : {}),
      });

      if (parsed.kind === "partial") {
        input.onPartial?.({
          transcript: parsed.transcript,
          confidence: 1,
          language: "en",
        });
        return;
      }

      if (parsed.kind === "final") {
        input.onFinal({
          transcript: parsed.transcript,
          confidence: 1,
          language: "en",
        });
      }
    });
    socket.on("close", (code, reason) => {
      if (closed) {
        return;
      }

      closed = true;
      if (terminating) {
        return;
      }

      input.onError?.(this.adapter.mapCloseToRuntimeFailure({
        code: Number(code ?? 1006),
        reason: reason instanceof Buffer ? reason.toString("utf8") : String(reason ?? ""),
      }));
    });
    socket.on("error", (error) => {
      input.onError?.(error instanceof RuntimeProviderFailure ? error : new Error("Cartesia Ink 2 STT websocket error."));
    });

    return {
      appendAudioFrame(audioBase64) {
        if (closed) {
          return;
        }

        if (!opened) {
          queuedFrames.push(audioBase64);
          return;
        }

        socket.send(Buffer.from(audioBase64, "base64"));
      },
      forceEndpoint() {},
      terminate() {
        if (closed) {
          return;
        }

        terminating = true;
        if (opened) {
          socket.send(session.closeMessage);
        }
        socket.close(1000, "done");
      },
      updateConfiguration() {},
      close() {
        this.terminate();
      },
    };
  }

  async transcribeTurn(): Promise<{
    transcript: string;
    confidence: number;
    language: string;
  }> {
    throw new Error("Cartesia Ink 2 STT supports live streaming sessions only.");
  }
}
