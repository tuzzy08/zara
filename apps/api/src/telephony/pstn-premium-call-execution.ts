import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import type { PstnAudioFrame } from "@zara/core";

import {
  GeminiLiveRealtimeAdapter,
  type GeminiLiveRealtimeEvent,
} from "../sandbox-live-sessions/gemini-live-realtime.adapter";
import {
  OpenAiRealtimeAdapter,
  type OpenAiRealtimeEvent,
} from "../sandbox-live-sessions/openai-realtime.adapter";
import {
  premiumRealtimeProviderTransportToken,
  type PremiumRealtimeProviderConnection,
  type PremiumRealtimeProviderTransport,
} from "../runtime-sessions/premium-realtime-provider-transport";
import {
  RuntimeSessionsService,
  type RegisteredPremiumRealtimeSession,
} from "../runtime-sessions/runtime-sessions.service";
import { WorkflowsService } from "../workflows/workflows.service";
import { TelephonyService } from "./telephony.service";
import {
  PstnPremiumCallActor,
  type PstnPremiumCallActorProvider,
} from "./pstn-premium-call-actor";
import { PstnPremiumPlaybackController } from "./pstn-premium-playback-controller";

export interface PstnPremiumCallOutput {
  sendMedia(frame: PstnAudioFrame): void;
  clearAudio(): void;
  sendMark(name: string): void;
  close(code: number, reason: string): void;
}

interface ActivePremiumCallExecution {
  organizationId: string;
  dispatchId: string;
  callSessionId: string;
  streamSid: string;
  output: PstnPremiumCallOutput;
  registered: RegisteredPremiumRealtimeSession;
  providerConnection: PremiumRealtimeProviderConnection;
  actor: PstnPremiumCallActor;
  playback: PstnPremiumPlaybackController;
  providerMessages: Promise<void>;
  pendingProviderMessageBytes: number;
  pendingProviderMessageCount: number;
  outboundSequence: number;
}

const maxPendingProviderMessageBytes = 64 * 1_024;
const maxPendingProviderMessageCount = 256;

interface StartPremiumCallExecutionInput {
  organizationId: string;
  dispatchId: string;
  callSessionId: string;
  streamSid: string;
  output: PstnPremiumCallOutput;
}

@Injectable()
export class PstnPremiumCallExecution implements OnApplicationShutdown {
  private readonly executions = new Map<string, ActivePremiumCallExecution>();
  private readonly startingCallSessionIds = new Set<string>();
  private readonly cancelledCallSessions = new Map<string, string>();
  private shuttingDown = false;
  private readonly logger = new Logger(PstnPremiumCallExecution.name);

  constructor(
    private readonly telephonyService: Pick<
      TelephonyService,
      "getState" | "recordPstnPhoneTestCheckpoint"
    >,
    private readonly workflowsService: Pick<WorkflowsService, "getPublishedManifest">,
    private readonly runtimeSessionsService: Pick<
      RuntimeSessionsService,
      "createRealtimeSession" | "getRegisteredSession" | "processProviderMessage" | "updateRegisteredSession" | "terminateRealtimeSession"
    >,
    @Inject(premiumRealtimeProviderTransportToken)
    private readonly providerTransport: PremiumRealtimeProviderTransport,
  ) {}

  async start(input: StartPremiumCallExecutionInput) {
    if (this.shuttingDown) {
      throw new Error("Premium PSTN execution is shutting down.");
    }
    if (this.executions.has(input.callSessionId) || this.startingCallSessionIds.has(input.callSessionId)) {
      throw new Error(`Premium PSTN execution already exists for '${input.callSessionId}'.`);
    }

    this.startingCallSessionIds.add(input.callSessionId);
    try {
      await this.startExecution(input);
    } finally {
      this.startingCallSessionIds.delete(input.callSessionId);
      this.cancelledCallSessions.delete(input.callSessionId);
    }
  }

