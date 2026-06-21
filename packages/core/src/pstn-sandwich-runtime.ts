import type { AgentVoiceConfig, CallEvent, ID, RuntimeTtsVoice, VoiceAgentRole } from "./index";
import { resolveRuntimeAgent, runtimeAgentToVoiceAgentRole } from "./agent-runtime-context";
import type { LiveCallSession } from "./live-call-session";
import {
  RuntimeProviderFailure,
  resolveRuntimeProfilePolicy,
  selectModelRoutingDecision,
  type CompiledRuntimeManifest,
  type ModelRoutingContext,
  type ModelRoutingDecision,
  type RuntimeFailureStage,
  type SandwichTextModelProvider,
  type SandwichTranscriptionResult,
} from "./runtime";
import type { TurnRuntimePacket } from "./turn-runtime-packet";

export const PSTN_MULAW_CODEC = {
  name: "g711_mulaw",
  sampleRateHz: 8000,
  channels: 1,
} as const;

export type PstnAudioCodec = typeof PSTN_MULAW_CODEC | {
  name: string;
  sampleRateHz: number;
  channels: number;
};

export interface PstnAudioFrame {
  callSessionId: ID;
  mediaStreamId: ID;
  direction: "inbound" | "outbound";
  codec: PstnAudioCodec;
  sequence: number;
  timestampMs: number;
  payloadBase64: string;
}

export interface PstnSandwichTelephonyAudioConfig {
  codec: typeof PSTN_MULAW_CODEC.name;
  sampleRateHz: typeof PSTN_MULAW_CODEC.sampleRateHz;
  channels: typeof PSTN_MULAW_CODEC.channels;
}

export interface PstnSandwichSttInput {
  audioFramesBase64: string[];
  manifest: CompiledRuntimeManifest;
  activeRole: VoiceAgentRole;
  context: ModelRoutingContext;
  telephony: PstnSandwichTelephonyAudioConfig;
  abortSignal?: AbortSignal | undefined;
}

export interface PstnSandwichTranscriptionResult extends SandwichTranscriptionResult {
  latencyMs?: number | undefined;
}

export interface PstnSandwichSttProvider {
  transcribe(input: PstnSandwichSttInput): Promise<PstnSandwichTranscriptionResult>;
}

export interface PstnSandwichTtsOutputConfig {
  format: "pcm_mulaw";
  sampleRateHz: typeof PSTN_MULAW_CODEC.sampleRateHz;
  channels: typeof PSTN_MULAW_CODEC.channels;
}

export interface PstnSandwichTtsInput {
  text: string;
  manifest: CompiledRuntimeManifest;
  activeRole: VoiceAgentRole;
  language: string;
  voiceProfile: RuntimeTtsVoice;
  voiceConfig?: AgentVoiceConfig | undefined;
  context: ModelRoutingContext;
  output: PstnSandwichTtsOutputConfig;
  abortSignal?: AbortSignal | undefined;
}

export interface PstnSandwichTtsResult {
  firstByteLatencyMs: number;
  codec?: PstnAudioCodec | undefined;
  audio: AsyncIterable<string>;
}

export interface PstnSandwichTtsProvider {
  synthesize(input: PstnSandwichTtsInput): Promise<PstnSandwichTtsResult>;
}

export interface PstnSandwichRuntimeThresholds {
  firstResponseTargetMs: number;
  modelTimeoutMs: number;
  sttReconnectGraceMs: number;
  ttsFirstByteTimeoutMs: number;
  mediaNoFrameTimeoutMs: number;
}

export const PSTN_SANDWICH_DEFAULT_THRESHOLDS: PstnSandwichRuntimeThresholds = {
  firstResponseTargetMs: 1500,
  modelTimeoutMs: 8000,
  sttReconnectGraceMs: 2000,
  ttsFirstByteTimeoutMs: 2000,
  mediaNoFrameTimeoutMs: 5000,
};

