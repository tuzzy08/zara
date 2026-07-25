import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
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
import { PstnCapacityObservability } from "../runtime-observability/pstn-capacity-observability";
import { TelephonyService } from "./telephony.service";
import { PremiumProviderMessagePressure } from "./premium-provider-message-pressure";
import {
  PstnPremiumCallActor,
  type PstnPremiumCallActorProvider,
} from "./pstn-premium-call-actor";
import { PstnPremiumIngressAdmission } from "./pstn-premium-ingress-admission";
import { PstnPremiumPlaybackAdmission } from "./pstn-premium-playback-admission";
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
  providerSocketIds: Set<string>;
  inboundRuntime: RegisteredPremiumRealtimeSession["session"]["runtime"];
  pendingProviderTransition?: PendingProviderTransition | undefined;
  completedPlaybackResponseIds: Set<string>;
  actor: PstnPremiumCallActor;
  playback: PstnPremiumPlaybackController;
  providerMessages: Promise<void>;
  providerLifecycleMessages: Promise<void>;
  providerMessagePressure: PremiumProviderMessagePressure;
  outboundSequence: number;
  geminiResponseSequence: number;
  activeGeminiResponseId?: string | undefined;
  providerFailure?: PremiumProviderFailureContext | undefined;
  terminalFailureCode?: string | undefined;
  terminalLifecycle?: {
    stage: "completed" | "failed";
    reasonCode?: string | undefined;
    persistence?: Promise<void> | undefined;
  } | undefined;
  expectedProviderResponse?: ExpectedProviderResponse | undefined;
  recordedMilestones: Set<string>;
  observabilityFailureLogged: boolean;
  cleanupRecorded: boolean;
  recordedPhoneTestCheckpoints: Set<"transcriptCreated" | "agentResponseGenerated" | "outboundAudioSent">;
  pendingPhoneTestCheckpoints: Set<"transcriptCreated" | "agentResponseGenerated" | "outboundAudioSent">;
}

interface PremiumProviderFailureContext {
  providerErrorCode?: string | undefined;
  providerErrorType?: string | undefined;
  providerErrorReason?: string | undefined;
  providerErrorParam?: string | undefined;
  providerEventId?: string | undefined;
  providerResponseId?: string | undefined;
  providerItemId?: string | undefined;
  providerCallId?: string | undefined;
}

interface ExpectedProviderResponse {
  phase: "initial_greeting" | "caller_turn" | "handoff_continuation";
  deadline: ReturnType<typeof setTimeout>;
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

interface PendingStartupTerminalLifecycle {
  organizationId: string;
  dispatchId: string;
  callSessionId: string;
  stage: "completed" | "failed";
  reasonCode: string;
  persistence?: Promise<void> | undefined;
}

const completedPlaybackResponseLimit = 64;
const providerHandoffTimeoutMs = 5_000;
const providerResponseStartTimeoutMs = 8_000;
const terminalCallSessionLimit = 1_024;
const pendingStartupTerminalLimit = 1_024;
const providerOutputByteLimit = 64 * 1_024;
const providerOutputCountLimit = 256;
const playbackByteLimit = 240_000;
const playbackMarkLimit = 50;
const ingressByteLimit = 256 * 1_024;
interface StartPremiumCallExecutionInput {
  organizationId: string;
  dispatchId: string;
  callSessionId: string;
  streamSid: string;
  output: PstnPremiumCallOutput;
}

@Injectable()
export class PstnPremiumCallExecution {
  private readonly executions = new Map<string, ActivePremiumCallExecution>();
  private readonly startingCallSessionIds = new Set<string>();
  private readonly startingCallCompletions = new Map<string, Promise<void>>();
  private readonly cancelledCallSessions = new Map<
    string,
    { outcome: "completed" | "failed"; reasonCode: string }
  >();
  private readonly pendingStartupTerminals = new Map<string, PendingStartupTerminalLifecycle>();
  private readonly terminalCallSessionIds = new Set<string>();
  private readonly ingressAdmission = new PstnPremiumIngressAdmission();
  private readonly playbackAdmission = new PstnPremiumPlaybackAdmission();
  private shuttingDown = false;
  private readonly logger = new Logger(PstnPremiumCallExecution.name);

  constructor(
    @Inject(TelephonyService)
    private readonly telephonyService: Pick<
      TelephonyService,
      | "loadPstnCallRuntimeContext"
      | "recordPstnPhoneTestCheckpoint"
      | "recordPstnCallLifecycle"
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
    @Optional()
    @Inject(PstnCapacityObservability)
    private readonly capacityObservability?: PstnCapacityObservability,
  ) {}

