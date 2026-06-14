import { RuntimeProviderFailure } from "@zara/core";
import WebSocket from "ws";

import {
  AssemblyAiStreamingAdapter,
  type AssemblyAiAudioEncoding,
  type AssemblyAiTranscriptEvent,
} from "./assemblyai-streaming.adapter";
import type {
  LiveSandboxSttStreamingConfiguration,
  LiveSandboxSttStreamingSession,
} from "./sandbox-live-sessions.providers";

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
  readonly providerId = "assemblyai-streaming" as const;
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
          stream.terminate();
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
      stream.forceEndpoint();
    });
  }

  createStreamingSession(input: {
    sampleRateHz: number;
    encoding?: AssemblyAiAudioEncoding | undefined;
    config?: LiveSandboxSttStreamingConfiguration | undefined;
    onPartial?: ((event: AssemblyAiTranscriptEvent) => void) | undefined;
    onFinal: (event: LiveSandboxTranscriptionResult) => void;
    onError?: ((error: Error) => void) | undefined;
  }): LiveSandboxSttStreamingSession {
    const session = this.adapter.createSession({
      sampleRateHz: input.sampleRateHz,
      encoding: input.encoding,
      minTurnSilenceMs: input.config?.minTurnSilenceMs ?? 300,
      maxTurnSilenceMs: input.config?.maxTurnSilenceMs ?? 1_000,
      continuousPartials: input.config?.continuousPartials,
      languageCode: input.config?.languageCode,
      keytermsPrompt: input.config?.keytermsPrompt,
      agentContext: input.config?.agentContext,
    });
    const socket = this.websocketFactory(session.websocketUrl, session.headers);
    const queuedFrames: string[] = [];
    const queuedControlMessages: string[] = [];
    let opened = false;
    let closed = false;
    let endpointRequested = false;
    let terminating = false;

    const flushQueuedFrames = () => {
      while (queuedControlMessages.length > 0 && opened && !closed) {
        const message = queuedControlMessages.shift();

        if (message !== undefined) {
          socket.send(message);
        }
      }

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
      if (endpointRequested && !closed) {
        socket.send(session.forceEndpointMessage);
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
        language: parsed.languageCode ?? "en",
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
        if (closed) {
          return;
        }

        endpointRequested = true;
        if (!opened) {
          return;
        }

        socket.send(session.forceEndpointMessage);
      },
      terminate() {
        if (closed) {
          return;
        }

        terminating = true;
        if (opened) {
          socket.send(session.terminateMessage);
        }
        socket.close(1000, "done");
      },
      updateConfiguration(config) {
        if (closed) {
          return;
        }

        const message = session.updateConfigurationMessage(config);
        if (!opened) {
          queuedControlMessages.push(message);
          return;
        }

        socket.send(message);
      },
      close() {
        this.terminate();
      },
    };
  }
}