export interface PstnSandwichBargeInInput {
  afterOutboundFrameCount: number;
  reason: "caller_speech";
  sideEffectInProgress: boolean;
}

export interface PstnSandwichRuntimeRunTurnInput {
  callSession: LiveCallSession;
  turnId: ID;
  mediaStreamId: ID;
  activeAgentId: ID;
  inboundFrames: PstnAudioFrame[];
  context: ModelRoutingContext;
  mediaWaitMs?: number | undefined;
  bargeIn?: PstnSandwichBargeInInput | undefined;
  abortSignal?: AbortSignal | undefined;
}

export interface PstnClearAudioCommand {
  mediaStreamId: ID;
  reason: PstnSandwichBargeInInput["reason"];
}

export type PstnSandwichFailureStage = RuntimeFailureStage | "media";

export interface PstnSandwichRuntimeTurnResult {
  transcript: string;
  responseText: string;
  outboundFrames: PstnAudioFrame[];
  events: CallEvent[];
  routingDecision?: ModelRoutingDecision | undefined;
  packet?: TurnRuntimePacket | undefined;
  degraded: boolean;
  failureStage?: PstnSandwichFailureStage | undefined;
  interrupted: boolean;
  clearAudio?: PstnClearAudioCommand | undefined;
  safeCloseout: boolean;
}

export interface CreatePstnSandwichRuntimeInput {
  stt: PstnSandwichSttProvider;
  model: SandwichTextModelProvider;
  tts: PstnSandwichTtsProvider;
  fallbackTts?: PstnSandwichTtsProvider | undefined;
  thresholds?: Partial<PstnSandwichRuntimeThresholds> | undefined;
  now?: (() => string) | undefined;
  createEventId?: ((type: CallEvent["type"], index: number) => ID) | undefined;
}

export interface PstnSandwichRuntime {
  runTurn(input: PstnSandwichRuntimeRunTurnInput): Promise<PstnSandwichRuntimeTurnResult>;
}

interface NormalizedInboundFrames {
  frames: PstnAudioFrame[];
  warnings: Array<{
    code: string;
    message: string;
    payload: Record<string, unknown>;
  }>;
}