  async start(input: StartPremiumCallExecutionInput) {
    if (this.shuttingDown) {
      throw new Error("Premium PSTN execution is shutting down.");
    }
    if (
      this.executions.has(input.callSessionId)
      || this.startingCallSessionIds.has(input.callSessionId)
      || this.pendingStartupTerminals.has(input.callSessionId)
    ) {
      throw new Error(`Premium PSTN execution already exists for '${input.callSessionId}'.`);
    }
    if (
      this.pendingStartupTerminals.size + this.startingCallSessionIds.size
      >= pendingStartupTerminalLimit
    ) {
      throw new Error("Premium PSTN startup terminal ownership capacity reached.");
    }

    this.terminalCallSessionIds.delete(input.callSessionId);
    this.startingCallSessionIds.add(input.callSessionId);
    let completeStart!: () => void;
    const startCompletion = new Promise<void>((resolve) => {
      completeStart = resolve;
    });
    this.startingCallCompletions.set(input.callSessionId, startCompletion);
    this.capacityObservability?.trackCall({
      callId: input.callSessionId,
      state: "starting",
      runtimePath: "pstn-premium-realtime",
      provider: "other",
    });
    try {
      await this.startExecution(input);
    } catch (error) {
      const installed = this.executions.get(input.callSessionId);
      if (installed?.terminalLifecycle !== undefined) {
        await this.persistTerminalLifecycle(installed);
      } else if (!this.terminalCallSessionIds.has(input.callSessionId)) {
        const existingPending = this.pendingStartupTerminals.get(input.callSessionId);
        if (existingPending !== undefined) {
          throw error;
        }
        const failure = classifyPremiumCallStartupFailure(error);
        const pending = this.retainPendingStartupTerminal(input, "failed", failure.failureCode);
        await this.persistPendingStartupTerminal(pending);
      }
      throw error;
    } finally {
      this.startingCallSessionIds.delete(input.callSessionId);
      this.cancelledCallSessions.delete(input.callSessionId);
      this.startingCallCompletions.delete(input.callSessionId);
      completeStart();
    }
  }

