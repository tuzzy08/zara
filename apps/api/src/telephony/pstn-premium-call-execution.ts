import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown } from "@nestjs/common";
import { resolveRuntimeAgent, type PstnAudioFrame } from "@zara/core";

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
  type PremiumRealtimeProviderMessageResult,
  type PremiumRealtimeProviderSessionTransition,
  type RegisteredPremiumRealtimeSession,
} from "../runtime-sessions/runtime-sessions.service";
import { WorkflowsService } from "../workflows/workflows.service";
import {
  pstnCallObservabilityRecorderToken,
  type PstnCallObservabilityEvent,
  type PstnCallObservabilityRecorder,
} from "../runtime-observability/runtime-observability";
import { TelephonyService } from "./telephony.service";
import { PremiumProviderMessagePressure } from "./premium-provider-message-pressure";
import {
  PstnPremiumCallActor,
  type PstnPremiumCallActorProvider,
} from "./pstn-premium-call-actor";
import { PstnPremiumIngressAdmission } from "./pstn-premium-ingress-admission";
import { PstnPremiumPlaybackController } from "./pstn-premium-playback-controller";

export interface PstnPremiumCallOutput {
  sendMedia(frame: PstnAudioFrame): void;
  clearAudio(): void;
  sendMark(name: string): void;
  close(code: number, reason: string): void;
}

export class PstnPremiumCallStartupError extends Error {
  constructor(
    readonly failureCode: string,
    readonly stage: string,
    options?: { cause?: unknown; message?: string },
  ) {
    super(options?.message ?? failureCode, { cause: options?.cause });
    this.name = "PstnPremiumCallStartupError";
  }
}

export function classifyPremiumCallStartupFailure(error: unknown) {
  if (error instanceof PstnPremiumCallStartupError) {
    return {
      failureCode: error.failureCode,
      stage: error.stage,
    };
  }

  const message = error instanceof Error ? error.message : "";
  if (message === "The exact premium workflow manifest for this PSTN dispatch is unavailable or invalid.") {
    return { failureCode: "premium_manifest_unavailable", stage: "manifest_validation" };
  }
  if (message === "Premium PSTN execution requires a routed premium dispatch with an exact workflow version.") {
    return { failureCode: "premium_dispatch_unavailable", stage: "dispatch_validation" };
  }
  if (message.includes("Missing: OPENAI_API_KEY") || message.includes("Missing: GEMINI_API_KEY")) {
    return { failureCode: "premium_provider_not_configured", stage: "provider_connect" };
  }

  return { failureCode: "premium_execution_start_failed", stage: "unknown" };
}

interface ActivePremiumCallExecution {
  organizationId: string;
  dispatchId: string;
  callSessionId: string;
  streamSid: string;
  output: PstnPremiumCallOutput;
  registered: RegisteredPremiumRealtimeSession;
  providerConnection: PremiumRealtimeProviderConnection;
  providerEpoch: number;
  inboundRuntime: RegisteredPremiumRealtimeSession["session"]["runtime"];
  pendingProviderTransition?: PendingProviderTransition | undefined;
  completedPlaybackResponseIds: Set<string>;
  actor: PstnPremiumCallActor;
  playback: PstnPremiumPlaybackController;
  providerMessages: Promise<void>;
  providerMessagePressure: PremiumProviderMessagePressure;
  outboundSequence: number;
  geminiResponseSequence: number;
  activeGeminiResponseId?: string | undefined;
  cleanupRecorded: boolean;
}

interface PendingProviderTransition {
  epoch: number;
  result: PremiumRealtimeProviderMessageResult;
  transition: PremiumRealtimeProviderSessionTransition;
  replacing: boolean;
  startedAtMs: number;
  replacementConnection?: PremiumRealtimeProviderConnection | undefined;
  deadline?: ReturnType<typeof setTimeout> | undefined;
}