  private async startExecution(input: StartPremiumCallExecutionInput) {

    const state = await this.telephonyService.getState(input.organizationId);
    const dispatch = state.dispatches.find(
      (candidate) => candidate.id === input.dispatchId && candidate.callSessionId === input.callSessionId,
    );
    if (
      dispatch === undefined
      || dispatch.disposition !== "routed"
      || dispatch.runtimePath !== "pstn-premium-realtime"
      || dispatch.publishedVersionId === undefined
      || dispatch.workspaceId === undefined
    ) {
      throw new Error("Premium PSTN execution requires a routed premium dispatch with an exact workflow version.");
    }

    const manifest = await this.workflowsService.getPublishedManifest({
      organizationId: input.organizationId,
      publishedVersionId: dispatch.publishedVersionId,
    });
    if (
      manifest === null
      || manifest.tenantId !== input.organizationId
      || manifest.workspaceId !== dispatch.workspaceId
      || manifest.publishedVersionId !== dispatch.publishedVersionId
      || manifest.runtimeProfile !== "premium-realtime"
      || manifest.entryAgentId === undefined
    ) {
      throw new Error("The exact premium workflow manifest for this PSTN dispatch is unavailable or invalid.");
    }

    const session = await this.runtimeSessionsService.createRealtimeSession({
      manifest,
      activeAgentId: manifest.entryAgentId,
      budgetAllowed: true,
      organizationId: input.organizationId,
      workspaceId: dispatch.workspaceId,
      actorUserId: `pstn:${input.callSessionId}`,
    });
    const registered = this.runtimeSessionsService.getRegisteredSession(session.sessionId);
    if (registered === null) {
      throw new Error("Premium realtime session registration failed for the PSTN call.");
    }

    let providerConnection: PremiumRealtimeProviderConnection;
    try {
      providerConnection = await this.providerTransport.connect({
        organizationId: registered.organizationId,
        workspaceId: registered.workspaceId,
        actorUserId: registered.actorUserId,
        session: registered.session,
        manifest: registered.manifest,
        mediaProfile: "pstn",
      });
    } catch (error) {
      this.runtimeSessionsService.terminateRealtimeSession(registered.session.sessionId);
      throw error;
    }
    const cancellationReason = this.cancelledCallSessions.get(input.callSessionId);
    if (cancellationReason !== undefined) {
      this.cancelledCallSessions.delete(input.callSessionId);
      this.runtimeSessionsService.terminateRealtimeSession(registered.session.sessionId);
      providerConnection.close(1000, cancellationReason);
      return;
    }
    const actor = new PstnPremiumCallActor({
      callSessionId: input.callSessionId,
      provider: adaptProviderConnection(providerConnection),
      drain: () => this.executions.get(input.callSessionId)?.providerMessages ?? Promise.resolve(),
      terminateRuntime: () => {
        this.runtimeSessionsService.terminateRealtimeSession(registered.session.sessionId);
      },
      closeCaller: (code, reason) => input.output.close(code, reason),
      onTerminal: () => {
        const installed = this.executions.get(input.callSessionId);
        if (installed?.actor === actor) {
          this.executions.delete(input.callSessionId);
        }
      },
    });
    const execution: ActivePremiumCallExecution = {
      ...input,
      registered,
      providerConnection,
      actor,
      playback: new PstnPremiumPlaybackController({
        sendFrame: (frame) => {
          execution.outboundSequence += 1;
          input.output.sendMedia({
            callSessionId: input.callSessionId,
            mediaStreamId: input.streamSid,
            direction: "outbound",
            codec: { name: "g711_mulaw", sampleRateHz: 8_000, channels: 1 },
            sequence: execution.outboundSequence,
            timestampMs: execution.outboundSequence * 20,
            payloadBase64: frame.payloadBase64,
          });
        },
        sendMark: (name) => input.output.sendMark(name),
        clear: () => input.output.clearAudio(),
      }),
      providerMessages: Promise.resolve(),
      pendingProviderMessageBytes: 0,
      pendingProviderMessageCount: 0,
      outboundSequence: 0,
    };
    this.executions.set(input.callSessionId, execution);
    providerConnection.onMessage((message) => {
      const messageBytes = Buffer.byteLength(message, "utf8");
      if (
        execution.pendingProviderMessageBytes + messageBytes > maxPendingProviderMessageBytes
        || execution.pendingProviderMessageCount + 1 > maxPendingProviderMessageCount
      ) {
        this.failExecution(execution, "premium_provider_output_overflow");
        return;
      }
      execution.pendingProviderMessageBytes += messageBytes;
      execution.pendingProviderMessageCount += 1;
      execution.providerMessages = execution.providerMessages
        .then(async () => {
          if (this.executions.get(input.callSessionId) === execution) {
            await this.handleProviderMessage(execution, message);
          }
        })
        .catch((error: unknown) => {
          this.failExecution(execution, "premium_runtime_failed", error);
        })
        .finally(() => {
          execution.pendingProviderMessageBytes = Math.max(
            0,
            execution.pendingProviderMessageBytes - messageBytes,
          );
          execution.pendingProviderMessageCount = Math.max(
            0,
            execution.pendingProviderMessageCount - 1,
          );
        });
    });
    providerConnection.onClose(() => {
      if (this.executions.get(input.callSessionId) !== execution) {
        return;
      }
      this.failExecution(execution, "premium_provider_closed");
    });
    await actor.start();
  }