  private async startExecution(input: StartPremiumCallExecutionInput) {
    const loaded = await runPremiumStartupStage(
      "runtime_context_load",
      "premium_state_unavailable",
      () => this.telephonyService.loadPstnCallRuntimeContext({
        organizationId: input.organizationId,
        callSessionId: input.callSessionId,
      }),
    );
    const dispatch = loaded.outcome === "found" ? loaded.context : undefined;
    if (
      dispatch === undefined
      || dispatch.dispatchId !== input.dispatchId
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
      || manifest.workspaceId !== workspaceId
      || manifest.publishedVersionId !== publishedVersionId
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
    this.capacityObservability?.trackCall({
      callId: input.callSessionId,
      state: "starting",
      runtimePath: "pstn-premium-realtime",
      provider: registered.session.runtime,
    });

    let providerConnection: PremiumRealtimeProviderConnection;
    const providerHandshakeStartedAt = Date.now();
    try {
      providerConnection = await this.providerTransport.connect({
        organizationId: registered.organizationId,
        workspaceId: registered.workspaceId,
        actorUserId: registered.actorUserId,
        session: registered.session,
        manifest: registered.manifest,
      });
    } catch (error) {
      this.capacityObservability?.recordSocketHandshakeAttempt({
        leg: "provider",
        runtimePath: "pstn-premium-realtime",
        provider: registered.session.runtime,
        latencyMs: Math.max(0, Date.now() - providerHandshakeStartedAt),
        outcome: "failed",
      });
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
    const initialProviderSocketId = providerSocketId(input.callSessionId, 0);
    this.capacityObservability?.openSocket({
      socketId: initialProviderSocketId,
      leg: "provider",
      runtimePath: "pstn-premium-realtime",
      provider: registered.session.runtime,
    });
    const cancellation = this.cancelledCallSessions.get(input.callSessionId);
    if (cancellation !== undefined) {
      this.cancelledCallSessions.delete(input.callSessionId);
      this.runtimeSessionsService.terminateRealtimeSession(registered.session.sessionId);
      const pending = this.retainPendingStartupTerminal(
        input,
        cancellation.outcome,
        cancellation.reasonCode,
      );
      try {
        await this.persistPendingStartupTerminal(pending);
      } finally {
        try {
          providerConnection.close(1000, cancellation.reasonCode);
        } catch {
          this.logger.warn(`[twilio-pstn] premium_provider_close_failed ${JSON.stringify({
            organizationId: input.organizationId,
            dispatchId: input.dispatchId,
            callSessionId: input.callSessionId,
          })}`);
        }
        this.capacityObservability?.closeSocket({
          socketId: initialProviderSocketId,
          initiator: "local",
          code: 1000,
        });
      }
      return;
    }
    const readinessStartedAt = providerHandshakeStartedAt;
    let readinessRecorded = false;
    const actor = new PstnPremiumCallActor({
      callSessionId: input.callSessionId,
      provider: adaptProviderConnection(providerConnection, {
        onSend: (messageBytes, bufferedBytes) => {
          this.capacityObservability?.recordSocketTraffic({
            socketId: initialProviderSocketId,
            direction: "outbound",
            messageCount: 1,
            byteCount: messageBytes,
          });
          this.capacityObservability?.recordSocketBuffered({
            socketId: initialProviderSocketId,
            bufferedBytes,
          });
        },
      }),
      ingressAdmission: this.ingressAdmission,
      drain: () => {
        const installed = this.executions.get(input.callSessionId);
        return installed === undefined
          ? Promise.resolve()
          : Promise.all([installed.providerMessages, installed.providerLifecycleMessages]).then(() => undefined);
      },
      terminateRuntime: () => {
        this.runtimeSessionsService.terminateRealtimeSession(registered.session.sessionId);
      },
      closeCaller: (code, reason) => input.output.close(code, reason),
      onReady: () => {
        readinessRecorded = true;
        this.recordLifecycle(execution, "provider-ready");
        this.recordLifecycle(execution, "active");
        this.capacityObservability?.recordSocketHandshake({
          socketId: providerSocketId(input.callSessionId, execution.providerEpoch),
          latencyMs: Math.max(0, Date.now() - readinessStartedAt),
          outcome: "accepted",
        });
        this.capacityObservability?.trackCall({
          callId: input.callSessionId,
          state: "active",
          runtimePath: "pstn-premium-realtime",
          provider: execution.registered.session.runtime,
        });
        this.recordMilestone(execution, "provider_ready", "premium.readiness", {
          provider: execution.registered.session.runtime,
          ready: true,
          readinessLatencyMs: Math.max(0, Date.now() - readinessStartedAt),
        });
        try {
          const greeting = buildInitialGreetingMessage(execution.registered);
          execution.actor.sendProviderMessage(greeting);
          this.expectProviderResponse(execution, "initial_greeting");
        } catch (error) {
          execution.actor.fail(
            error instanceof Error && error.message === "premium_initial_agent_identity_unavailable"
              ? error.message
              : "premium_provider_send_failed",
          );
        }
      },
      onFailure: (reason) => {
        execution.terminalFailureCode = reason;
        if (!readinessRecorded && reason.startsWith("premium_provider_readiness_")) {
          readinessRecorded = true;
          this.capacityObservability?.recordSocketHandshake({
            socketId: providerSocketId(input.callSessionId, execution.providerEpoch),
            latencyMs: Math.max(0, Date.now() - readinessStartedAt),
            outcome: "failed",
          });
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
      onTerminal: (state) => {
        const installed = this.executions.get(input.callSessionId);
        if (installed?.actor === actor) {
          const persistence = this.beginTerminalLifecycle(
            installed,
            state === "failed" ? "failed" : "completed",
            installed.terminalFailureCode,
          );
          void persistence.catch(() => undefined);
        }
      },
    });
    const execution: ActivePremiumCallExecution = {
      ...input,
      registered,
      providerConnection,
      providerEpoch: 0,
      providerSocketIds: new Set([initialProviderSocketId]),
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
          this.recordMilestone(
            execution,
            "twilio_media_sent",
            "media.first_outbound_frame",
            {
            sequence: execution.outboundSequence,
            frameBytes: Buffer.from(frame.payloadBase64, "base64").length,
            },
          );
        },
        sendMark: (name) => input.output.sendMark(name),
        clear: () => input.output.clearAudio(),
        onResponseCompleted: ({ responseId }) => {
          this.recordCompletedPlaybackResponse(execution, responseId);
        },
      }, { admission: this.playbackAdmission }),
      providerMessages: Promise.resolve(),
      providerLifecycleMessages: Promise.resolve(),
      providerMessagePressure: new PremiumProviderMessagePressure(),
      outboundSequence: 0,
      geminiResponseSequence: 0,
      expectedProviderResponse: undefined,
      recordedMilestones: new Set(),
      observabilityFailureLogged: false,
      cleanupRecorded: false,
      recordedPhoneTestCheckpoints: new Set(),
      pendingPhoneTestCheckpoints: new Set(),
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
      const socketId = providerSocketId(execution.callSessionId, providerEpoch);
      this.capacityObservability?.recordSocketTraffic({
        socketId,
        direction: "inbound",
        messageCount: 1,
        byteCount: messageBytes,
      });
      this.capacityObservability?.recordSocketBuffered({
        socketId,
        bufferedBytes: providerConnection.getBufferedAmountBytes(),
      });
      try {
        execution.providerMessagePressure.assertMessageWithinLimit(messageBytes);
      } catch (error) {
        const pending = execution.providerMessagePressure.getSnapshot();
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
      let providerEvents: Array<OpenAiRealtimeEvent | GeminiLiveRealtimeEvent>;
      try {
        providerEvents = parseProviderEvents(execution.registered, message);
      } catch (error) {
        this.failExecution(execution, classifyPremiumRuntimeFailure(error));
        return;
      }
      const urgentEvents = providerEvents.filter(isUrgentProviderEvent);
      const deferredEvents = providerEvents.filter(isDeferredProjectedProviderEvent);
      const requiresControlProcessing = isRuntimeControlProviderMessage(providerEvents);
      if (requiresControlProcessing) {
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
      }
      execution.providerLifecycleMessages = execution.providerLifecycleMessages
        .then(async () => {
          for (const event of urgentEvents) {
            if (!this.isCurrentProviderLeg(execution, providerEpoch)) return;
            await this.projectProviderEvent(execution, event);
          }
        })
        .catch((error: unknown) => {
          this.failExecution(execution, classifyPremiumRuntimeFailure(error));
        });
      if (!requiresControlProcessing && deferredEvents.length === 0) {
        return;
      }
      execution.providerMessages = execution.providerMessages
        .then(async () => {
          if (this.isCurrentProviderLeg(execution, providerEpoch)) {
            if (requiresControlProcessing) {
              await this.handleProviderMessage(execution, message, providerEpoch, deferredEvents);
            } else {
              for (const event of deferredEvents) {
                await this.projectProviderEvent(execution, event);
              }
            }
          }
        })
        .catch((error: unknown) => {
          this.failExecution(execution, classifyPremiumRuntimeFailure(error));
        })
        .finally(() => {
          if (requiresControlProcessing) {
            execution.providerMessagePressure.release(messageBytes);
            this.recordProviderOutputPressure(execution);
          }
        });
    });
    providerConnection.onClose((event) => {
      this.capacityObservability?.closeSocket({
        socketId: providerSocketId(execution.callSessionId, providerEpoch),
        initiator: "remote",
        code: event.code,
      });
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
    if (execution.terminalLifecycle !== undefined) {
      return { accepted: false, reason: "terminal" } as const;
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
    const ingressQueue = pressure.state === "handing_off" ? "handoff_ingress" : "startup_ingress";
    this.capacityObservability?.recordQueue({
      callId: execution.callSessionId,
      queue: ingressQueue,
      bytes: pressure.ingressDepthBytes,
      items: Math.ceil(pressure.ingressDepthBytes / 160),
      byteLimit: ingressByteLimit,
      itemLimit: Math.ceil(ingressByteLimit / 160),
    });
    this.capacityObservability?.recordSocketBuffered({
      socketId: providerSocketId(execution.callSessionId, execution.providerEpoch),
      bufferedBytes: pressure.providerBufferedBytes,
    });
    this.recordPremiumEvent(execution, {
      type: "premium.pressure",
      at: new Date().toISOString(),
      payload: pressure,
    });
  }

  acknowledgePlaybackMark(input: { callSessionId: string; name: string }) {
    const execution = this.executions.get(input.callSessionId);
    execution?.playback.acknowledgeMark(input.name);
    if (execution !== undefined) {
      this.recordMilestone(execution, "twilio_mark_acknowledged", "premium.playback", {
        markName: input.name,
      });
      this.recordPlayback(execution);
    }
  }

  async stop(input: {
    callSessionId: string;
    outcome?: "completed" | "failed" | undefined;
    reasonCode?: string | undefined;
  }) {
    const outcome = input.outcome ?? "completed";
    const reasonCode =
      input.reasonCode ?? (outcome === "failed" ? "premium_call_failed" : "pstn_stream_stopped");
    let execution = this.executions.get(input.callSessionId);
    if (execution === undefined) {
      if (this.startingCallSessionIds.has(input.callSessionId)) {
        const existingCancellation = this.cancelledCallSessions.get(input.callSessionId);
        if (existingCancellation?.outcome !== "failed") {
          this.cancelledCallSessions.set(input.callSessionId, { outcome, reasonCode });
        }
        await this.startingCallCompletions.get(input.callSessionId);
      }
      const pending = this.pendingStartupTerminals.get(input.callSessionId);
      if (pending !== undefined) {
        await this.persistPendingStartupTerminal(pending);
        return;
      }
      execution = this.executions.get(input.callSessionId);
      if (execution === undefined) {
        if (this.terminalCallSessionIds.has(input.callSessionId)) return;
        throw new Error(
          `Premium PSTN execution '${input.callSessionId}' is not active.`,
        );
      }
    }
    if (execution.terminalLifecycle !== undefined) {
      await this.persistTerminalLifecycle(execution);
      return;
    }

    if (outcome === "failed") {
      execution.terminalFailureCode = reasonCode;
      execution.actor.fail(reasonCode);
      await this.persistTerminalLifecycle(execution);
      return;
    }

    this.capacityObservability?.trackCall({
      callId: input.callSessionId,
      state: "draining",
      runtimePath: "pstn-premium-realtime",
      provider: execution.registered.session.runtime,
    });
    this.recordLifecycle(execution, "draining");
    await execution.actor.stop(reasonCode);
    await this.persistTerminalLifecycle(execution);
  }

  async shutdown() {
    this.shuttingDown = true;
    const startCompletions = [...this.startingCallCompletions.values()];
    for (const callSessionId of this.startingCallSessionIds) {
      this.cancelledCallSessions.set(callSessionId, {
        outcome: "failed",
        reasonCode: "app_shutdown",
      });
    }
    const executionsAtShutdown = [...this.executions.values()];
    for (const execution of executionsAtShutdown) {
      if (execution.terminalLifecycle !== undefined) continue;
      execution.terminalFailureCode = "app_shutdown";
      execution.actor.fail("app_shutdown");
    }
    await Promise.all(startCompletions);
    const executions = [...new Set([
      ...executionsAtShutdown,
      ...this.executions.values(),
    ])];
    for (const execution of executions) {
      if (execution.terminalLifecycle === undefined) {
        execution.terminalFailureCode = "app_shutdown";
        execution.actor.fail("app_shutdown");
      }
    }
    await Promise.all(executions.map((execution) => this.persistTerminalLifecycle(execution)));
    await Promise.all(
      [...this.pendingStartupTerminals.values()]
        .map((pending) => this.persistPendingStartupTerminal(pending)),
    );
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
  }

  private async handleProviderMessage(
    execution: ActivePremiumCallExecution,
    rawProviderMessage: string,
    providerEpoch: number,
    providerEvents: Array<OpenAiRealtimeEvent | GeminiLiveRealtimeEvent>,
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

    for (const event of providerEvents) {
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
    this.clearExpectedProviderResponse(execution);
    execution.actor.beginHandoff();
    this.recordLifecycle(execution, "handoff");
    this.capacityObservability?.trackCall({
      callId: execution.callSessionId,
      state: "handing_off",
      runtimePath: "pstn-premium-realtime",
      provider: transition.target.runtime,
    });
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
    const replacementSocketId = providerSocketId(execution.callSessionId, pending.epoch);
    const replacementHandshakeStartedAt = Date.now();
    try {
      replacement = await this.providerTransport.connect({
        organizationId: execution.registered.organizationId,
        workspaceId: execution.registered.workspaceId,
        actorUserId: execution.registered.actorUserId,
        session: targetSession,
        manifest: execution.registered.manifest,
      });
      execution.providerSocketIds.add(replacementSocketId);
      this.capacityObservability?.openSocket({
        socketId: replacementSocketId,
        leg: "provider",
        runtimePath: "pstn-premium-realtime",
        provider: targetSession.runtime,
      });
      if (
        this.executions.get(execution.callSessionId) !== execution
        || execution.pendingProviderTransition !== pending
        || execution.providerEpoch !== pending.epoch
      ) {
        replacement.close(1000, "provider_handoff_cancelled");
        this.capacityObservability?.closeSocket({
          socketId: replacementSocketId,
          initiator: "local",
          code: 1000,
        });
        return;
      }
      pending.replacementConnection = replacement;
      await replacement.waitUntilReady();
      this.capacityObservability?.recordSocketHandshake({
        socketId: replacementSocketId,
        latencyMs: Math.max(0, Date.now() - replacementHandshakeStartedAt),
        outcome: "accepted",
      });
      if (
        this.executions.get(execution.callSessionId) !== execution
        || execution.pendingProviderTransition !== pending
        || execution.providerEpoch !== pending.epoch
      ) {
        replacement.close(1000, "provider_handoff_cancelled");
        this.capacityObservability?.closeSocket({
          socketId: replacementSocketId,
          initiator: "local",
          code: 1000,
        });
        return;
      }

      const sourceConnection = execution.providerConnection;
      execution.providerConnection = replacement;
      this.applyProviderMessageResult(execution, pending.result);
      this.bindProviderConnection(execution, replacement, pending.epoch);
      const continuation = buildProviderContinuationMessage(pending.transition);
      replacement.send(continuation);
      const replacementBufferedBytes = replacement.getBufferedAmountBytes();
      this.capacityObservability?.recordSocketTraffic({
        socketId: replacementSocketId,
        direction: "outbound",
        messageCount: 1,
        byteCount: Buffer.byteLength(JSON.stringify(continuation), "utf8"),
      });
      this.capacityObservability?.recordSocketBuffered({
        socketId: replacementSocketId,
        bufferedBytes: replacementBufferedBytes,
      });
      pending.replacementConnection = undefined;
      execution.actor.completeHandoff(adaptProviderConnection(replacement, {
        onSend: (messageBytes, bufferedBytes) => {
          this.capacityObservability?.recordSocketTraffic({
            socketId: replacementSocketId,
            direction: "outbound",
            messageCount: 1,
            byteCount: messageBytes,
          });
          this.capacityObservability?.recordSocketBuffered({
            socketId: replacementSocketId,
            bufferedBytes,
          });
        },
      }));
      this.recordLifecycle(execution, "active");
      this.expectProviderResponse(execution, "handoff_continuation");
      this.clearProviderTransition(execution);
      execution.pendingProviderTransition = undefined;
      sourceConnection.close(1000, "provider_agent_handoff");
      this.capacityObservability?.closeSocket({
        socketId: providerSocketId(execution.callSessionId, pending.epoch - 1),
        initiator: "local",
        code: 1000,
      });
      this.capacityObservability?.trackCall({
        callId: execution.callSessionId,
        state: "active",
        runtimePath: "pstn-premium-realtime",
        provider: targetSession.runtime,
      });
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
      if (replacement === undefined) {
        this.capacityObservability?.recordSocketHandshakeAttempt({
          leg: "provider",
          runtimePath: "pstn-premium-realtime",
          provider: targetSession.runtime,
          latencyMs: Math.max(0, Date.now() - replacementHandshakeStartedAt),
          outcome: "failed",
        });
      } else {
        this.capacityObservability?.recordSocketHandshake({
          socketId: replacementSocketId,
          latencyMs: Math.max(0, Date.now() - replacementHandshakeStartedAt),
          outcome: "failed",
        });
      }
      if (replacement !== undefined) {
        if (pending.replacementConnection === replacement) {
          pending.replacementConnection = undefined;
        }
        replacement.close(1011, "premium_provider_handoff_failed");
        this.capacityObservability?.closeSocket({
          socketId: replacementSocketId,
          initiator: "local",
          code: 1011,
        });
      }
      this.failExecution(execution, "premium_provider_handoff_failed");
    }
  }

  private isCurrentProviderLeg(
    execution: ActivePremiumCallExecution,
    providerEpoch: number,
  ) {
    return this.executions.get(execution.callSessionId) === execution
      && execution.terminalLifecycle === undefined
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
      this.capacityObservability?.closeSocket({
        socketId: providerSocketId(execution.callSessionId, pending.epoch),
        initiator: "local",
        code: 1011,
      });
    }
  }

  private async projectProviderEvent(
    execution: ActivePremiumCallExecution,
    event: OpenAiRealtimeEvent | GeminiLiveRealtimeEvent,
  ) {
    if (event.type === "provider_failure") {
      execution.providerFailure = {
        ...(event.code !== undefined ? { providerErrorCode: event.code } : {}),
        ...(event.providerErrorType !== undefined ? { providerErrorType: event.providerErrorType } : {}),
        ...(event.param !== undefined ? { providerErrorParam: event.param } : {}),
        ...(event.eventId !== undefined ? { providerEventId: event.eventId } : {}),
        ...(event.responseId !== undefined ? { providerResponseId: event.responseId } : {}),
        ...(event.itemId !== undefined ? { providerItemId: event.itemId } : {}),
        ...(event.callId !== undefined ? { providerCallId: event.callId } : {}),
      };
      this.failExecution(execution, "premium_provider_protocol_error");
      return;
    }

    if (
      event.type === "assistant_response"
      && (event.state === "failed" || event.state === "incomplete")
    ) {
      execution.providerFailure = {
        ...(event.failureCode !== undefined ? { providerErrorCode: event.failureCode } : {}),
        ...(event.failureType !== undefined ? { providerErrorType: event.failureType } : {}),
        ...(event.failureReason !== undefined ? { providerErrorReason: event.failureReason } : {}),
        ...(event.responseId !== undefined ? { providerResponseId: event.responseId } : {}),
      };
      this.failExecution(
        execution,
        event.state === "failed"
          ? "premium_provider_response_failed"
          : "premium_provider_response_incomplete",
      );
      return;
    }

    if (event.type === "audio") {
      this.recordMilestone(execution, "provider_audio_received", "tts.first_byte", {
        ...("responseId" in event && event.responseId !== undefined
          ? { responseId: event.responseId }
          : {}),
      });
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
          this.capacityObservability?.recordQueueDrop({
            callId: execution.callSessionId,
            queue: "twilio_playback",
            reason: "stale",
          });
        }
        if (!result.accepted && result.reason === "response_unregistered") {
          throw new Error("premium_playback_response_unregistered");
        }
        if (result.accepted) {
          this.clearExpectedProviderResponse(execution);
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
      if (result.accepted) {
        this.clearExpectedProviderResponse(execution);
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
      this.recordCheckpoint(execution, "transcriptCreated");
      return;
    }

    if (event.type === "output_transcript" && event.text.trim().length > 0) {
      this.recordCheckpoint(execution, "agentResponseGenerated");
      return;
    }

    if (event.type === "caller_turn" && event.state === "committed") {
      this.expectProviderResponse(
        execution,
        "caller_turn",
      );
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
      this.recordMilestone(execution, "response_started", "model.first_token", { responseId });
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
    this.capacityObservability?.recordQueue({
      callId: execution.callSessionId,
      queue: "twilio_playback",
      bytes: state.queuedAudioBytes,
      items: state.queuedFrameCount,
      byteLimit: playbackByteLimit,
      itemLimit: Math.ceil(playbackByteLimit / 160),
    });
    this.capacityObservability?.recordQueue({
      callId: execution.callSessionId,
      queue: "twilio_marks",
      bytes: 0,
      items: state.inFlightMarkCount,
      byteLimit: 1,
      itemLimit: playbackMarkLimit,
    });
    this.recordPremiumEvent(execution, {
      type: "premium.playback",
      at: new Date().toISOString(),
      payload: {
        outboundQueuedBytes: state.queuedAudioBytes,
        outboundQueuedFrames: state.queuedFrameCount,
        aggregateOutboundQueuedBytes: state.aggregateQueuedAudioBytes,
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
    this.clearExpectedProviderResponse(execution);
    this.recordPremiumEvent(execution, {
      type: "premium.cleanup",
      at: new Date().toISOString(),
      payload: {
        reason,
        ...(execution.terminalFailureCode !== undefined
          ? { failureCode: execution.terminalFailureCode }
          : {}),
      },
    });
    this.logger.log(`[twilio-pstn] premium_cleanup ${JSON.stringify({
      organizationId: execution.organizationId,
      dispatchId: execution.dispatchId,
      callSessionId: execution.callSessionId,
      runtime: execution.registered.session.runtime,
      reason,
      ...(execution.terminalFailureCode !== undefined
        ? { failureCode: execution.terminalFailureCode }
        : {}),
    })}`);
  }

  private recordFailure(execution: ActivePremiumCallExecution, reason: string) {
    const overflow = reason.includes("overflow") || reason === "premium_provider_congested";
    const overflowQueue = capacityQueueForFailure(reason);
    if (overflowQueue !== undefined) {
      this.capacityObservability?.recordQueueDrop({
        callId: execution.callSessionId,
        queue: overflowQueue,
        reason: "overflow",
      });
    }
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
        ...execution.providerFailure,
      },
    });
    execution.providerFailure = undefined;
    this.logger.error(`[twilio-pstn] ${reason} ${JSON.stringify({
      organizationId: execution.organizationId,
      dispatchId: execution.dispatchId,
      callSessionId: execution.callSessionId,
      runtime: execution.registered.session.runtime,
    })}`);
  }

  private recordProviderOutputPressure(execution: ActivePremiumCallExecution) {
    const pressure = execution.providerMessagePressure.getSnapshot();
    const providerBufferedBytes = execution.providerConnection.getBufferedAmountBytes();
    this.capacityObservability?.recordQueue({
      callId: execution.callSessionId,
      queue: "provider_output",
      bytes: providerBufferedBytes,
      items: 0,
      byteLimit: ingressByteLimit,
    });
    this.capacityObservability?.recordQueue({
      callId: execution.callSessionId,
      queue: "tool_handoff",
      bytes: pressure.bytes,
      items: pressure.count,
      byteLimit: providerOutputByteLimit,
      itemLimit: providerOutputCountLimit,
    });
    this.recordPremiumEvent(execution, {
      type: "premium.pressure",
      at: new Date().toISOString(),
      payload: {
        providerOutputDepthBytes: pressure.bytes,
        providerOutputDepthCount: pressure.count,
        providerBufferedBytes,
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
    }).catch(() => {
      if (execution.observabilityFailureLogged) return;
      execution.observabilityFailureLogged = true;
      this.logger.warn(`[twilio-pstn] observability_export_failed ${JSON.stringify({
        organizationId: execution.organizationId,
        dispatchId: execution.dispatchId,
        callSessionId: execution.callSessionId,
        runtime: execution.registered.session.runtime,
      })}`);
    });
  }

  private recordMilestone(
    execution: ActivePremiumCallExecution,
    milestone: string,
    type: PstnCallObservabilityEvent["type"],
    payload: Record<string, unknown> = {},
  ) {
    if (execution.recordedMilestones.has(milestone)) return false;
    execution.recordedMilestones.add(milestone);
    this.recordPremiumEvent(execution, {
      type,
      at: new Date().toISOString(),
      payload: { milestone, ...payload },
    });
    this.logger.log(`[twilio-pstn] premium_milestone ${JSON.stringify({
      organizationId: execution.organizationId,
      dispatchId: execution.dispatchId,
      callSessionId: execution.callSessionId,
      runtime: execution.registered.session.runtime,
      milestone,
      ...payload,
    })}`);
    return true;
  }

  private expectProviderResponse(
    execution: ActivePremiumCallExecution,
    phase: ExpectedProviderResponse["phase"],
  ) {
    this.clearExpectedProviderResponse(execution);
    const expectation: ExpectedProviderResponse = {
      phase,
      deadline: setTimeout(() => {
        if (
          execution.expectedProviderResponse !== expectation
          || this.executions.get(execution.callSessionId) !== execution
        ) {
          return;
        }
        execution.expectedProviderResponse = undefined;
        this.failExecution(execution, "premium_provider_response_timeout");
      }, providerResponseStartTimeoutMs),
    };
    execution.expectedProviderResponse = expectation;
  }

  private clearExpectedProviderResponse(execution: ActivePremiumCallExecution) {
    const expectation = execution.expectedProviderResponse;
    if (expectation === undefined) return;
    clearTimeout(expectation.deadline);
    execution.expectedProviderResponse = undefined;
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
    if (
      execution.recordedPhoneTestCheckpoints.has(checkpoint)
      || execution.pendingPhoneTestCheckpoints.has(checkpoint)
    ) {
      return;
    }
    execution.pendingPhoneTestCheckpoints.add(checkpoint);
    void this.persistCheckpoint(execution, checkpoint);
  }

  private async persistCheckpoint(
    execution: ActivePremiumCallExecution,
    checkpoint: "transcriptCreated" | "agentResponseGenerated" | "outboundAudioSent",
  ) {
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await this.telephonyService.recordPstnPhoneTestCheckpoint({
            organizationId: execution.organizationId,
            callSessionId: execution.callSessionId,
            checkpoint,
          });
          execution.recordedPhoneTestCheckpoints.add(checkpoint);
          return;
        } catch {
          if (attempt < 2) continue;
          this.logger.warn(`[twilio-pstn] phone_test_checkpoint_failed ${JSON.stringify({
            organizationId: execution.organizationId,
            dispatchId: execution.dispatchId,
            callSessionId: execution.callSessionId,
            runtime: execution.registered.session.runtime,
            checkpoint,
            failureCode: "phone_test_checkpoint_persistence_failed",
          })}`);
        }
      }
    } finally {
      execution.pendingPhoneTestCheckpoints.delete(checkpoint);
    }
  }

  private recordLifecycle(
    execution: ActivePremiumCallExecution,
    stage: "provider-ready" | "active" | "handoff" | "draining" | "completed" | "failed",
    reasonCode?: string,
  ) {
    execution.providerLifecycleMessages = execution.providerLifecycleMessages
      .then(() =>
        this.telephonyService.recordPstnCallLifecycle({
          organizationId: execution.organizationId,
          callSessionId: execution.callSessionId,
          stage,
          ...(reasonCode === undefined ? {} : { reasonCode }),
        }),
      )
      .then(() => undefined)
      .catch(() => {
        this.logger.warn(`[twilio-pstn] lifecycle_persistence_failed ${JSON.stringify({
          organizationId: execution.organizationId,
          dispatchId: execution.dispatchId,
          callSessionId: execution.callSessionId,
          stage,
          failureCode: "call_lifecycle_persistence_failed",
        })}`);
      });
  }

  private beginTerminalLifecycle(
    execution: ActivePremiumCallExecution,
    stage: "completed" | "failed",
    reasonCode?: string,
  ) {
    execution.terminalLifecycle ??= {
      stage,
      ...(reasonCode === undefined ? {} : { reasonCode }),
    };
    return this.persistTerminalLifecycle(execution);
  }

  private retainPendingStartupTerminal(
    input: StartPremiumCallExecutionInput,
    stage: "completed" | "failed",
    reasonCode: string,
  ) {
    const existing = this.pendingStartupTerminals.get(input.callSessionId);
    if (existing !== undefined) return existing;

    const pending: PendingStartupTerminalLifecycle = {
      organizationId: input.organizationId,
      dispatchId: input.dispatchId,
      callSessionId: input.callSessionId,
      stage,
      reasonCode,
    };
    this.pendingStartupTerminals.set(input.callSessionId, pending);
    return pending;
  }

  private persistPendingStartupTerminal(pending: PendingStartupTerminalLifecycle) {
    if (this.pendingStartupTerminals.get(pending.callSessionId) !== pending) {
      return Promise.resolve();
    }
    if (pending.persistence !== undefined) {
      return pending.persistence;
    }

    const persistence = this.telephonyService.recordPstnCallLifecycle({
      organizationId: pending.organizationId,
      callSessionId: pending.callSessionId,
      stage: pending.stage,
      reasonCode: pending.reasonCode,
    })
      .then(() => {
        if (this.pendingStartupTerminals.get(pending.callSessionId) !== pending) return;
        this.pendingStartupTerminals.delete(pending.callSessionId);
        this.rememberTerminalCallSession(pending.callSessionId);
        this.capacityObservability?.endCall({
          callId: pending.callSessionId,
          outcome: pending.stage,
        });
      })
      .catch((error: unknown) => {
        this.logger.warn(`[twilio-pstn] lifecycle_persistence_failed ${JSON.stringify({
          organizationId: pending.organizationId,
          dispatchId: pending.dispatchId,
          callSessionId: pending.callSessionId,
          stage: pending.stage,
          failureCode: "call_lifecycle_persistence_failed",
        })}`);
        throw error;
      })
      .finally(() => {
        if (pending.persistence === persistence) {
          pending.persistence = undefined;
        }
      });
    pending.persistence = persistence;
    return persistence;
  }

  private persistTerminalLifecycle(execution: ActivePremiumCallExecution) {
    const terminal = execution.terminalLifecycle;
    if (terminal === undefined) {
      return Promise.reject(new Error(
        `Premium PSTN execution '${execution.callSessionId}' has no terminal lifecycle to persist.`,
      ));
    }
    if (terminal.persistence !== undefined) {
      return terminal.persistence;
    }

    const persistence = execution.providerLifecycleMessages
      .catch(() => undefined)
      .then(() =>
        this.telephonyService.recordPstnCallLifecycle({
          organizationId: execution.organizationId,
          callSessionId: execution.callSessionId,
          stage: terminal.stage,
          ...(terminal.reasonCode === undefined ? {} : { reasonCode: terminal.reasonCode }),
        }),
      )
      .then(() => {
        this.finalizeTerminalExecution(execution, terminal.stage);
      })
      .catch((error: unknown) => {
        this.logger.warn(`[twilio-pstn] lifecycle_persistence_failed ${JSON.stringify({
          organizationId: execution.organizationId,
          dispatchId: execution.dispatchId,
          callSessionId: execution.callSessionId,
          stage: terminal.stage,
          failureCode: "call_lifecycle_persistence_failed",
        })}`);
        throw error;
      })
      .finally(() => {
        if (terminal.persistence === persistence) {
          terminal.persistence = undefined;
        }
      });
    terminal.persistence = persistence;
    execution.providerLifecycleMessages = persistence;
    return persistence;
  }

  private finalizeTerminalExecution(
    execution: ActivePremiumCallExecution,
    outcome: "completed" | "failed",
  ) {
    if (this.executions.get(execution.callSessionId) !== execution) return;

    this.clearExpectedProviderResponse(execution);
    execution.playback.dispose();
    this.recordCleanup(execution, execution.actor.getState());
    this.clearProviderTransition(execution, "provider_handoff_cancelled");
    this.executions.delete(execution.callSessionId);
    this.rememberTerminalCallSession(execution.callSessionId);
    for (const socketId of execution.providerSocketIds) {
      this.capacityObservability?.closeSocket({ socketId, initiator: "local", code: 1000 });
    }
    this.capacityObservability?.endCall({
      callId: execution.callSessionId,
      outcome,
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

function isUrgentProviderEvent(event: OpenAiRealtimeEvent | GeminiLiveRealtimeEvent) {
  return event.type === "provider_failure"
    || event.type === "caller_activity"
    || event.type === "caller_turn"
    || event.type === "assistant_response"
    || event.type === "audio";
}

function isDeferredProjectedProviderEvent(event: OpenAiRealtimeEvent | GeminiLiveRealtimeEvent) {
  return event.type === "input_transcript" || event.type === "output_transcript";
}

function isRuntimeControlProviderMessage(
  events: Array<OpenAiRealtimeEvent | GeminiLiveRealtimeEvent>,
) {
  return events.some((event) => event.type === "tool_call")
    || events.some(
      (event) => event.type === "provider_event"
        && "eventType" in event
        && (event.eventType === "response.created" || event.eventType === "response.done"),
    );
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
  hooks?: {
    onSend(messageBytes: number, bufferedBytes: number): void;
  },
): PstnPremiumCallActorProvider {
  return {
    waitUntilReady: () => connection.waitUntilReady(),
    getBufferedAmountBytes: () => connection.getBufferedAmountBytes(),
    send: (message) => {
      connection.send(message);
      const bufferedBytes = connection.getBufferedAmountBytes();
      hooks?.onSend(Buffer.byteLength(JSON.stringify(message), "utf8"), bufferedBytes);
      return bufferedBytes;
    },
    close: (code, reason) => connection.close(code, reason),
  };
}

function providerSocketId(callSessionId: string, epoch: number) {
  return `provider:${callSessionId}:${epoch}`;
}

function capacityQueueForFailure(reason: string) {
  if (reason === "premium_startup_overflow") return "startup_ingress" as const;
  if (reason === "premium_handoff_overflow") return "handoff_ingress" as const;
  if (reason === "premium_provider_output_overflow") return "tool_handoff" as const;
  if (reason === "premium_provider_congested") return "provider_output" as const;
  if (reason === "premium_playback_overflow" || reason === "premium_playback_capacity_overflow") {
    return "twilio_playback" as const;
  }
  return undefined;
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