const completedPlaybackResponseLimit = 64;
const providerHandoffTimeoutMs = 5_000;
const terminalCallSessionLimit = 1_024;
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
  private readonly terminalCallSessionIds = new Set<string>();
  private readonly ingressAdmission = new PstnPremiumIngressAdmission();
  private shuttingDown = false;
  private readonly logger = new Logger(PstnPremiumCallExecution.name);

  constructor(
    @Inject(TelephonyService)
    private readonly telephonyService: Pick<
      TelephonyService,
      "getState" | "recordPstnPhoneTestCheckpoint"
    >,
    @Inject(WorkflowsService)
    private readonly workflowsService: Pick<WorkflowsService, "getPublishedManifest">,
    @Inject(RuntimeSessionsService)
    private readonly runtimeSessionsService: Pick<
      RuntimeSessionsService,
      "createRealtimeSession" | "getRegisteredSession" | "processProviderMessage" | "updateRegisteredSession" | "terminateRealtimeSession"
    >,
    @Inject(premiumRealtimeProviderTransportToken)
    private readonly providerTransport: PremiumRealtimeProviderTransport,
    @Optional()
    @Inject(pstnCallObservabilityRecorderToken)
    private readonly observabilityRecorder?: PstnCallObservabilityRecorder,
  ) {}

  async start(input: StartPremiumCallExecutionInput) {
    if (this.shuttingDown) {
      throw new Error("Premium PSTN execution is shutting down.");
    }
    if (this.executions.has(input.callSessionId) || this.startingCallSessionIds.has(input.callSessionId)) {
      throw new Error(`Premium PSTN execution already exists for '${input.callSessionId}'.`);
    }

    this.terminalCallSessionIds.delete(input.callSessionId);
    this.startingCallSessionIds.add(input.callSessionId);
    try {
      await this.startExecution(input);
    } finally {
      this.startingCallSessionIds.delete(input.callSessionId);
      this.cancelledCallSessions.delete(input.callSessionId);
    }
  }

  private async startExecution(input: StartPremiumCallExecutionInput) {
    const state = await runPremiumStartupStage(
      "state_load",
      "premium_state_unavailable",
      () => this.telephonyService.getState(input.organizationId),
    );
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
      throw new PstnPremiumCallStartupError(
        "premium_dispatch_unavailable",
        "dispatch_validation",
        { message: "Premium PSTN execution requires a routed premium dispatch with an exact workflow version." },
      );
    }
    const publishedVersionId = dispatch.publishedVersionId;
    const workspaceId = dispatch.workspaceId;

    const manifest = await runPremiumStartupStage(
      "manifest_load",
      "premium_manifest_load_failed",
      () => this.workflowsService.getPublishedManifest({
        organizationId: input.organizationId,
        publishedVersionId,
      }),
    );
    if (
      manifest === null
      || manifest.tenantId !== input.organizationId
      || manifest.workspaceId !== dispatch.workspaceId
      || manifest.publishedVersionId !== dispatch.publishedVersionId
      || manifest.runtimeProfile !== "premium-realtime"
      || manifest.entryAgentId === undefined
    ) {
      throw new PstnPremiumCallStartupError(
        "premium_manifest_unavailable",
        "manifest_validation",
        { message: "The exact premium workflow manifest for this PSTN dispatch is unavailable or invalid." },
      );
    }
    const entryAgentId = manifest.entryAgentId;

    const session = await runPremiumStartupStage(
      "runtime_session_create",
      "premium_runtime_session_create_failed",
      () => this.runtimeSessionsService.createRealtimeSession({
        manifest,
        activeAgentId: entryAgentId,
        budgetAllowed: true,
        organizationId: input.organizationId,
        workspaceId,
        actorUserId: `pstn:${input.callSessionId}`,
        mediaProfile: "pstn",
      }),
    );
    const registered = this.runtimeSessionsService.getRegisteredSession(session.sessionId);
    if (registered === null) {
      throw new PstnPremiumCallStartupError(
        "premium_runtime_session_registration_failed",
        "runtime_session_registration",
        { message: "Premium realtime session registration failed for the PSTN call." },
      );
    }

    let providerConnection: PremiumRealtimeProviderConnection;
    try {
      providerConnection = await this.providerTransport.connect({
        organizationId: registered.organizationId,
        workspaceId: registered.workspaceId,
        actorUserId: registered.actorUserId,
        session: registered.session,
        manifest: registered.manifest,
      });
    } catch (error) {
      this.logger.error(`[twilio-pstn] premium_provider_start_failed ${JSON.stringify({
        organizationId: input.organizationId,
        dispatchId: input.dispatchId,
        callSessionId: input.callSessionId,
        runtime: registered.session.runtime,
      })}`);
      void this.observabilityRecorder?.recordPstnCall({
        traceId: `twilio:${input.callSessionId}`,
        call: {
          organizationId: input.organizationId,
          workspaceId: registered.workspaceId,
          callSessionId: input.callSessionId,
          provider: "twilio",
          runtimeProfile: "premium-realtime",
          runtimePath: "pstn-premium-realtime",
          publishedWorkflowVersionId: registered.manifest.publishedVersionId,
          mediaStreamId: input.streamSid,
        },
        events: [{
          type: "provider.failure",
          at: new Date().toISOString(),
          payload: {
            provider: registered.session.runtime,
            stage: "provider_start",
            code: "premium_provider_start_failed",
            recoverable: false,
          },
        }],
      }).catch(() => undefined);
      this.runtimeSessionsService.terminateRealtimeSession(registered.session.sessionId);
      throw new PstnPremiumCallStartupError(
        "premium_provider_start_failed",
        "provider_connect",
        {
          cause: error,
          ...(error instanceof Error ? { message: error.message } : {}),
        },
      );
    }
    const cancellationReason = this.cancelledCallSessions.get(input.callSessionId);
    if (cancellationReason !== undefined) {
      this.cancelledCallSessions.delete(input.callSessionId);
      this.runtimeSessionsService.terminateRealtimeSession(registered.session.sessionId);
      providerConnection.close(1000, cancellationReason);
      return;
    }
    const readinessStartedAt = Date.now();
    let readinessRecorded = false;
    const actor = new PstnPremiumCallActor({
      callSessionId: input.callSessionId,
      provider: adaptProviderConnection(providerConnection),
      ingressAdmission: this.ingressAdmission,
      drain: () => this.executions.get(input.callSessionId)?.providerMessages ?? Promise.resolve(),
      terminateRuntime: () => {
        this.runtimeSessionsService.terminateRealtimeSession(registered.session.sessionId);
      },
      closeCaller: (code, reason) => input.output.close(code, reason),
      onReady: () => {
        readinessRecorded = true;
        this.recordPremiumEvent(execution, {
          type: "premium.readiness",
          at: new Date().toISOString(),
          payload: {
            provider: execution.registered.session.runtime,
            ready: true,
            readinessLatencyMs: Math.max(0, Date.now() - readinessStartedAt),
          },
        });
        try {
          execution.actor.sendProviderMessage(buildInitialGreetingMessage(execution.registered));
        } catch (error) {
          execution.actor.fail(
            error instanceof Error && error.message === "premium_initial_agent_identity_unavailable"
              ? error.message
              : "premium_provider_send_failed",
          );
        }
      },
      onFailure: (reason) => {
        if (!readinessRecorded && reason.startsWith("premium_provider_readiness_")) {
          readinessRecorded = true;
          this.recordPremiumEvent(execution, {
            type: "premium.readiness",
            at: new Date().toISOString(),
            payload: {
              provider: execution.registered.session.runtime,
              ready: false,
              code: reason,
              readinessLatencyMs: Math.max(0, Date.now() - readinessStartedAt),
            },
          });
        }
        this.recordFailure(execution, reason);
      },
      onTerminal: () => {
        const installed = this.executions.get(input.callSessionId);
        if (installed?.actor === actor) {
          this.recordCleanup(installed, actor.getState());
          this.clearProviderTransition(installed, "provider_handoff_cancelled");
          this.executions.delete(input.callSessionId);
          this.rememberTerminalCallSession(input.callSessionId);
        }
      },
    });
    const execution: ActivePremiumCallExecution = {
      ...input,
      registered,
      providerConnection,
      providerEpoch: 0,
      inboundRuntime: registered.session.runtime,
      completedPlaybackResponseIds: new Set(),
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
        onResponseCompleted: ({ responseId }) => {
          this.recordCompletedPlaybackResponse(execution, responseId);
        },
      }),
      providerMessages: Promise.resolve(),
      providerMessagePressure: new PremiumProviderMessagePressure(),
      outboundSequence: 0,
      geminiResponseSequence: 0,
      cleanupRecorded: false,
    };
    this.executions.set(input.callSessionId, execution);
    this.bindProviderConnection(execution, providerConnection, execution.providerEpoch);
    await runPremiumStartupStage(
      "provider_readiness",
      "premium_provider_readiness_failed",
      () => actor.start(),
    );
  }

  private bindProviderConnection(
    execution: ActivePremiumCallExecution,
    providerConnection: PremiumRealtimeProviderConnection,
    providerEpoch: number,
  ) {
    providerConnection.onMessage((message) => {
      if (!this.isCurrentProviderLeg(execution, providerEpoch)) {
        return;
      }
      const messageBytes = Buffer.byteLength(message, "utf8");
      const pending = execution.providerMessagePressure.getSnapshot();
      try {
        execution.providerMessagePressure.acquire(messageBytes);
      } catch (error) {
        this.recordPremiumEvent(execution, {
          type: "premium.pressure",
          at: new Date().toISOString(),
          payload: {
            providerOutputDepthBytes: pending.bytes + messageBytes,
            providerOutputDepthCount: pending.count + 1,
            providerBufferedBytes: execution.providerConnection.getBufferedAmountBytes(),
            overflow: true,
          },
        });
        this.failExecution(execution, classifyPremiumRuntimeFailure(error));
        return;
      }
      this.recordProviderOutputPressure(execution);
      execution.providerMessages = execution.providerMessages
        .then(async () => {
          if (this.isCurrentProviderLeg(execution, providerEpoch)) {
            await this.handleProviderMessage(execution, message, providerEpoch);
          }
        })
        .catch((error: unknown) => {
          this.failExecution(execution, classifyPremiumRuntimeFailure(error));
        })
        .finally(() => {
          execution.providerMessagePressure.release(messageBytes);
          this.recordProviderOutputPressure(execution);
        });
    });
    providerConnection.onClose(() => {
      if (!this.isCurrentProviderLeg(execution, providerEpoch)) {
        return;
      }
      this.failExecution(execution, "premium_provider_closed");
    });
  }

  async appendInboundFrame(
    input: { callSessionId: string; frame: PstnAudioFrame },
  ): Promise<void | { readonly accepted: false; readonly reason: "terminal" }> {
    const execution = this.executions.get(input.callSessionId);
    if (execution === undefined) {
      if (this.terminalCallSessionIds.has(input.callSessionId)) {
        return { accepted: false, reason: "terminal" } as const;
      }
      throw new Error(`Premium PSTN execution '${input.callSessionId}' is not active.`);
    }
    if (
      input.frame.codec.name !== "g711_mulaw"
      || input.frame.codec.sampleRateHz !== 8_000
      || input.frame.codec.channels !== 1
      || input.frame.direction !== "inbound"
      || input.frame.mediaStreamId !== execution.streamSid
    ) {
      throw new Error("Premium PSTN execution accepts only inbound G.711 mu-law 8 kHz mono frames for its active stream.");
    }

    let providerMessage: Record<string, unknown>;
    if (execution.inboundRuntime === "gemini-live") {
      const targetSampleRateHz = 16_000;
      const pcm16 = resamplePcm16(
        decodeMuLawBase64(input.frame.payloadBase64),
        8_000,
        targetSampleRateHz,
      );
      providerMessage = {
        realtimeInput: {
          audio: {
            data: encodePcm16Base64(pcm16),
            mimeType: `audio/pcm;rate=${targetSampleRateHz}`,
          },
        },
      };
    } else {
      providerMessage = {
        type: "input_audio_buffer.append",
        audio: input.frame.payloadBase64,
      };
    }
    const decodedInputByteLength = Buffer.from(input.frame.payloadBase64, "base64").length;
    execution.actor.appendInbound({
      message: providerMessage,
      durationMs: (decodedInputByteLength / 8_000) * 1_000,
      residentByteLength: Buffer.byteLength(JSON.stringify(providerMessage), "utf8"),
    });
    const pressure = execution.actor.getDiagnostics();
    this.recordPremiumEvent(execution, {
      type: "premium.pressure",
      at: new Date().toISOString(),
      payload: pressure,
    });
  }

  acknowledgePlaybackMark(input: { callSessionId: string; name: string }) {
    const execution = this.executions.get(input.callSessionId);
    execution?.playback.acknowledgeMark(input.name);
    if (execution !== undefined) this.recordPlayback(execution);
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
    this.clearProviderTransition(execution, "pstn_stream_stopped");
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
  ) {
    if (this.executions.get(execution.callSessionId) !== execution) {
      return;
    }

    this.clearProviderTransition(execution, reason);
    execution.actor.fail(reason);
    if (execution.actor.getState() !== "failed") {
      return;
    }
    this.executions.delete(execution.callSessionId);
  }

  private async handleProviderMessage(
    execution: ActivePremiumCallExecution,
    rawProviderMessage: string,
    providerEpoch: number,
  ) {
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
    if (!this.isCurrentProviderLeg(execution, providerEpoch)) {
      return;
    }

    for (const event of parseProviderEvents(registered, rawProviderMessage)) {
      await this.projectProviderEvent(execution, event);
      if (!this.isCurrentProviderLeg(execution, providerEpoch)) {
        return;
      }
    }

    if (result.providerSessionTransition?.requiresReplacement === true) {
      this.beginProviderTransition(execution, result, result.providerSessionTransition);
      return;
    }

    this.applyProviderMessageResult(execution, result);
    for (const providerMessage of result.providerMessages) {
      execution.actor.sendProviderMessage(providerMessage);
    }
  }

  private applyProviderMessageResult(
    execution: ActivePremiumCallExecution,
    result: PremiumRealtimeProviderMessageResult,
  ) {
    const registered = execution.registered;
    if (result.session !== undefined) {
      registered.session = result.session;
      execution.inboundRuntime = result.session.runtime;
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
  }

  private beginProviderTransition(
    execution: ActivePremiumCallExecution,
    result: PremiumRealtimeProviderMessageResult,
    transition: PremiumRealtimeProviderSessionTransition,
  ) {
    if (execution.pendingProviderTransition !== undefined) {
      return;
    }
    execution.actor.beginHandoff();
    if (transition.source.runtime === "gemini-live" && execution.activeGeminiResponseId !== undefined) {
      execution.playback.interrupt();
      execution.activeGeminiResponseId = undefined;
    }
    execution.providerEpoch += 1;
    execution.inboundRuntime = transition.target.runtime;
    const pending: PendingProviderTransition = {
      epoch: execution.providerEpoch,
      result,
      transition,
      replacing: false,
      startedAtMs: Date.now(),
    };
    pending.deadline = setTimeout(() => {
      if (execution.pendingProviderTransition === pending) {
        this.failExecution(execution, "premium_provider_handoff_timeout");
      }
    }, providerHandoffTimeoutMs);
    execution.pendingProviderTransition = pending;
    this.recordPremiumEvent(execution, {
      type: "premium.handoff",
      at: new Date().toISOString(),
      payload: { phase: "started" },
    });
    this.logger.log(`[twilio-pstn] agent.handoff.started ${JSON.stringify({
      organizationId: execution.organizationId,
      dispatchId: execution.dispatchId,
      callSessionId: execution.callSessionId,
      transferId: transition.transfer.id,
      sourceRuntime: transition.source.runtime,
      targetRuntime: transition.target.runtime,
    })}`);

    if (
      transition.sourceResponseId === undefined
      || execution.completedPlaybackResponseIds.has(transition.sourceResponseId)
    ) {
      void this.replaceProviderSession(execution, pending);
    }
  }

  private recordCompletedPlaybackResponse(
    execution: ActivePremiumCallExecution,
    responseId: string,
  ) {
    execution.completedPlaybackResponseIds.delete(responseId);
    execution.completedPlaybackResponseIds.add(responseId);
    if (execution.completedPlaybackResponseIds.size > completedPlaybackResponseLimit) {
      const oldest = execution.completedPlaybackResponseIds.values().next().value as string | undefined;
      if (oldest !== undefined) {
        execution.completedPlaybackResponseIds.delete(oldest);
      }
    }

    const pending = execution.pendingProviderTransition;
    if (pending?.transition.sourceResponseId === responseId) {
      void this.replaceProviderSession(execution, pending);
    }
  }

  private async replaceProviderSession(
    execution: ActivePremiumCallExecution,
    pending: PendingProviderTransition,
  ) {
    if (
      pending.replacing
      || execution.pendingProviderTransition !== pending
      || this.executions.get(execution.callSessionId) !== execution
    ) {
      return;
    }
    pending.replacing = true;
    const targetSession = pending.result.session;
    if (targetSession === undefined) {
      this.failExecution(execution, "premium_provider_handoff_failed");
      return;
    }

    let replacement: PremiumRealtimeProviderConnection | undefined;
    try {
      replacement = await this.providerTransport.connect({
        organizationId: execution.registered.organizationId,
        workspaceId: execution.registered.workspaceId,
        actorUserId: execution.registered.actorUserId,
        session: targetSession,
        manifest: execution.registered.manifest,
      });
      if (
        this.executions.get(execution.callSessionId) !== execution
        || execution.pendingProviderTransition !== pending
        || execution.providerEpoch !== pending.epoch
      ) {
        replacement.close(1000, "provider_handoff_cancelled");
        return;
      }
      pending.replacementConnection = replacement;
      await replacement.waitUntilReady();
      if (
        this.executions.get(execution.callSessionId) !== execution
        || execution.pendingProviderTransition !== pending
        || execution.providerEpoch !== pending.epoch
      ) {
        replacement.close(1000, "provider_handoff_cancelled");
        return;
      }

      const sourceConnection = execution.providerConnection;
      execution.providerConnection = replacement;
      this.applyProviderMessageResult(execution, pending.result);
      this.bindProviderConnection(execution, replacement, pending.epoch);
      replacement.send(buildProviderContinuationMessage(pending.transition));
      pending.replacementConnection = undefined;
      execution.actor.completeHandoff(adaptProviderConnection(replacement));
      this.clearProviderTransition(execution);
      execution.pendingProviderTransition = undefined;
      sourceConnection.close(1000, "provider_agent_handoff");
      this.recordPremiumEvent(execution, {
        type: "premium.handoff",
        at: new Date().toISOString(),
        payload: {
          phase: "completed",
          handoffDurationMs: Math.max(0, Date.now() - pending.startedAtMs),
        },
      });
      this.logger.log(`[twilio-pstn] agent.handoff.completed ${JSON.stringify({
        organizationId: execution.organizationId,
        dispatchId: execution.dispatchId,
        callSessionId: execution.callSessionId,
        transferId: pending.transition.transfer.id,
        sourceAgentId: pending.transition.source.agentId,
        targetAgentId: pending.transition.target.agentId,
        sourceRuntime: pending.transition.source.runtime,
        targetRuntime: pending.transition.target.runtime,
      })}`);
    } catch {
      if (replacement !== undefined) {
        if (pending.replacementConnection === replacement) {
          pending.replacementConnection = undefined;
        }
        replacement.close(1011, "premium_provider_handoff_failed");
      }
      this.failExecution(execution, "premium_provider_handoff_failed");
    }
  }

  private isCurrentProviderLeg(
    execution: ActivePremiumCallExecution,
    providerEpoch: number,
  ) {
    return this.executions.get(execution.callSessionId) === execution
      && execution.providerEpoch === providerEpoch;
  }

  private clearProviderTransition(
    execution: ActivePremiumCallExecution,
    closeReason?: string | undefined,
  ) {
    const pending = execution.pendingProviderTransition;
    if (pending !== undefined && pending.deadline !== undefined) {
      clearTimeout(pending.deadline);
      pending.deadline = undefined;
    }
    if (closeReason !== undefined && pending !== undefined && pending.replacementConnection !== undefined) {
      const replacement = pending.replacementConnection;
      pending.replacementConnection = undefined;
      replacement.close(1011, closeReason);
    }
  }

  private async projectProviderEvent(
    execution: ActivePremiumCallExecution,
    event: OpenAiRealtimeEvent | GeminiLiveRealtimeEvent,
  ) {
    if (event.type === "audio") {
      if (execution.registered.session.runtime === "openai-realtime") {
        if (
          !("responseId" in event)
          || event.responseId === undefined
          || event.itemId === undefined
          || event.contentIndex === undefined
        ) {
          throw new Error("premium_playback_response_identity_missing");
        }
        const result = execution.playback.appendDelta(
          event.responseId,
          event.audioBase64,
          { itemId: event.itemId, contentIndex: event.contentIndex },
        );
        if (!result.accepted && result.reason === "response_invalidated") {
          this.logger.log(`[twilio-pstn] premium_stale_generation_discard ${JSON.stringify({
            organizationId: execution.organizationId,
            callSessionId: execution.callSessionId,
            runtime: execution.registered.session.runtime,
          })}`);
          this.recordPremiumEvent(execution, {
            type: "premium.playback",
            at: new Date().toISOString(),
            payload: { staleGenerationDiscarded: true, playbackCleared: false },
          });
        }
        if (!result.accepted && result.reason === "response_unregistered") {
          throw new Error("premium_playback_response_unregistered");
        }
        this.recordPlayback(execution);
        return;
      }
      if (!("mimeType" in event) || !event.mimeType.startsWith("audio/pcm;")) {
        throw new Error("premium_gemini_output_format_invalid");
      }
      const sourceRateHz = readSampleRate(event.mimeType);
      if (sourceRateHz !== 24_000) {
        throw new Error("premium_gemini_output_format_invalid");
      }
      const pcm16 = decodePcm16Base64(event.audioBase64);
      const pstnSamples = resamplePcm16(pcm16, sourceRateHz, 8_000);
      const responseId = this.ensureGeminiPlaybackResponse(execution);
      const result = execution.playback.appendDelta(responseId, encodeMuLawBase64(pstnSamples));
      if (!result.accepted && result.reason === "response_unregistered") {
        throw new Error("premium_playback_response_unregistered");
      }
      this.recordPlayback(execution);
      return;
    }

    if (
      event.type === "assistant_response"
      && event.state === "completed"
      && execution.registered.session.runtime === "gemini-live"
    ) {
      const responseId = execution.activeGeminiResponseId;
      if (responseId !== undefined) {
        execution.activeGeminiResponseId = undefined;
        const result = execution.playback.finishResponse(responseId);
        if (!result.accepted && result.reason === "response_unregistered") {
          throw new Error("premium_playback_response_unregistered");
        }
      }
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
      event.type === "assistant_response"
      && event.state === "started"
      && execution.registered.session.runtime === "openai-realtime"
    ) {
      const responseId = event.responseId;
      if (responseId === undefined) {
        throw new Error("premium_playback_response_id_missing");
      }
      const result = execution.playback.startResponse(responseId);
      if (!result.accepted) {
        throw new Error(`premium_playback_${result.reason}`);
      }
      return;
    }

    if (
      event.type === "assistant_response"
      && event.state === "audio_completed"
      && execution.registered.session.runtime === "openai-realtime"
    ) {
      const responseId = event.responseId;
      if (responseId === undefined) {
        throw new Error("premium_playback_response_id_missing");
      }
      const result = execution.playback.finishResponse(responseId);
      if (!result.accepted && result.reason === "response_unregistered") {
        throw new Error("premium_playback_response_unregistered");
      }
      return;
    }

    const interruption = event.type === "caller_activity" && event.state === "started"
      ? "caller_activity"
      : event.type === "assistant_response"
        && event.state === "interrupted"
        && execution.registered.session.runtime === "gemini-live"
        ? "provider_interrupted"
        : undefined;
    if (interruption !== undefined) {
      const playbackInterruption = execution.playback.interrupt();
      if (
        execution.registered.session.runtime === "openai-realtime"
        && interruption === "caller_activity"
      ) {
        const adapter = new OpenAiRealtimeAdapter({
          model: execution.registered.session.model,
          systemPrompt: "",
        });
        for (const truncation of playbackInterruption.truncations) {
          execution.actor.sendProviderMessage(
            adapter.createConversationItemTruncateMessage(truncation),
          );
        }
      }
      if (execution.registered.session.runtime === "gemini-live") {
        execution.activeGeminiResponseId = undefined;
      }
      this.recordPremiumEvent(execution, {
        type: "premium.interruption",
        at: new Date().toISOString(),
        payload: {
          playbackCleared: playbackInterruption.playbackCleared,
          truncationCount: playbackInterruption.truncations.length,
          acknowledgedAudioMs: playbackInterruption.truncations.reduce(
            (maximum, truncation) => Math.max(maximum, truncation.audioEndMs),
            0,
          ),
        },
      });
      if (playbackInterruption.playbackCleared) {
        this.logger.log(`[twilio-pstn] premium_playback_clear ${JSON.stringify({
          organizationId: execution.organizationId,
          callSessionId: execution.callSessionId,
          runtime: execution.registered.session.runtime,
        })}`);
      }
      this.recordPlayback(execution);
    }
  }

  private recordPlayback(execution: ActivePremiumCallExecution) {
    const state = execution.playback.getState();
    this.recordPremiumEvent(execution, {
      type: "premium.playback",
      at: new Date().toISOString(),
      payload: {
        outboundQueuedBytes: state.queuedAudioBytes,
        outboundQueuedFrames: state.queuedFrameCount,
        outstandingPlaybackMarks: state.inFlightMarkCount,
        playbackLagMs: state.playbackLagMs,
        playbackGeneration: state.generation,
        acknowledgedBoundaries: state.acknowledgedBoundaryCount,
        droppedFrames: state.droppedFrameCount,
      },
    });
  }

  private recordCleanup(execution: ActivePremiumCallExecution, reason: string) {
    if (execution.cleanupRecorded) return;
    execution.cleanupRecorded = true;
    this.recordPremiumEvent(execution, {
      type: "premium.cleanup",
      at: new Date().toISOString(),
      payload: { reason },
    });
    this.logger.log(`[twilio-pstn] premium_cleanup ${JSON.stringify({
      organizationId: execution.organizationId,
      dispatchId: execution.dispatchId,
      callSessionId: execution.callSessionId,
      runtime: execution.registered.session.runtime,
      reason,
    })}`);
  }

  private recordFailure(execution: ActivePremiumCallExecution, reason: string) {
    const overflow = reason.includes("overflow") || reason === "premium_provider_congested";
    const pendingHandoff = execution.pendingProviderTransition;
    if (pendingHandoff !== undefined) {
      this.recordPremiumEvent(execution, {
        type: "premium.handoff",
        at: new Date().toISOString(),
        payload: {
          phase: "failed",
          code: reason,
          handoffDurationMs: Math.max(0, Date.now() - pendingHandoff.startedAtMs),
        },
      });
    }
    this.recordPremiumEvent(execution, {
      type: isPremiumProviderFailure(reason) ? "provider.failure" : "runtime.failure",
      at: new Date().toISOString(),
      payload: {
        stage: "premium_realtime",
        code: reason,
        recoverable: false,
        overflow,
      },
    });
    this.logger.error(`[twilio-pstn] ${reason} ${JSON.stringify({
      organizationId: execution.organizationId,
      dispatchId: execution.dispatchId,
      callSessionId: execution.callSessionId,
      runtime: execution.registered.session.runtime,
    })}`);
  }

  private recordProviderOutputPressure(execution: ActivePremiumCallExecution) {
    const pressure = execution.providerMessagePressure.getSnapshot();
    this.recordPremiumEvent(execution, {
      type: "premium.pressure",
      at: new Date().toISOString(),
      payload: {
        providerOutputDepthBytes: pressure.bytes,
        providerOutputDepthCount: pressure.count,
        providerBufferedBytes: execution.providerConnection.getBufferedAmountBytes(),
      },
    });
  }

  private recordPremiumEvent(execution: ActivePremiumCallExecution, event: PstnCallObservabilityEvent) {
    const providerConfig = execution.registered.session.providerConfig;
    const projectedEvent: PstnCallObservabilityEvent = {
      ...event,
      payload: {
        realtimeProvider: providerConfig.provider,
        realtimeModel: providerConfig.model,
        conversationPolicyVersion: providerConfig.conversationPolicyVersion,
        mediaProfile: providerConfig.mediaProfile,
        ...event.payload,
      },
    };
    void this.observabilityRecorder?.recordPstnCall({
      traceId: `twilio:${execution.callSessionId}`,
      call: {
        organizationId: execution.organizationId,
        workspaceId: execution.registered.workspaceId,
        callSessionId: execution.callSessionId,
        provider: "twilio",
        runtimeProfile: "premium-realtime",
        runtimePath: "pstn-premium-realtime",
        publishedWorkflowVersionId: execution.registered.manifest.publishedVersionId,
        mediaStreamId: execution.streamSid,
      },
      events: [projectedEvent],
    }).catch(() => undefined);
  }

  private ensureGeminiPlaybackResponse(execution: ActivePremiumCallExecution) {
    if (execution.activeGeminiResponseId !== undefined) {
      return execution.activeGeminiResponseId;
    }
    execution.geminiResponseSequence += 1;
    const responseId = `gemini-turn-${execution.geminiResponseSequence}`;
    const result = execution.playback.startResponse(responseId);
    if (!result.accepted) {
      throw new Error(`premium_playback_${result.reason}`);
    }
    execution.activeGeminiResponseId = responseId;
    return responseId;
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

  private rememberTerminalCallSession(callSessionId: string) {
    this.terminalCallSessionIds.delete(callSessionId);
    this.terminalCallSessionIds.add(callSessionId);
    if (this.terminalCallSessionIds.size <= terminalCallSessionLimit) return;
    const oldest = this.terminalCallSessionIds.values().next().value as string | undefined;
    if (oldest !== undefined) this.terminalCallSessionIds.delete(oldest);
  }
}

async function runPremiumStartupStage<T>(
  stage: string,
  failureCode: string,
  action: () => Promise<T>,
) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof PstnPremiumCallStartupError) {
      throw error;
    }
    throw new PstnPremiumCallStartupError(failureCode, stage, { cause: error });
  }
}

function classifyPremiumRuntimeFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /^premium_[a-z0-9_]+$/.test(message) ? message : "premium_runtime_failed";
}

function isPremiumProviderFailure(reason: string) {
  return reason.startsWith("premium_provider_");
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

function buildProviderContinuationMessage(
  transition: PremiumRealtimeProviderSessionTransition,
): Record<string, unknown> {
  if (transition.target.runtime === "gemini-live") {
    return new GeminiLiveRealtimeAdapter({
      apiKey: "server-owned-provider-session",
      model: transition.target.model,
      systemPrompt: "",
      tools: transition.target.toolDeclarations,
    }).createTextInputMessage(transition.continuation.instruction);
  }

  return new OpenAiRealtimeAdapter({
    model: transition.target.model,
    systemPrompt: "",
    tools: transition.target.toolDeclarations,
  }).createResponseCreateMessage({
    instructions: transition.continuation.instruction,
  });
}

function buildInitialGreetingMessage(
  registered: RegisteredPremiumRealtimeSession,
): Record<string, unknown> {
  const initialGreetingInstruction = buildInitialGreetingInstruction(registered);

  if (registered.session.runtime === "gemini-live") {
    return new GeminiLiveRealtimeAdapter({
      apiKey: "server-owned-provider-session",
      model: registered.session.model,
      systemPrompt: "",
      tools: registered.session.toolDeclarations,
    }).createTextInputMessage(initialGreetingInstruction);
  }

  return new OpenAiRealtimeAdapter({
    model: registered.session.model,
    systemPrompt: "",
    tools: registered.session.toolDeclarations,
  }).createResponseCreateMessage({
    instructions: initialGreetingInstruction,
  });
}

function buildInitialGreetingInstruction(registered: RegisteredPremiumRealtimeSession): string {
  const agent = resolveRuntimeAgent(registered.manifest, registered.activeAgentId);
  const agentName = agent?.name.trim() ?? "";
  const businessName = agent?.businessName.trim() ?? "";

  if (agentName.length === 0 || businessName.length === 0) {
    throw new Error("premium_initial_agent_identity_unavailable");
  }

  return [
    `Begin with exactly: "Hello, this is ${agentName} from ${businessName}. How may I help you today?"`,
    "Use both the configured agent name and business name.",
    "Do not replace either name with a generic role such as support assistant.",
    "Do not claim the caller has already said anything.",
  ].join(" ");
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