  async appendInboundFrame(input: { callSessionId: string; frame: PstnAudioFrame }) {
    const execution = this.requireExecution(input.callSessionId);
    if (
      input.frame.codec.name !== "g711_mulaw"
      || input.frame.codec.sampleRateHz !== 8_000
      || input.frame.codec.channels !== 1
      || input.frame.direction !== "inbound"
      || input.frame.mediaStreamId !== execution.streamSid
    ) {
      throw new Error("Premium PSTN execution accepts only inbound G.711 mu-law 8 kHz mono frames for its active stream.");
    }

    const targetSampleRateHz = execution.registered.session.runtime === "gemini-live" ? 16_000 : 24_000;
    const pcm16 = resamplePcm16(
      decodeMuLawBase64(input.frame.payloadBase64),
      8_000,
      targetSampleRateHz,
    );
    const providerMessage = execution.registered.session.runtime === "gemini-live"
        ? {
            realtimeInput: {
              audio: {
                data: encodePcm16Base64(pcm16),
                mimeType: `audio/pcm;rate=${targetSampleRateHz}`,
              },
            },
          }
        : {
            type: "input_audio_buffer.append",
            audio: encodePcm16Base64(pcm16),
          };
    execution.actor.appendInbound({
      message: providerMessage,
      durationMs: (Buffer.from(input.frame.payloadBase64, "base64").length / 8_000) * 1_000,
      byteLength: Buffer.from(input.frame.payloadBase64, "base64").length,
    });
  }

  acknowledgePlaybackMark(input: { callSessionId: string; name: string }) {
    this.executions.get(input.callSessionId)?.playback.acknowledgeMark(input.name);
  }

  async stop(input: { callSessionId: string }) {
    const execution = this.executions.get(input.callSessionId);
    if (execution === undefined) {
      if (this.startingCallSessionIds.has(input.callSessionId)) {
        this.cancelledCallSessions.set(input.callSessionId, "pstn_stream_stopped");
      }
      return;
    }

    await execution.actor.stop("pstn_stream_stopped");
    if (this.executions.get(input.callSessionId) === execution) {
      this.executions.delete(input.callSessionId);
    }
  }

  async onApplicationShutdown() {
    this.shuttingDown = true;
    for (const callSessionId of this.startingCallSessionIds) {
      this.cancelledCallSessions.set(callSessionId, "app_shutdown");
    }
    await Promise.all(
      [...this.executions.values()].map((execution) => execution.actor.stop("app_shutdown")),
    );
    this.executions.clear();
  }

  private failExecution(
    execution: ActivePremiumCallExecution,
    reason: string,
    error?: unknown,
  ) {
    if (this.executions.get(execution.callSessionId) !== execution) {
      return;
    }

    execution.actor.fail(reason);
    if (execution.actor.getState() !== "failed") {
      return;
    }
    this.executions.delete(execution.callSessionId);
    this.logger.error(`[twilio-pstn] ${reason} ${JSON.stringify({
      organizationId: execution.organizationId,
      dispatchId: execution.dispatchId,
      callSessionId: execution.callSessionId,
      runtime: execution.registered.session.runtime,
      error: error instanceof Error ? error.message : undefined,
    })}`);
  }

