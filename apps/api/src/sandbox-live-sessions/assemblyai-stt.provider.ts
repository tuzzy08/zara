import { RuntimeProviderFailure } from "@zara/core";
import WebSocket from "ws";
import type { ProviderUsageRecordingRepository } from "../billing/provider-usage-recording.repository";

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
  usageRecorder?: ProviderUsageRecordingRepository | undefined;
  websocketFactory?: ((url: string, headers: Record<string, string>) => WebSocketLike) | undefined;
}

export interface LiveSandboxTranscriptionResult {
  transcript: string;
  confidence: number;
  language: string;
}

export interface AssemblyAiSessionUsage {
  providerSessionId: string;
  audioDurationSeconds: number;
  sessionDurationSeconds: number;
}

export class AssemblyAiSttProvider {
  readonly providerId = "assemblyai-streaming" as const;
  readonly availability = {
    configured: true,
    missingEnv: [],
  };

  private readonly adapter: AssemblyAiStreamingAdapter;
  private readonly websocketFactory: (url: string, headers: Record<string, string>) => WebSocketLike;

  constructor(private readonly config: AssemblyAiSttProviderConfig) {
    this.adapter = new AssemblyAiStreamingAdapter({
      apiKey: config.apiKey,
    });
    this.websocketFactory = config.websocketFactory ?? ((url, headers) => new WebSocket(url, { headers }));
  }

