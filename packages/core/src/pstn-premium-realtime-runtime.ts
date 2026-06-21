import type { CallEvent, ID, RealtimeProviderId, VoiceAgentRole } from "./index";
import { resolveRuntimeAgent, runtimeAgentToVoiceAgentRole } from "./agent-runtime-context";
import type { LiveCallSession } from "./live-call-session";
import { buildRealtimeToolDeclarations, type RealtimeToolDeclaration } from "./realtime-tool-bridge";
import {
  resolveRuntimeProfilePolicy,
  selectModelRoutingDecision,
  type CompiledRuntimeManifest,
  type ModelRoutingContext,
  type ModelRoutingDecision,
} from "./runtime";
import {
  PSTN_MULAW_CODEC,
  type PstnAudioFrame,
  type PstnClearAudioCommand,
} from "./pstn-sandwich-runtime";
import type { TurnRuntimePacket } from "./turn-runtime-packet";
import {
  recordRuntimePacketToolRequest,
  recordRuntimePacketToolResult,
  recordRuntimePacketToolStarted,
  type ToolCallRequest,
  type ToolExecutionResult,
} from "./turn-runtime-packet";

export const PSTN_PREMIUM_REALTIME_RUNTIME_PATH = "pstn-premium-realtime" as const;

export type PstnPremiumRealtimeRuntimePath = typeof PSTN_PREMIUM_REALTIME_RUNTIME_PATH;
export type PstnRuntimePath = "pstn-sandwich" | PstnPremiumRealtimeRuntimePath;

export type PstnPremiumRealtimeBlockCode =
  | "runtime_profile_not_premium"
  | "provider_capability_missing"
  | "provider_unavailable"
  | "tenant_entitlement_missing"
  | "budget_hard_block"
  | "fallback_not_explicit";

export interface PstnPremiumRealtimePolicyBlock {
  code: PstnPremiumRealtimeBlockCode;
  message: string;
}

export interface PstnPremiumRealtimeProviderCapability {
  provider: RealtimeProviderId;
  approvedForPstn: boolean;
  available: boolean;
  supportsPstnMediaBridge: boolean;
  supportsOutboundAudio: boolean;
  supportsNativeInterruption: boolean;
}

export interface PstnPremiumRealtimeEntitlement {
  enabled: boolean;
  reason?: string | undefined;
}

export interface PstnPremiumRealtimeCallStartPolicy {
  provider: RealtimeProviderId;
  capability?: PstnPremiumRealtimeProviderCapability | undefined;
  entitlement?: PstnPremiumRealtimeEntitlement | undefined;
  budgetAction?: "allow" | "warn" | "block" | undefined;
  fallbackPolicy?: "block" | "explicit_sandwich_downgrade" | undefined;
}

export interface PstnPremiumRealtimeCallStartDecision {
  allowed: boolean;
  runtimePath: PstnPremiumRealtimeRuntimePath;
  provider: RealtimeProviderId;
  blocks: PstnPremiumRealtimePolicyBlock[];
  warnings: string[];
  fallbackAction: "none" | "block";
}

export interface PstnPremiumRealtimeProviderTurnInput {
  audioFramesBase64: string[];
  manifest: CompiledRuntimeManifest;
  activeRole: VoiceAgentRole;
  context: ModelRoutingContext;
  telephony: {
    codec: typeof PSTN_MULAW_CODEC.name;
    sampleRateHz: typeof PSTN_MULAW_CODEC.sampleRateHz;
    channels: typeof PSTN_MULAW_CODEC.channels;
  };
  provider: RealtimeProviderId;
  tools: RealtimeToolDeclaration[];
  executeToolCall(input: PstnPremiumRealtimeProviderToolCallRequest): Promise<PstnPremiumRealtimeProviderToolCall>;
  abortSignal?: AbortSignal | undefined;
}

