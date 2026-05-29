import { RuntimeProviderFailure } from "@zara/core";
import WebSocket from "ws";

import {
  AssemblyAiStreamingAdapter,
  type AssemblyAiAudioEncoding,
  type AssemblyAiTranscriptEvent,
} from "./assemblyai-streaming.adapter";
import type { LiveSandboxSttStreamingSession } from "./sandbox-live-sessions.providers";

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
  readonly availability = {
    configured: true,
    missingEnv: [],
  };

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
    encoding?: AssemblyAiAudioEncoding | undefined;
    onPartial?: ((event: AssemblyAiTranscriptEvent) => void) | undefined;
  }): Promise<LiveSandboxTranscriptionResult> {
    return new Promise<LiveSandboxTranscriptionResult>((resolve, reject) => {
      let done = false;
      const stream = this.createStreamingSession({
        sampleRateHz: input.sampleRateHz,
        encoding: input.encoding,
        onPartial: input.onPartial,
        onFinal: (event) => {
          if (done) {
            return;
          }

          done = true;
          stream.close();
          resolve({
            transcript: event.transcript,
            confidence: event.confidence,
            language: event.language ?? "en",
          });
        },
        onError: (error) => {
          if (done) {
            return;
          }

          done = true;
          reject(error);
        },
      });

      input.audioFramesBase64.forEach((frame) => {
        stream.appendAudioFrame(frame);
      });
      stream.forceEndpoint?.();
    });
  }

  createStreamingSession(input: {
    sampleRateHz: number;
    encoding?: AssemblyAiAudioEncoding | undefined;
    onPartial?: ((event: AssemblyAiTranscriptEvent) => void) | undefined;
    onFinal: (event: LiveSandboxTranscriptionResult) => void;
    onError?: ((error: Error) => void) | undefined;
  }): LiveSandboxSttStreamingSession {
    const session = this.adapter.createSession({
      sampleRateHz: input.sampleRateHz,
      encoding: input.encoding,
      minTurnSilenceMs: 300,
      maxTurnSilenceMs: 1_000,
    });
    const socket = this.websocketFactory(session.websocketUrl, session.headers);
    const queuedFrames: string[] = [];
    let opened = false;
    let closed = false;
    let endpointRequested = false;
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
      if (endpointRequested && !terminating && !closed) {
        terminating = true;
        socket.send(session.terminateMessage);
      }
    });
    socket.on("message", (buffer) => {
      if (closed) {
        return;
      }

      const parsed = this.adapter.parseMessage(String(buffer));

      if (parsed === null) {
        return;
      }

      if (parsed.kind === "partial") {
        input.onPartial?.(parsed);
        return;
      }

      input.onFinal({
        transcript: parsed.transcript,
        confidence: parsed.confidence,
        language: "en",
      });
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
      input.onError?.(error instanceof RuntimeProviderFailure ? error : new Error("AssemblyAI websocket error."));
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
      forceEndpoint() {
        if (closed || terminating) {
          return;
        }

        endpointRequested = true;
        if (!opened) {
          return;
        }

        terminating = true;
        socket.send(session.terminateMessage);
      },
      close() {
        if (closed) {
          return;
        }

        terminating = true;
        if (opened) {
          socket.send(session.terminateMessage);
        }
        socket.close(1000, "done");
      },
    };
  }
}