  async transcribeTurn(input: {
    audioFramesBase64: string[];
    sampleRateHz: number;
    usageScope?: { organizationId: string; sessionId: string } | undefined;
    encoding?: AssemblyAiAudioEncoding | undefined;
    onPartial?: ((event: AssemblyAiTranscriptEvent) => void) | undefined;
  }): Promise<LiveSandboxTranscriptionResult> {
    return new Promise<LiveSandboxTranscriptionResult>((resolve, reject) => {
      let done = false;
      const stream = this.createStreamingSession({
        sampleRateHz: input.sampleRateHz,
        usageScope: input.usageScope,
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
    usageScope?: { organizationId: string; sessionId: string } | undefined;
    encoding?: AssemblyAiAudioEncoding | undefined;
    config?: LiveSandboxSttStreamingConfiguration | undefined;
    onPartial?: ((event: AssemblyAiTranscriptEvent) => void) | undefined;
    onFinal: (event: LiveSandboxTranscriptionResult) => void;
    onReady?: ((providerSessionId: string) => void) | undefined;
    onSpeechStarted?: (() => void) | undefined;
    onUsage?: ((event: AssemblyAiSessionUsage) => void) | undefined;
    onError?: ((error: Error) => void) | undefined;
  }): LiveSandboxSttStreamingSession & { completed: Promise<void> } {
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
    let socket: WebSocketLike | undefined;
    const queuedFrames: string[] = [];
    const queuedControlMessages: string[] = [];
    let opened = false;
    let closed = false;
    let endpointRequested = false;
    let terminating = false;
    let providerSessionId: string | undefined;
    let lastFinalTurnOrder = -1;
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;
    const recorder = this.config.usageRecorder;
    const scope = input.usageScope === undefined ? undefined : { ...input.usageScope };
    let connectionId: string | undefined;
    let request: { id: string; occurredAt: string } | undefined;
    let recordingFinished = false;
    let complete: () => void = () => {};
    const completed = new Promise<void>(resolve => { complete = resolve; });
    const finishRecording = (usage?: AssemblyAiSessionUsage) => {
      if (recorder === undefined || scope === undefined) { complete(); return; }
      if (recordingFinished || connectionId === undefined) return;
      recordingFinished = true;
      const id = connectionId;
      const endedAt = new Date().toISOString();
      void (async () => {
        if (usage !== undefined && request !== undefined) {
          await recorder.complete(scope.organizationId, request.id, {
            providerRequestId: usage.providerSessionId, occurredAt: request.occurredAt,
            totals: { audioDurationSeconds: usage.audioDurationSeconds, sessionDurationSeconds: usage.sessionDurationSeconds },
          });
        }
        await recorder.finishConnection(scope.organizationId, id, {
          endedAt, outcome: usage === undefined ? "failed" : "closed", providerSessionId: providerSessionId ?? null,
        });
      })().catch(() => input.onError?.(new Error("AssemblyAI usage recording failed."))).finally(complete);
    };

    const flushQueuedFrames = () => {
      while (queuedControlMessages.length > 0 && opened && !closed) {
        const message = queuedControlMessages.shift();

        if (message !== undefined) {
          socket?.send(message);
        }
      }

      while (queuedFrames.length > 0 && opened && !closed) {
        const frame = queuedFrames.shift();

        if (frame !== undefined) {
          socket?.send(Buffer.from(frame, "base64"));
        }
      }
    };

    const connect = () => {
      const connection = this.websocketFactory(session.websocketUrl, session.headers);
      socket = connection;
      connection.on("open", () => {
        if (closed) {
          connection.close(1000, "done");
          return;
        }
        opened = true;
        if (terminating) {
          connection.send(session.terminateMessage);
          return;
        }
        flushQueuedFrames();
        if (endpointRequested && !closed) {
          connection.send(session.forceEndpointMessage);
        }
      });
      connection.on("message", (buffer) => {
        if (closed) {
          return;
        }

        const raw = String(buffer);
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(raw) as Record<string, unknown>;
          if (message === null || typeof message !== "object" || Array.isArray(message)) throw new Error("Invalid message shape.");
        } catch {
          input.onError?.(new Error("AssemblyAI returned an invalid message."));
          return;
        }
        if (message.type === "Begin" && typeof message.id === "string" && message.id.trim()) {
          providerSessionId = message.id;
          if (!terminating) input.onReady?.(providerSessionId);
          return;
        }
        if (message.type === "Termination") {
          clearTimeout(terminationTimer);
          if (providerSessionId !== undefined
            && Number.isSafeInteger(message.audio_duration_seconds) && Number(message.audio_duration_seconds) >= 0
            && Number.isSafeInteger(message.session_duration_seconds) && Number(message.session_duration_seconds) >= 0) {
            const usage = { providerSessionId,
              audioDurationSeconds: Number(message.audio_duration_seconds),
              sessionDurationSeconds: Number(message.session_duration_seconds) };
            finishRecording(usage);
            input.onUsage?.(usage);
          } else {
            finishRecording();
          }
          closed = true;
          socket?.close(1000, "stt_terminated");
          return;
        }
        if (terminating) return;
        if (message.type === "SpeechStarted") {
          input.onSpeechStarted?.();
          return;
        }
        const parsed = this.adapter.parseMessage(raw);

        if (parsed === null) {
          return;
        }

        if (parsed.kind === "partial") {
          input.onPartial?.(parsed);
          return;
        }

        if (Number.isSafeInteger(message.turn_order)) {
          if (Number(message.turn_order) <= lastFinalTurnOrder) return;
          lastFinalTurnOrder = Number(message.turn_order);
        }
        input.onFinal({
          transcript: parsed.transcript,
          confidence: parsed.confidence,
          language: parsed.languageCode ?? "en",
        });
      });
      connection.on("close", (code, reason) => {
        clearTimeout(terminationTimer);
        if (closed) {
          return;
        }

        closed = true;
        finishRecording();
        if (terminating) {
          return;
        }

        input.onError?.(this.adapter.mapCloseToRuntimeFailure({
          code: Number(code ?? 1006),
          reason: reason instanceof Buffer ? reason.toString("utf8") : String(reason ?? ""),
        }));
      });
      connection.on("error", (error) => {
        finishRecording();
        input.onError?.(error instanceof RuntimeProviderFailure ? error : new Error("AssemblyAI websocket error."));
      });
    };

    if (recorder === undefined) {
      connect();
    } else {
      if (scope === undefined || !scope.organizationId.trim() || !scope.sessionId.trim()) {
        throw new Error("AssemblyAI usage recording requires tenant and session scope.");
      }
      const usageRequest = { ...scope, externalScopeId: null, provider: "assemblyai", model: "u3-rt-pro",
        occurredAt: new Date().toISOString() };
      void (async () => {
        connectionId = await recorder.beginConnection(usageRequest);
        request = await recorder.beginObserved({ ...usageRequest, connectionId }, connectionId);
        if (closed) { finishRecording(); return; }
        connect();
      })().catch(() => {
        closed = true;
        clearTimeout(terminationTimer);
        finishRecording();
        if (connectionId === undefined) complete();
        input.onError?.(new Error("AssemblyAI usage recording could not start."));
      });
    }

    return {
      completed,
      appendAudioFrame(audioBase64) {
        if (closed || terminating) {
          return;
        }

        if (!opened) {
          queuedFrames.push(audioBase64);
          return;
        }

        socket?.send(Buffer.from(audioBase64, "base64"));
      },
      forceEndpoint() {
        if (closed || terminating) {
          return;
        }

        endpointRequested = true;
        if (!opened) {
          return;
        }

        socket?.send(session.forceEndpointMessage);
      },
      terminate() {
        if (closed || terminating) {
          return;
        }

        terminating = true;
        queuedFrames.length = 0;
        queuedControlMessages.length = 0;
        terminationTimer = setTimeout(() => {
          closed = true;
          socket?.close(1000, "termination timeout");
          finishRecording();
          input.onError?.(new Error("AssemblyAI termination usage was not received."));
        }, 5_000);
        terminationTimer.unref?.();
        if (opened) {
          socket?.send(session.terminateMessage);
        }
      },
      updateConfiguration(config) {
        if (closed || terminating) {
          return;
        }

        const message = session.updateConfigurationMessage(config);
        if (!opened) {
          queuedControlMessages.push(message);
          return;
        }

        socket?.send(message);
      },
      close() {
        this.terminate();
      },
    };
  }
}