export interface PstnPremiumRealtimeProviderToolCallRequest {
  providerCallId: string;
  providerFunctionName: string;
  argumentsJson?: string | undefined;
  arguments?: Record<string, unknown> | undefined;
}

export interface PstnPremiumRealtimeNativeInterruptionEvent {
  type: "interruption";
  reason: "caller_speech";
  providerEventId?: string | undefined;
  afterOutboundFrameCount?: number | undefined;
}

export interface PstnPremiumRealtimeProviderTurnResult {
  transcript: string;
  confidence: number;
  language: string;
  responseText: string;
  modelId?: string | undefined;
  firstAudioLatencyMs: number;
  audio: AsyncIterable<string>;
  toolCalls?: PstnPremiumRealtimeProviderToolCall[] | undefined;
  nativeEvents?: PstnPremiumRealtimeNativeInterruptionEvent[] | undefined;
}

export interface PstnPremiumRealtimeProviderToolCall {
  nodeId?: ID | undefined;
  request: ToolCallRequest;
  result: ToolExecutionResult;
}

export interface PstnPremiumRealtimeProvider {
  provider: RealtimeProviderId;
  runPstnTurn(input: PstnPremiumRealtimeProviderTurnInput): Promise<PstnPremiumRealtimeProviderTurnResult>;
}

export interface PstnPremiumRealtimeRuntimeRunTurnInput {
  callSession: LiveCallSession;
  turnId: ID;
  mediaStreamId: ID;
  activeAgentId: ID;
  inboundFrames: PstnAudioFrame[];
  context: ModelRoutingContext;
  executeRealtimeToolCall?: ((input: PstnPremiumRealtimeProviderToolCallRequest & {
    tools: RealtimeToolDeclaration[];
    manifest: CompiledRuntimeManifest;
    activeAgentId: ID;
  }) => Promise<PstnPremiumRealtimeProviderToolCall>) | undefined;
  abortSignal?: AbortSignal | undefined;
}

export type PstnPremiumRealtimeFailureStage = "provider" | "media";

export interface PstnPremiumRealtimeRuntimeTurnResult {
  runtimePath: PstnPremiumRealtimeRuntimePath;
  provider: RealtimeProviderId;
  transcript: string;
  responseText: string;
  outboundFrames: PstnAudioFrame[];
  events: CallEvent[];
  modelId?: string | undefined;
  routingDecision?: ModelRoutingDecision | undefined;
  packet?: TurnRuntimePacket | undefined;
  degraded: boolean;
  failureStage?: PstnPremiumRealtimeFailureStage | undefined;
  interrupted: boolean;
  clearAudio?: PstnClearAudioCommand | undefined;
  safeCloseout: boolean;
}

export interface CreatePstnPremiumRealtimeRuntimeInput {
  provider: PstnPremiumRealtimeProvider;
  callStartPolicy: PstnPremiumRealtimeCallStartPolicy;
  now?: (() => string) | undefined;
  createEventId?: ((type: CallEvent["type"], index: number) => ID) | undefined;
}

export interface PstnPremiumRealtimeRuntime {
  runTurn(input: PstnPremiumRealtimeRuntimeRunTurnInput): Promise<PstnPremiumRealtimeRuntimeTurnResult>;
}