  private async handleProviderMessage(execution: ActivePremiumCallExecution, rawProviderMessage: string) {
    const registered = execution.registered;
    const result = await this.runtimeSessionsService.processProviderMessage({
      organizationId: registered.organizationId,
      sessionId: registered.session.sessionId,
      workspaceId: registered.workspaceId,
      actorUserId: registered.actorUserId,
      session: registered.session,
      manifest: registered.manifest,
      activeAgentId: registered.activeAgentId,
      transcript: registered.transcript,
      packet: registered.packet,
      rawProviderMessage,
      at: new Date().toISOString(),
    });
    if (this.executions.get(execution.callSessionId) !== execution) {
      return;
    }
    if (result.session !== undefined) {
      registered.session = result.session;
    }
    if (result.activeAgentId !== undefined) {
      registered.activeAgentId = result.activeAgentId;
    }
    if (result.transcript !== undefined) {
      registered.transcript = result.transcript;
    }
    registered.packet = result.packet;
    this.runtimeSessionsService.updateRegisteredSession({
      sessionId: registered.session.sessionId,
      ...(result.session !== undefined ? { session: result.session } : {}),
      ...(result.activeAgentId !== undefined ? { activeAgentId: result.activeAgentId } : {}),
      ...(result.transcript !== undefined ? { transcript: result.transcript } : {}),
      packet: result.packet,
    });

    for (const providerMessage of result.providerMessages) {
      execution.actor.sendProviderMessage(providerMessage);
    }

    for (const event of parseProviderEvents(registered, rawProviderMessage)) {
      await this.projectProviderEvent(execution, event);
    }
  }

  private async projectProviderEvent(
    execution: ActivePremiumCallExecution,
    event: OpenAiRealtimeEvent | GeminiLiveRealtimeEvent,
  ) {
    if (event.type === "audio") {
      if (execution.registered.session.runtime === "openai-realtime") {
        if (!("responseId" in event) || event.responseId === undefined) {
          throw new Error("premium_playback_response_id_missing");
        }
        const result = execution.playback.appendDelta(event.responseId, event.audioBase64);
        if (!result.accepted && result.reason === "response_unregistered") {
          throw new Error("premium_playback_response_unregistered");
        }
        return;
      }
      const sourceRateHz = "mimeType" in event
        ? readSampleRate(event.mimeType) ?? 24_000
        : 24_000;
      const pcm16 = decodePcm16Base64(event.audioBase64);
      const pstnSamples = resamplePcm16(pcm16, sourceRateHz, 8_000);
      execution.outboundSequence += 1;
      execution.output.sendMedia({
        callSessionId: execution.callSessionId,
        mediaStreamId: execution.streamSid,
        direction: "outbound",
        codec: { name: "g711_mulaw", sampleRateHz: 8_000, channels: 1 },
        sequence: execution.outboundSequence,
        timestampMs: Math.round((pstnSamples.length / 8_000) * 1_000),
        payloadBase64: encodeMuLawBase64(pstnSamples),
      });
      return;
    }

    if (event.type === "input_transcript" && event.text.trim().length > 0) {
      await this.recordCheckpoint(execution, "transcriptCreated");
      return;
    }

    if (event.type === "output_transcript" && event.text.trim().length > 0) {
      await this.recordCheckpoint(execution, "agentResponseGenerated");
      return;
    }

    if (
      event.type === "provider_event"
      && "eventType" in event
      && execution.registered.session.runtime === "openai-realtime"
      && event.eventType === "response.created"
    ) {
      const responseId = readString(event.evidence.responseId);
      if (responseId === undefined) {
        throw new Error("premium_playback_response_id_missing");
      }
      execution.playback.startResponse(responseId);
      return;
    }

    if (
      event.type === "provider_event"
      && "eventType" in event
      && execution.registered.session.runtime === "openai-realtime"
      && (event.eventType === "response.output_audio.done" || event.eventType === "response.audio.done")
    ) {
      const responseId = readString(event.evidence.responseId);
      if (responseId === undefined) {
        throw new Error("premium_playback_response_id_missing");
      }
      const result = execution.playback.finishResponse(responseId);
      if (!result.accepted && result.reason === "response_unregistered") {
        throw new Error("premium_playback_response_unregistered");
      }
      return;
    }

    if (isInterruptionEvent(event)) {
      if (execution.registered.session.runtime === "openai-realtime") {
        execution.playback.interrupt();
      } else {
        execution.output.clearAudio();
      }
    }
  }

  private recordCheckpoint(
    execution: ActivePremiumCallExecution,
    checkpoint: "transcriptCreated" | "agentResponseGenerated" | "outboundAudioSent",
  ) {
    return this.telephonyService.recordPstnPhoneTestCheckpoint({
      organizationId: execution.organizationId,
      callSessionId: execution.callSessionId,
      checkpoint,
    });
  }