export function createPstnSandwichRuntime(input: CreatePstnSandwichRuntimeInput): PstnSandwichRuntime {
  const now = input.now ?? (() => new Date().toISOString());
  const createEventId = input.createEventId ?? ((type, index) => `${type}:${index + 1}`);
  const thresholds = {
    ...PSTN_SANDWICH_DEFAULT_THRESHOLDS,
    ...input.thresholds,
  };

  return {
    async runTurn(turnInput) {
      const sessionSnapshot = turnInput.callSession.getSnapshot();
      const manifest = getManifestFromSessionScope(turnInput.callSession, turnInput.activeAgentId);
      const activeAgent = resolveRuntimeAgent(manifest, turnInput.activeAgentId);
      if (activeAgent === undefined) {
        throw new PstnSandwichRuntimeError(
          "pstn_sandwich.unknown_active_agent",
          `Agent '${turnInput.activeAgentId}' is not present in runtime manifest '${manifest.manifestId}'.`,
        );
      }
      const activeRole = runtimeAgentToVoiceAgentRole(activeAgent);

      if (manifest.runtimeProfile === "premium-realtime") {
        throw new PstnSandwichRuntimeError(
          "pstn_sandwich.premium_realtime_blocked",
          "PSTN sandwich cannot run premium realtime manifests.",
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

      const normalized = normalizePstnInboundFrames(turnInput.inboundFrames, sessionSnapshot.callSessionId, turnInput.mediaStreamId);
      for (const warning of normalized.warnings) {
        emit("quality.flagged", {
          code: warning.code,
          recoverable: true,
          ...warning.payload,
        });
      }

      if (normalized.frames.length === 0) {
        const mediaWaitMs = turnInput.mediaWaitMs ?? thresholds.mediaNoFrameTimeoutMs;
        emit("quality.flagged", {
          stage: "media",
          code: "media_no_frame_timeout",
          thresholdMs: thresholds.mediaNoFrameTimeoutMs,
          latencyMs: mediaWaitMs,
          recoverable: false,
        });
        emit("call.failed", {
          stage: "media",
          code: "media_no_frame_timeout",
          recoverable: false,
          message: "PSTN media stream did not provide a usable inbound frame.",
        });
        safeTransition(turnInput.callSession, "failed", "No usable PSTN media frame received.");
        emit("turn.completed", {
          degraded: true,
          safeCloseout: true,
          audioChunkCount: 0,
        });

        return {
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

      safeTransition(turnInput.callSession, "connected", "PSTN media stream is connected.");
      safeTransition(turnInput.callSession, "listening", "Receiving caller PSTN media.");
      emit("pstn.media.received", {
        mediaStreamId: turnInput.mediaStreamId,
        frameCount: normalized.frames.length,
        codec: PSTN_MULAW_CODEC.name,
        sampleRateHz: PSTN_MULAW_CODEC.sampleRateHz,
        channels: PSTN_MULAW_CODEC.channels,
      });

      let transcript = "";
      let confidence = turnInput.context.confidence ?? 0;
      let language = turnInput.context.language ?? activeRole.languagePolicy.defaultLanguage;
      let degraded = false;
      let failureStage: PstnSandwichFailureStage | undefined;

      try {
        const transcription = await input.stt.transcribe({
          audioFramesBase64: normalized.frames.map((frame) => frame.payloadBase64),
          manifest,
          activeRole,
          context: turnInput.context,
          telephony: {
            codec: PSTN_MULAW_CODEC.name,
            sampleRateHz: PSTN_MULAW_CODEC.sampleRateHz,
            channels: PSTN_MULAW_CODEC.channels,
          },
          abortSignal: turnInput.abortSignal,
        });

        transcript = transcription.transcript.trim();
        confidence = transcription.confidence;
        language = transcription.language;
        emit("turn.transcribed", {
          transcript,
          confidence,
          language,
          ...(transcription.latencyMs !== undefined ? { latencyMs: transcription.latencyMs } : {}),
        });
      } catch (error) {
        degraded = true;
        failureStage = "stt";
        const failure = normalizeProviderFailure(error, "stt");
        emit("call.failed", {
          stage: failure.stage,
          code: failure.code,
          recoverable: true,
          message: failure.message,
        });
      }

      const packet = turnInput.callSession.createTurnPacket({
        turnId: turnInput.turnId,
        activeAgentId: turnInput.activeAgentId,
        latestCallerTurn: transcript,
        inputSource: "telephony",
        language,
        sttConfidence: confidence,
      });

      safeTransition(turnInput.callSession, "thinking", "Routing PSTN caller turn.", packet.ids.turnId);
      const turnContext = {
        ...turnInput.context,
        confidence,
        language,
      };
      const routingDecision = selectModelRoutingDecision({
        manifest,
        activeAgentId: turnInput.activeAgentId,
        context: turnContext,
      });
      const runtimeProfile = resolveRuntimeProfilePolicy({
        manifest,
        activeAgentId: turnInput.activeAgentId,
      });

      emit("routing.model_selected", {
        tier: routingDecision.tier,
        provider: activeRole.modelProvider ?? "openai",
        ...(activeRole.modelId !== undefined && activeRole.modelId.trim().length > 0
          ? { modelId: activeRole.modelId.trim() }
          : {}),
        source: routingDecision.source,
        matchedRuleId: routingDecision.matchedRuleId,
        reason: routingDecision.reason,
      });
      emit("turn.response.started", {
        activeAgentId: turnInput.activeAgentId,
        tier: routingDecision.tier,
        degraded,
      });

      let responseText = "";
      if (failureStage === "stt") {
        responseText = "I'm sorry, I didn't catch that. Could you repeat that?";
      } else {
        try {
          for await (const chunk of input.model.streamText({
            manifest,
            activeAgent,
            transcript,
            tier: routingDecision.tier,
            context: turnContext,
          })) {
            responseText += chunk;
          }
        } catch (error) {
          degraded = true;
          failureStage = "model";
          const failure = normalizeProviderFailure(error, "model");
          emit("quality.flagged", {
            stage: failure.stage,
            code: failure.code,
            recoverable: true,
            thresholdMs: failure.code === "timeout" ? thresholds.modelTimeoutMs : undefined,
            message: failure.message,
          });
        }

        responseText = responseText.trim();
        if (responseText.length === 0) {
          responseText = "I'm sorry, I had trouble responding just now. Could you try that again?";
        }
      }

      safeTransition(turnInput.callSession, "speaking", "Streaming PSTN-ready response audio.", packet.ids.turnId);
      const ttsResult = await synthesizePstnAudio({
        text: responseText,
        manifest,
        activeRole,
        language,
        voiceProfile: runtimeProfile.ttsVoice,
        ...(activeRole.voiceConfig !== undefined ? { voiceConfig: activeRole.voiceConfig } : {}),
        context: turnContext,
        abortSignal: turnInput.abortSignal,
        tts: input.tts,
        fallbackTts: input.fallbackTts,
        emit,
      });

      if (ttsResult.firstByteLatencyMs > thresholds.ttsFirstByteTimeoutMs) {
        emit("quality.flagged", {
          stage: "tts",
          code: "tts_first_byte_timeout",
          latencyMs: ttsResult.firstByteLatencyMs,
          thresholdMs: thresholds.ttsFirstByteTimeoutMs,
          recoverable: true,
        });
      }
      if (ttsResult.firstByteLatencyMs > thresholds.firstResponseTargetMs) {
        emit("quality.flagged", {
          stage: "pstn",
          code: "first_response_latency_exceeded",
          latencyMs: ttsResult.firstByteLatencyMs,
          thresholdMs: thresholds.firstResponseTargetMs,
          recoverable: true,
        });
      }
      emit("turn.audio.first_byte", {
        latencyMs: ttsResult.firstByteLatencyMs,
        codec: PSTN_MULAW_CODEC.name,
        sampleRateHz: PSTN_MULAW_CODEC.sampleRateHz,
      });

      const outboundFrames: PstnAudioFrame[] = [];
      let interrupted = false;
      let clearAudio: PstnClearAudioCommand | undefined;
      let nextSequence = 1;
      for await (const chunk of ttsResult.audio) {
        if (
          turnInput.bargeIn !== undefined
          && !turnInput.bargeIn.sideEffectInProgress
          && outboundFrames.length >= turnInput.bargeIn.afterOutboundFrameCount
        ) {
          interrupted = true;
          clearAudio = {
            mediaStreamId: turnInput.mediaStreamId,
            reason: turnInput.bargeIn.reason,
          };
          emit("pstn.barge_in.detected", {
            mediaStreamId: turnInput.mediaStreamId,
            reason: turnInput.bargeIn.reason,
            sideEffectInProgress: false,
          });
          emit("pstn.audio.clear_requested", {
            mediaStreamId: turnInput.mediaStreamId,
            reason: turnInput.bargeIn.reason,
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
          mediaStreamId: frame.mediaStreamId,
          sequence: frame.sequence,
          timestampMs: frame.timestampMs,
          codec: frame.codec.name,
          sampleRateHz: frame.codec.sampleRateHz,
        });
        nextSequence += 1;
      }

      safeTransition(turnInput.callSession, interrupted ? "listening" : "listening", interrupted ? "Caller interrupted response audio." : "PSTN response audio completed.", packet.ids.turnId);
      emit("turn.completed", {
        transcript,
        responseText,
        audioChunkCount: outboundFrames.length,
        degraded,
        interrupted,
        ...(failureStage !== undefined ? { failureStage } : {}),
      });

      return {
        transcript,
        responseText,
        outboundFrames,
        events,
        routingDecision,
        packet,
        degraded,
        ...(failureStage !== undefined ? { failureStage } : {}),
        interrupted,
        ...(clearAudio !== undefined ? { clearAudio } : {}),
        safeCloseout: false,
      };
    },
  };
}

function getManifestFromSessionScope(callSession: LiveCallSession, activeAgentId: ID): CompiledRuntimeManifest {
  const snapshot = callSession.getSnapshot();
  const replayed = callSession.replayEvents();
  const startedEvent = replayed.find((event) => event.type === "call.started");
  if (startedEvent === undefined) {
    throw new PstnSandwichRuntimeError(
      "pstn_sandwich.session_not_started",
      `Live call session '${snapshot.callSessionId}' must be started before PSTN runtime execution.`,
    );
  }

  const manifest = callSession.getManifest();
  if (resolveRuntimeAgent(manifest, activeAgentId) !== undefined) {
    return manifest;
  }

  throw new PstnSandwichRuntimeError(
    "pstn_sandwich.unknown_active_agent",
    `Live call session '${snapshot.callSessionId}' manifest does not include active agent '${activeAgentId}'.`,
  );
}

function normalizePstnInboundFrames(
  inputFrames: PstnAudioFrame[],
  callSessionId: ID,
  mediaStreamId: ID,
): NormalizedInboundFrames {
  const warnings: NormalizedInboundFrames["warnings"] = [];
  const frames: PstnAudioFrame[] = [];
  const sortedFrames = [...inputFrames].sort((left, right) => left.sequence - right.sequence);
  let expectedSequence: number | undefined;
  const seenSequences = new Set<number>();

  for (const frame of sortedFrames) {
    assertPstnInboundFrame(frame, callSessionId, mediaStreamId);

    if (seenSequences.has(frame.sequence)) {
      warnings.push({
        code: "media_duplicate_frame",
        message: `Duplicate PSTN media frame sequence ${frame.sequence} was ignored.`,
        payload: {
          sequence: frame.sequence,
        },
      });
      continue;
    }

    seenSequences.add(frame.sequence);
    if (expectedSequence !== undefined && frame.sequence > expectedSequence) {
      warnings.push({
        code: "media_sequence_gap",
        message: `PSTN media skipped from sequence ${expectedSequence} to ${frame.sequence}.`,
        payload: {
          expectedSequence,
          actualSequence: frame.sequence,
        },
      });
    }

    expectedSequence = frame.sequence + 1;
    if (frame.payloadBase64.trim().length === 0) {
      warnings.push({
        code: "media_partial_frame",
        message: `PSTN media frame sequence ${frame.sequence} had no usable payload.`,
        payload: {
          sequence: frame.sequence,
        },
      });
      continue;
    }

    frames.push({ ...frame });
  }

  return { frames, warnings };
}

function assertPstnInboundFrame(frame: PstnAudioFrame, callSessionId: ID, mediaStreamId: ID) {
  if (frame.callSessionId !== callSessionId) {
    throw new PstnSandwichRuntimeError(
      "pstn_sandwich.call_session_mismatch",
      `PSTN frame belongs to call session '${frame.callSessionId}', expected '${callSessionId}'.`,
    );
  }
  if (frame.mediaStreamId !== mediaStreamId) {
    throw new PstnSandwichRuntimeError(
      "pstn_sandwich.media_stream_mismatch",
      `PSTN frame belongs to media stream '${frame.mediaStreamId}', expected '${mediaStreamId}'.`,
    );
  }
  if (frame.direction !== "inbound") {
    throw new PstnSandwichRuntimeError(
      "pstn_sandwich.invalid_frame_direction",
      "PSTN sandwich turn input accepts inbound frames only.",
    );
  }
  if (!isPstnMulawCodec(frame.codec)) {
    throw new PstnSandwichRuntimeError(
      "pstn_sandwich.unsupported_codec",
      "PSTN sandwich only accepts G.711 mu-law 8 kHz mono media frames.",
    );
  }
}

async function synthesizePstnAudio(input: {
  text: string;
  manifest: CompiledRuntimeManifest;
  activeRole: VoiceAgentRole;
  language: string;
  voiceProfile: RuntimeTtsVoice;
  voiceConfig?: AgentVoiceConfig | undefined;
  context: ModelRoutingContext;
  abortSignal?: AbortSignal | undefined;
  tts: PstnSandwichTtsProvider;
  fallbackTts?: PstnSandwichTtsProvider | undefined;
  emit: (type: CallEvent["type"], payload: Record<string, unknown>) => void;
}): Promise<PstnSandwichTtsResult> {
  const ttsInput = toTtsInput(input);
  const result = await input.tts.synthesize(ttsInput);
  if (isPstnMulawCodec(result.codec ?? PSTN_MULAW_CODEC)) {
    return result;
  }

  if (input.fallbackTts === undefined) {
    throw new RuntimeProviderFailure("tts", "failed", "TTS provider did not return PSTN-ready mu-law 8 kHz audio.");
  }

  input.emit("quality.flagged", {
    stage: "tts",
    code: "tts_pstn_format_fallback",
    recoverable: true,
    originalCodec: result.codec?.name ?? "unknown",
    targetCodec: PSTN_MULAW_CODEC.name,
  });
  const fallbackResult = await input.fallbackTts.synthesize(ttsInput);
  if (!isPstnMulawCodec(fallbackResult.codec ?? PSTN_MULAW_CODEC)) {
    throw new RuntimeProviderFailure("tts", "failed", "Fallback TTS provider did not return PSTN-ready mu-law 8 kHz audio.");
  }

  return fallbackResult;
}

function toTtsInput(input: {
  text: string;
  manifest: CompiledRuntimeManifest;
  activeRole: VoiceAgentRole;
  language: string;
  voiceProfile: RuntimeTtsVoice;
  voiceConfig?: AgentVoiceConfig | undefined;
  context: ModelRoutingContext;
  abortSignal?: AbortSignal | undefined;
}): PstnSandwichTtsInput {
  return {
    text: input.text,
    manifest: input.manifest,
    activeRole: input.activeRole,
    language: input.language,
    voiceProfile: input.voiceProfile,
    ...(input.voiceConfig !== undefined ? { voiceConfig: input.voiceConfig } : {}),
    context: input.context,
    output: {
      format: "pcm_mulaw",
      sampleRateHz: PSTN_MULAW_CODEC.sampleRateHz,
      channels: PSTN_MULAW_CODEC.channels,
    },
    abortSignal: input.abortSignal,
  };
}

function isPstnMulawCodec(codec: PstnAudioCodec): boolean {
  return codec.name === PSTN_MULAW_CODEC.name
    && codec.sampleRateHz === PSTN_MULAW_CODEC.sampleRateHz
    && codec.channels === PSTN_MULAW_CODEC.channels;
}

function normalizeProviderFailure(error: unknown, fallbackStage: RuntimeFailureStage): RuntimeProviderFailure {
  if (error instanceof RuntimeProviderFailure) {
    return error;
  }

  return new RuntimeProviderFailure(
    fallbackStage,
    "failed",
    error instanceof Error ? error.message : "Runtime provider failed.",
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
    // Lifecycle transitions are best-effort here because the session may already
    // be at the expected state when a synthetic harness drives multiple turns.
  }
}

export class PstnSandwichRuntimeError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PstnSandwichRuntimeError";
    this.code = code;
  }
}