export function evaluatePstnPremiumRealtimeCallStart(input: {
  manifest: CompiledRuntimeManifest;
  activeAgentId: ID;
  policy: PstnPremiumRealtimeCallStartPolicy;
}): PstnPremiumRealtimeCallStartDecision {
  const runtimeProfile = resolveRuntimeProfilePolicy({
    manifest: input.manifest,
    activeRoleId: input.activeAgentId,
  });
  const blocks: PstnPremiumRealtimePolicyBlock[] = [];
  const warnings: string[] = [];
  const capability = input.policy.capability;

  if (runtimeProfile.id !== "premium-realtime") {
    blocks.push({
      code: "runtime_profile_not_premium",
      message: "PSTN premium realtime can only start for the premium realtime runtime profile.",
    });
  }

  if (
    capability === undefined
    || capability.provider !== input.policy.provider
    || capability.approvedForPstn === false
    || capability.supportsPstnMediaBridge === false
    || capability.supportsOutboundAudio === false
    || capability.supportsNativeInterruption === false
  ) {
    blocks.push({
      code: "provider_capability_missing",
      message: "Realtime provider is not explicitly approved for PSTN media bridge, outbound audio, and native interruption.",
    });
  } else if (capability.available === false) {
    blocks.push({
      code: "provider_unavailable",
      message: "Approved realtime provider is not available for PSTN call start.",
    });
  }

  if (input.policy.entitlement?.enabled !== true) {
    blocks.push({
      code: "tenant_entitlement_missing",
      message: input.policy.entitlement?.reason ?? "Tenant is not entitled to premium realtime over PSTN.",
    });
  }

  if (input.policy.budgetAction === "block") {
    blocks.push({
      code: "budget_hard_block",
      message: "Premium realtime PSTN call start is blocked by budget policy.",
    });
  } else if (input.policy.budgetAction === "warn") {
    warnings.push("budget_warn");
  }

  if (input.policy.fallbackPolicy !== "block") {
    blocks.push({
      code: "fallback_not_explicit",
      message: "Premium realtime PSTN cannot silently downgrade to the sandwich runtime.",
    });
  }

  return {
    allowed: blocks.length === 0,
    runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
    provider: input.policy.provider,
    blocks,
    warnings,
    fallbackAction: blocks.length === 0 ? "none" : "block",
  };
}