  private requireExecution(callSessionId: string) {
    const execution = this.executions.get(callSessionId);
    if (execution === undefined) {
      throw new Error(`Premium PSTN execution '${callSessionId}' is not active.`);
    }
    return execution;
  }
}

function parseProviderEvents(
  registered: RegisteredPremiumRealtimeSession,
  rawProviderMessage: string,
) {
  return registered.session.runtime === "gemini-live"
    ? new GeminiLiveRealtimeAdapter({
        apiKey: "server-owned-provider-session",
        model: registered.session.model,
        systemPrompt: "",
        tools: registered.session.toolDeclarations,
      }).parseServerMessage(rawProviderMessage)
    : new OpenAiRealtimeAdapter({
        model: registered.session.model,
        systemPrompt: "",
        tools: registered.session.toolDeclarations,
      }).parseServerMessage(rawProviderMessage);
}

function isInterruptionEvent(event: OpenAiRealtimeEvent | GeminiLiveRealtimeEvent) {
  if (event.type !== "provider_event") {
    return false;
  }
  if ("event" in event) {
    return event.event === "interrupted" || event.event === "activity_start";
  }
  return event.eventType === "input_audio_buffer.speech_started"
    || event.eventType === "response.cancelled";
}

function adaptProviderConnection(
  connection: PremiumRealtimeProviderConnection,
): PstnPremiumCallActorProvider {
  return {
    waitUntilReady: () => connection.waitUntilReady(),
    getBufferedAmountBytes: () => connection.getBufferedAmountBytes(),
    send: (message) => {
      connection.send(message);
      return connection.getBufferedAmountBytes();
    },
    close: (code, reason) => connection.close(code, reason),
  };
}

function readSampleRate(mimeType: string) {
  const match = mimeType.match(/rate=(\d+)/u);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function decodeMuLawBase64(audioBase64: string) {
  const bytes = Buffer.from(audioBase64, "base64");
  const samples = new Float32Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    const value = ~(bytes[index] ?? 0) & 0xff;
    const sign = value & 0x80;
    const exponent = (value >> 4) & 0x07;
    const mantissa = value & 0x0f;
    const magnitude = (((mantissa << 3) + 0x84) << exponent) - 0x84;
    samples[index] = (sign === 0 ? magnitude : -magnitude) / 32768;
  }
  return samples;
}

function encodeMuLawBase64(samples: Float32Array) {
  const bytes = Buffer.alloc(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    let sample = Math.round(Math.max(-1, Math.min(1, samples[index] ?? 0)) * 32767);
    const sign = sample < 0 ? 0x80 : 0;
    if (sample < 0) {
      sample = -sample;
    }
    sample = Math.min(32635, sample) + 0x84;
    let exponent = 7;
    for (let mask = 0x4000; exponent > 0 && (sample & mask) === 0; mask >>= 1) {
      exponent -= 1;
    }
    const mantissa = (sample >> (exponent + 3)) & 0x0f;
    bytes[index] = (~(sign | (exponent << 4) | mantissa)) & 0xff;
  }
  return bytes.toString("base64");
}

function decodePcm16Base64(audioBase64: string) {
  const bytes = Buffer.from(audioBase64, "base64");
  const samples = new Float32Array(Math.floor(bytes.length / 2));
  for (let index = 0; index < samples.length; index += 1) {
    const value = bytes.readInt16LE(index * 2);
    samples[index] = value / (value < 0 ? 0x8000 : 0x7fff);
  }
  return samples;
}

function encodePcm16Base64(samples: Float32Array) {
  const bytes = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    bytes.writeInt16LE(Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), index * 2);
  }
  return bytes.toString("base64");
}

function resamplePcm16(samples: Float32Array, sourceRateHz: number, targetRateHz: number) {
  if (sourceRateHz === targetRateHz || samples.length === 0) {
    return samples;
  }
  const target = new Float32Array(Math.max(1, Math.round(samples.length * targetRateHz / sourceRateHz)));
  const sourceStep = sourceRateHz / targetRateHz;
  for (let index = 0; index < target.length; index += 1) {
    const position = index * sourceStep;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.min(samples.length - 1, lowerIndex + 1);
    const fraction = position - lowerIndex;
    const lower = samples[lowerIndex] ?? 0;
    const upper = samples[upperIndex] ?? lower;
    target[index] = lower + ((upper - lower) * fraction);
  }
  return target;
}