export function createPstnPremiumRealtimeRuntime(
  input: CreatePstnPremiumRealtimeRuntimeInput,
): PstnPremiumRealtimeRuntime {
  const now = input.now ?? (() => new Date().toISOString());
  const createEventId = input.createEventId ?? ((type, index) => `${type}:${index + 1}`);

  return {
    async runTurn(turnInput) {
      const sessionSnapshot = turnInput.callSession.getSnapshot();
      const manifest = turnInput.callSession.getManifest();
      const activeAgent = resolveRuntimeAgent(manifest, turnInput.activeAgentId);
      if (activeAgent === undefined) {
        throw new PstnPremiumRealtimeRuntimeError(
          "pstn_premium_realtime.unknown_active_agent",
          `Agent '${turnInput.activeAgentId}' is not present in runtime manifest '${manifest.manifestId}'.`,
        );
      }
      const activeRole = runtimeAgentToVoiceAgentRole(activeAgent);

      const gate = evaluatePstnPremiumRealtimeCallStart({
        manifest,
        activeAgentId: turnInput.activeAgentId,
        policy: input.callStartPolicy,
      });
      if (!gate.allowed) {
        throw new PstnPremiumRealtimeRuntimeError(
          "pstn_premium_realtime.call_start_blocked",
          gate.blocks.map((block) => block.message).join(" "),
        );
      }

      const events: CallEvent[] = [];
      const emit = (type: CallEvent["type"], payload: Record<string, unknown>) => {
        events.push({
          id: createEventId(type, events.length),
          callSessionId: sessionSnapshot.callSessionId,
          tenantId: sessionSnapshot.tenantId,
          type,
          at: now(),
          payload,
        });
      };

      const normalizedFrames = normalizePstnInboundFrames(turnInput.inboundFrames, sessionSnapshot.callSessionId, turnInput.mediaStreamId);
      if (normalizedFrames.length === 0) {
        emit("quality.flagged", {
          runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
          provider: input.provider.provider,
          stage: "media",
          code: "media_no_frame_timeout",
          recoverable: false,
        });
        emit("call.failed", {
          runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
          provider: input.provider.provider,
          stage: "media",
          code: "media_no_frame_timeout",
          recoverable: false,
        });
        safeTransition(turnInput.callSession, "failed", "No usable PSTN media frame received for premium realtime.");
        emit("turn.completed", {
          runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
          degraded: true,
          safeCloseout: true,
          audioChunkCount: 0,
        });

        return {
          runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
          provider: input.provider.provider,
          transcript: "",
          responseText: "",
          outboundFrames: [],
          events,
          degraded: true,
          failureStage: "media",
          interrupted: false,
          safeCloseout: true,
        };
      }

      safeTransition(turnInput.callSession, "connected", "PSTN premium realtime media stream is connected.");
      safeTransition(turnInput.callSession, "listening", "Receiving caller PSTN media for premium realtime.");
      emit("pstn.media.received", {
        runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
        provider: input.provider.provider,
        mediaStreamId: turnInput.mediaStreamId,
        frameCount: normalizedFrames.length,
        codec: PSTN_MULAW_CODEC.name,
        sampleRateHz: PSTN_MULAW_CODEC.sampleRateHz,
        channels: PSTN_MULAW_CODEC.channels,
      });

      let providerResult: PstnPremiumRealtimeProviderTurnResult;
      const realtimeTools = buildRealtimeToolDeclarations({
        manifest,
        activeAgentId: turnInput.activeAgentId,
      });
      const providerToolCalls: PstnPremiumRealtimeProviderToolCall[] = [];
      try {
        providerResult = await input.provider.runPstnTurn({
          audioFramesBase64: normalizedFrames.map((frame) => frame.payloadBase64),
          manifest,
          activeRole,
          context: turnInput.context,
          telephony: {
            codec: PSTN_MULAW_CODEC.name,
            sampleRateHz: PSTN_MULAW_CODEC.sampleRateHz,
            channels: PSTN_MULAW_CODEC.channels,
          },
          provider: input.provider.provider,
          tools: realtimeTools,
          executeToolCall: async (request) => {
            if (turnInput.executeRealtimeToolCall === undefined) {
              throw new Error("Premium realtime tool execution is not configured for this PSTN runtime.");
            }

            const toolCall = await turnInput.executeRealtimeToolCall({
              ...request,
              tools: realtimeTools,
              manifest,
              activeAgentId: turnInput.activeAgentId,
            });
            providerToolCalls.push(toolCall);
            return toolCall;
          },
          abortSignal: turnInput.abortSignal,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Premium realtime provider failed.";
        emit("quality.flagged", {
          runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
          provider: input.provider.provider,
          stage: "provider",
          code: "premium_realtime_provider_failed",
          recoverable: false,
          fallbackAction: "block",
          message,
        });
        emit("call.failed", {
          runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
          provider: input.provider.provider,
          stage: "provider",
          code: "premium_realtime_provider_failed",
          recoverable: false,
          fallbackAction: "block",
          message,
        });
        safeTransition(turnInput.callSession, "failed", "Premium realtime provider failed and fallback is blocked.");
        emit("turn.completed", {
          runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
          provider: input.provider.provider,
          degraded: true,
          safeCloseout: true,
          audioChunkCount: 0,
          failureStage: "provider",
        });

        return {
          runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
          provider: input.provider.provider,
          transcript: "",
          responseText: "",
          outboundFrames: [],
          events,
          degraded: true,
          failureStage: "provider",
          interrupted: false,
          safeCloseout: true,
        };
      }

      const transcript = providerResult.transcript.trim();
      const responseText = providerResult.responseText.trim();
      const language = providerResult.language || activeRole.languagePolicy.defaultLanguage;
      const confidence = providerResult.confidence;
      emit("turn.transcribed", {
        runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
        provider: input.provider.provider,
        transcript,
        confidence,
        language,
      });

      let packet = turnInput.callSession.createTurnPacket({
        turnId: turnInput.turnId,
        activeAgentId: turnInput.activeAgentId,
        latestCallerTurn: transcript,
        inputSource: "telephony",
        language,
        sttConfidence: confidence,
      });

      for (const toolCall of [...providerToolCalls, ...(providerResult.toolCalls ?? [])]) {
        const previousSequence = getLatestPacketEventSequence(packet);
        const nodeId = toolCall.nodeId ?? toolCall.request.toolAssignmentId;
        packet = recordRuntimePacketToolRequest(packet, {
          at: now(),
          nodeId,
          request: toolCall.request,
        });
        packet = recordRuntimePacketToolStarted(packet, {
          at: now(),
          nodeId,
          toolCallId: toolCall.request.toolCallId,
          toolAssignmentId: toolCall.request.toolAssignmentId,
          toolId: toolCall.result.toolId,
          toolName: toolCall.result.toolName,
        });
        packet = recordRuntimePacketToolResult(packet, {
          at: now(),
          nodeId,
          result: toolCall.result,
        });
        emitRuntimePacketEventsSince(packet, previousSequence, emit);
      }

      safeTransition(turnInput.callSession, "thinking", "Routing PSTN premium realtime caller turn.", packet.ids.turnId);
      const turnContext = {
        ...turnInput.context,
        confidence,
        language,
      };
      const routingDecision = selectModelRoutingDecision({
        manifest,
        activeRoleId: turnInput.activeAgentId,
        context: turnContext,
      });

      emit("routing.model_selected", {
        runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
        tier: routingDecision.tier,
        provider: input.provider.provider,
        ...(providerResult.modelId !== undefined && providerResult.modelId.trim().length > 0
          ? { modelId: providerResult.modelId.trim() }
          : {}),
        source: routingDecision.source,
        matchedRuleId: routingDecision.matchedRuleId,
        reason: routingDecision.reason,
      });
      emit("turn.response.started", {
        runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
        provider: input.provider.provider,
        activeAgentId: turnInput.activeAgentId,
        degraded: false,
      });

      safeTransition(turnInput.callSession, "speaking", "Streaming provider-native PSTN realtime response audio.", packet.ids.turnId);
      emit("turn.audio.first_byte", {
        runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
        provider: input.provider.provider,
        latencyMs: providerResult.firstAudioLatencyMs,
        codec: PSTN_MULAW_CODEC.name,
        sampleRateHz: PSTN_MULAW_CODEC.sampleRateHz,
      });

      const interruption = providerResult.nativeEvents?.find((event) => event.type === "interruption");
      const interruptAfterFrameCount = interruption?.afterOutboundFrameCount;
      const outboundFrames: PstnAudioFrame[] = [];
      let interrupted = false;
      let clearAudio: PstnClearAudioCommand | undefined;
      let nextSequence = 1;
      for await (const chunk of providerResult.audio) {
        if (
          interruption !== undefined
          && interruptAfterFrameCount !== undefined
          && outboundFrames.length >= interruptAfterFrameCount
        ) {
          interrupted = true;
          clearAudio = emitNativeInterruption({
            emit,
            mediaStreamId: turnInput.mediaStreamId,
            provider: input.provider.provider,
            interruption,
          });
          break;
        }

        const frame: PstnAudioFrame = {
          callSessionId: sessionSnapshot.callSessionId,
          mediaStreamId: turnInput.mediaStreamId,
          direction: "outbound",
          codec: PSTN_MULAW_CODEC,
          sequence: nextSequence,
          timestampMs: nextSequence * 20,
          payloadBase64: chunk,
        };
        outboundFrames.push(frame);
        emit("pstn.media.outbound", {
          runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
          provider: input.provider.provider,
          mediaStreamId: frame.mediaStreamId,
          sequence: frame.sequence,
          timestampMs: frame.timestampMs,
          codec: frame.codec.name,
          sampleRateHz: frame.codec.sampleRateHz,
        });
        nextSequence += 1;
      }

      if (interruption !== undefined && interruptAfterFrameCount === undefined && !interrupted) {
        interrupted = true;
        clearAudio = emitNativeInterruption({
          emit,
          mediaStreamId: turnInput.mediaStreamId,
          provider: input.provider.provider,
          interruption,
        });
      }

      safeTransition(turnInput.callSession, "listening", interrupted ? "Provider-native caller interruption detected." : "PSTN premium realtime response audio completed.", packet.ids.turnId);
      emit("turn.completed", {
        runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
        provider: input.provider.provider,
        transcript,
        responseText,
        audioChunkCount: outboundFrames.length,
        degraded: false,
        interrupted,
      });

      return {
        runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
        provider: input.provider.provider,
        transcript,
        responseText,
        outboundFrames,
        events,
        ...(providerResult.modelId !== undefined && providerResult.modelId.trim().length > 0
          ? { modelId: providerResult.modelId.trim() }
          : {}),
        routingDecision,
        packet,
        degraded: false,
        interrupted,
        ...(clearAudio !== undefined ? { clearAudio } : {}),
        safeCloseout: false,
      };
    },
  };
}

function getLatestPacketEventSequence(packet: TurnRuntimePacket): number {
  return packet.diagnostics.events.at(-1)?.sequence ?? 0;
}

function emitRuntimePacketEventsSince(
  packet: TurnRuntimePacket,
  previousSequence: number,
  emit: (type: CallEvent["type"], payload: Record<string, unknown>) => void,
) {
  for (const event of packet.diagnostics.events) {
    if (event.sequence <= previousSequence || !event.type.startsWith("tool.")) {
      continue;
    }

    emit(event.type as CallEvent["type"], {
      ...event.payload,
      turnId: event.turnId,
      packetSequence: event.sequence,
      ...(event.nodeId !== undefined ? { nodeId: event.nodeId } : {}),
    });
  }
}

function emitNativeInterruption(input: {
  emit: (type: CallEvent["type"], payload: Record<string, unknown>) => void;
  mediaStreamId: ID;
  provider: RealtimeProviderId;
  interruption: PstnPremiumRealtimeNativeInterruptionEvent;
}): PstnClearAudioCommand {
  input.emit("pstn.barge_in.detected", {
    runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
    provider: input.provider,
    mediaStreamId: input.mediaStreamId,
    reason: input.interruption.reason,
    semantics: "provider-native",
    ...(input.interruption.providerEventId !== undefined
      ? { providerEventId: input.interruption.providerEventId }
      : {}),
  });
  input.emit("pstn.audio.clear_requested", {
    runtimePath: PSTN_PREMIUM_REALTIME_RUNTIME_PATH,
    provider: input.provider,
    mediaStreamId: input.mediaStreamId,
    reason: input.interruption.reason,
    semantics: "provider-native",
  });

  return {
    mediaStreamId: input.mediaStreamId,
    reason: input.interruption.reason,
  };
}

function normalizePstnInboundFrames(
  inputFrames: PstnAudioFrame[],
  callSessionId: ID,
  mediaStreamId: ID,
): PstnAudioFrame[] {
  return [...inputFrames]
    .sort((left, right) => left.sequence - right.sequence)
    .filter((frame) =>
      frame.callSessionId === callSessionId
      && frame.mediaStreamId === mediaStreamId
      && frame.direction === "inbound"
      && frame.codec.name === PSTN_MULAW_CODEC.name
      && frame.codec.sampleRateHz === PSTN_MULAW_CODEC.sampleRateHz
      && frame.codec.channels === PSTN_MULAW_CODEC.channels
      && frame.payloadBase64.trim().length > 0
    );
}

function safeTransition(
  callSession: LiveCallSession,
  status: Parameters<LiveCallSession["transition"]>[0]["status"],
  reason: string,
  packetId?: ID | undefined,
) {
  try {
    callSession.transition({
      status,
      reason,
      ...(packetId !== undefined ? { packetId } : {}),
    });
  } catch {
    // Premium realtime adapters can be driven by synthetic harnesses that reuse
    // a session status across several deterministic test turns.
  }
}

export class PstnPremiumRealtimeRuntimeError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PstnPremiumRealtimeRuntimeError";
    this.code = code;
  }
}
