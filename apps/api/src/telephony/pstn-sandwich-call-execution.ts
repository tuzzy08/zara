import {
  createAgentTurnContext,
  createLiveCallSession,
  parseAgentActionText,
  PSTN_MULAW_CODEC,
  recordRuntimePacketTransfer,
  resolveRuntimeAgent,
  resolveRuntimeProfilePolicy,
  selectModelRoutingDecision,
  type CompiledRuntimeManifest,
  type PstnAudioFrame,
  type SandwichTextModelProvider,
  type LiveCallSession,
  type TranscriptTurn,
  type TurnRuntimePacket,
} from "@zara/core";
import type { AssemblyAiSttProvider } from "../sandbox-live-sessions/assemblyai-stt.provider";
import type { CartesiaTtsProvider } from "../sandbox-live-sessions/cartesia-tts.provider";
import type { RuntimeAgentToolExecutorService } from "../sandbox-live-sessions/runtime-agent-tool-executor.service";
import { resolveLiveSandboxAgentHandoffAction, resolveLiveSandboxTurnRoute, type LiveSandboxIntentClassifier } from "../sandbox-live-sessions/sandbox-live-session-router";
import type { PublishedWorkflowManifestRepository } from "../workflows/published-workflow-manifest.repository";
import type { RuntimeObservabilityRecorder } from "../runtime-observability/runtime-observability";
import { applyRuntimePromptPolicyModelDefaultsToManifest } from "../runtime-prompt-policy/runtime-prompt-policy.model-defaults";
import type { RuntimePromptPolicy } from "../runtime-prompt-policy/runtime-prompt-policy.models";
import type { RuntimePromptPolicyService } from "../runtime-prompt-policy/runtime-prompt-policy.service";
import type { TelephonyIncrementalRepository } from "./telephony-incremental.repository";
import { PstnPremiumPlaybackController } from "./pstn-premium-playback-controller";
import { PstnPremiumPlaybackAdmission } from "./pstn-premium-playback-admission";

export interface PstnSandwichCallStart {
  organizationId: string;
  dispatchId: string;
  callSessionId: string;
  streamSid: string;
  output: {
    sendMedia(frame: PstnAudioFrame): void;
    sendMark(name: string): void;
    clearAudio(): void;
    close(code: number, reason: string): void;
    recordCheckpoint?(checkpoint: "transcriptCreated" | "agentResponseGenerated"): Promise<void>;
  };
}

export interface PstnSandwichCallDependencies {
  repository: TelephonyIncrementalRepository;
  manifests: PublishedWorkflowManifestRepository;
  toolExecutor?: RuntimeAgentToolExecutorService;
  observability?: RuntimeObservabilityRecorder;
  playbackAdmission?: PstnPremiumPlaybackAdmission | undefined;
  promptPolicyService: Pick<RuntimePromptPolicyService, "selectPromptPolicyForSession">;
  createProviders(): { stt: AssemblyAiSttProvider; model: SandwichTextModelProvider; tts: CartesiaTtsProvider;
    intentClassifier?: LiveSandboxIntentClassifier };
}

interface SandwichCall {
  stream: ReturnType<AssemblyAiSttProvider["createStreamingSession"]>;
  audio: Buffer;
  stopped: boolean;
  input: PstnSandwichCallStart;
  manifest: CompiledRuntimeManifest;
  promptPolicy: RuntimePromptPolicy;
  session: LiveCallSession;
  providers: ReturnType<PstnSandwichCallDependencies["createProviders"]>;
  playback: PstnPremiumPlaybackController;
  frontier: string[];
  recentTranscript: TranscriptTurn[];
  turn: number;
  processing: Promise<void>;
  queuedTurns: number;
  responseAbort?: AbortController;
  readyTimer?: ReturnType<typeof setTimeout>;
  audioTimer?: ReturnType<typeof setTimeout>;
  responseTimer?: ReturnType<typeof setTimeout>;
  mediaTimer?: ReturnType<typeof setTimeout>;
  playbackTimers: Map<string, ReturnType<typeof setTimeout>>;
  nextAudioAt: number;
  rejectReady(error: Error): void;
  transfer?: NonNullable<TurnRuntimePacket["transfer"]>;
  afterPlayback?: { responseId: string; run(): void };
}

export class PstnSandwichCallExecution {
  private readonly calls = new Map<string, SandwichCall>();
  private readonly starting = new Map<string, AbortController>();
  private readonly playbackAdmission: PstnPremiumPlaybackAdmission;
  constructor(private readonly dependencies: PstnSandwichCallDependencies) {
    this.playbackAdmission = dependencies.playbackAdmission ?? new PstnPremiumPlaybackAdmission();
  }

  acknowledgePlaybackMark(input: { organizationId: string; callSessionId: string; name: string }) {
    this.calls.get(JSON.stringify([input.organizationId, input.callSessionId]))?.playback.acknowledgeMark(input.name);
  }

  appendAudio(input: { organizationId: string; callSessionId: string; audioBase64: string }) {
    const call = this.calls.get(JSON.stringify([input.organizationId, input.callSessionId]));
    if (call === undefined || call.stopped) return;
    this.armMediaTimer(call);
    if (Buffer.byteLength(input.audioBase64, "base64") + call.audio.length > 32_000) { this.fail(call); return; }
    call.audio = Buffer.concat([call.audio, Buffer.from(input.audioBase64, "base64")]);
    this.flushAudio(call);
  }

  private flushAudio(call: SandwichCall) {
    if (call.stopped || call.audio.length < 480 || call.audioTimer !== undefined) return;
    const delay = call.nextAudioAt - Date.now();
    if (delay > 0) {
      call.audioTimer = setTimeout(() => { delete call.audioTimer; this.flushAudio(call); }, delay);
      call.audioTimer.unref?.();
      return;
    }
    call.stream.appendAudioFrame(call.audio.subarray(0, 480).toString("base64"));
    call.audio = call.audio.subarray(480);
    call.nextAudioAt = Date.now() + 60;
    this.flushAudio(call);
  }

  private armMediaTimer(call: SandwichCall) {
    clearTimeout(call.mediaTimer);
    call.mediaTimer = setTimeout(() => this.fail(call), 5000);
    call.mediaTimer.unref?.();
  }

  async stop(input: { organizationId: string; callSessionId: string }) {
    const key = JSON.stringify([input.organizationId, input.callSessionId]);
    this.starting.get(key)?.abort();
    const call = this.calls.get(key);
    if (call === undefined) return;
    call.stopped = true;
    const status = call.session.getSnapshot().status;
    if (status !== "ending" && status !== "failed") call.session.transition({ status: "ending" });
    clearTimeout(call.readyTimer);
    clearTimeout(call.audioTimer);
    clearTimeout(call.responseTimer);
    clearTimeout(call.mediaTimer);
    for (const timer of call.playbackTimers.values()) clearTimeout(timer);
    call.playbackTimers.clear();
    call.rejectReady(new Error("Standard PSTN call stopped."));
    call.responseAbort?.abort();
    call.providers.tts.close();
    call.playback.dispose();
    call.audio = Buffer.alloc(0);
    call.stream.terminate();
    await Promise.all([call.stream.completed, call.processing]);
    if (call.session.getSnapshot().status === "ending") call.session.transition({ status: "ended" });
    if (this.calls.get(key) === call) this.calls.delete(key);
    return call.session.getSnapshot();
  }

  async start(input: PstnSandwichCallStart) {
    const key = JSON.stringify([input.organizationId, input.callSessionId]);
    if (this.starting.has(key) || this.calls.has(key)) throw new Error("Standard PSTN call has already started.");
    const abort = new AbortController();
    this.starting.set(key, abort);
    try { return await this.startCall(input, abort.signal); }
    finally { this.starting.delete(key); }
  }

  private async startCall(input: PstnSandwichCallStart, signal: AbortSignal) {
    const loaded = await this.dependencies.repository.loadCallRuntimeContext({
      tenantId: input.organizationId, callSessionId: input.callSessionId,
    });
    signal.throwIfAborted();
    if (loaded.outcome !== "found" || loaded.context.publishedVersionId === undefined
      || loaded.context.disposition !== "routed"
      || !loaded.context.workspaceId || !loaded.context.phoneNumberId
      || (loaded.context.routeMode !== "test_route" && loaded.context.routeMode !== "live_route")
      || (loaded.context.runtimeProfile !== "cost-optimized" && loaded.context.runtimeProfile !== "balanced")
      || loaded.context.dispatchId !== input.dispatchId || loaded.context.runtimePath !== "pstn-sandwich"
      || loaded.context.status === "blocked"
      || ["draining", "completed", "failed", "expired"].includes(loaded.context.lifecycleState.stage)
      || loaded.context.status === "completed" || loaded.context.status === "terminated") {
      throw new Error("Standard PSTN dispatch is unavailable.");
    }
    const storedManifest = await this.dependencies.manifests.load({
      organizationId: input.organizationId, publishedVersionId: loaded.context.publishedVersionId,
    });
    signal.throwIfAborted();
    if (storedManifest === null) throw new Error("Standard PSTN published manifest is unavailable.");
    const promptPolicySelection = await this.dependencies.promptPolicyService.selectPromptPolicyForSession(
      `pstn:${input.organizationId}:${input.callSessionId}`,
    );
    const manifest = applyRuntimePromptPolicyModelDefaultsToManifest(storedManifest, promptPolicySelection.policy);
    const session = createLiveCallSession({ callSessionId: input.callSessionId, manifest,
      source: { mode: "pstn", phoneNumberId: loaded.context.phoneNumberId, telephonyConnectionId: loaded.context.connectionId,
        routeMode: loaded.context.routeMode },
      expectedScope: { tenantId: input.organizationId, workspaceId: loaded.context.workspaceId,
        publishedVersionId: loaded.context.publishedVersionId, runtimeProfile: loaded.context.runtimeProfile } });
    const usageScope = {
      organizationId: manifest.tenantId, sessionId: input.callSessionId, callSessionId: input.callSessionId,
    };
    const providers = this.dependencies.createProviders();
    await new Promise<void>((resolve, reject) => {
      let sequence = 0;
      const playback = new PstnPremiumPlaybackController({
        sendFrame: frame => input.output.sendMedia({ callSessionId: input.callSessionId, mediaStreamId: input.streamSid,
          direction: "outbound", codec: PSTN_MULAW_CODEC, sequence: ++sequence, timestampMs: (sequence - 1) * 20,
          payloadBase64: frame.payloadBase64 }),
        sendMark: name => input.output.sendMark(name), clear: () => input.output.clearAudio(),
        onResponseCompleted: ({ responseId }) => {
          clearTimeout(call.playbackTimers.get(responseId));
          call.playbackTimers.delete(responseId);
          if (call.stopped || call.afterPlayback?.responseId !== responseId) return;
          const continuation = call.afterPlayback;
          delete call.afterPlayback;
          continuation.run();
        },
      }, { admission: this.playbackAdmission });
      const stream = providers.stt.createStreamingSession({
        sampleRateHz: 8_000, encoding: "pcm_mulaw", usageScope,
        onReady: () => {
          if (call.stopped || session.getSnapshot().status !== "waiting") return;
          clearTimeout(call.readyTimer);
          this.armMediaTimer(call);
          session.transition({ status: "connected" });
          session.transition({ status: "listening" });
          resolve();
        },
        onSpeechStarted: () => {
          if (call.stopped || call.responseAbort === undefined || call.responseAbort.signal.aborted) return;
          call.responseAbort.abort();
          clearTimeout(call.responseTimer);
          call.playback.interrupt();
          for (const timer of call.playbackTimers.values()) clearTimeout(timer);
          call.playbackTimers.clear();
          delete call.afterPlayback;
        },
        onFinal: event => this.queueTurn(call, event),
        onError: error => { reject(error); if (call !== undefined) this.fail(call); },
      });
      const call: SandwichCall = { stream, audio: Buffer.alloc(0), nextAudioAt: 0, stopped: false, input, manifest,
        promptPolicy: promptPolicySelection.policy, session, providers, playback,
        frontier: [manifest.entryNodeId], recentTranscript: [], turn: 0, queuedTurns: 0, playbackTimers: new Map(), processing: Promise.resolve(), rejectReady: reject };
      this.calls.set(JSON.stringify([input.organizationId, input.callSessionId]), call);
      session.start();
      call.readyTimer = setTimeout(() => this.fail(call), 2000);
      call.readyTimer.unref?.();
    });
    return session.getSnapshot();
  }

  private fail(call: SandwichCall) {
    if (call.stopped) return;
    call.session.transition({ status: "failed", reason: "standard_call_provider_failed" });
    call.input.output.close(1011, "standard_call_provider_failed");
    void this.stop(call.input);
  }

  private queueTurn(call: SandwichCall, event: { transcript: string; confidence: number; language: string }) {
    if (call.stopped) return;
    if (call.queuedTurns >= 2) { this.fail(call); return; }
    call.queuedTurns += 1;
    call.processing = call.processing.then(() => this.respond(call, event)).catch(() => {
      if (!call.responseAbort?.signal.aborted) this.fail(call);
    }).finally(() => { call.queuedTurns -= 1; });
  }

  private async respond(call: SandwichCall, event: { transcript: string; confidence: number; language: string }) {
    if (call.stopped || !event.transcript.trim()) return;
    const abort = new AbortController();
    call.responseAbort = abort;
    await call.input.output.recordCheckpoint?.("transcriptCreated");
    if (call.stopped || abort.signal.aborted) return;
    const turnId = `${call.input.callSessionId}:turn:${++call.turn}`;
    call.responseTimer = setTimeout(() => this.fail(call), 8000);
    call.responseTimer.unref?.();
    const route = await resolveLiveSandboxTurnRoute({ manifest: call.manifest, frontier: call.frontier,
      intentClassifier: call.providers.intentClassifier === undefined ? undefined : {
        classify: input => call.providers.intentClassifier!.classify({ ...input, abortSignal: abort.signal }),
      },
      transcript: event.transcript, turn: { callSessionId: call.input.callSessionId, turnId, source: "telephony",
        sttConfidence: event.confidence, language: event.language, recentTranscript: call.recentTranscript } })
      .finally(() => clearTimeout(call.responseTimer));
    if (call.stopped || abort.signal.aborted) return;
    call.frontier = route.nextFrontier;
    const agentId = route.kind === "agent" ? route.activeAgentId : call.manifest.entryAgentId;
    const activeAgent = resolveRuntimeAgent(call.manifest, agentId);
    if (activeAgent === undefined) throw new Error("Standard PSTN agent is unavailable.");
    const context = { callPhase: "discovery" as const, confidence: event.confidence, language: event.language,
      ...(route.kind === "agent" ? route.context : {}) };
    let responseText = route.kind === "terminal" ? route.responseText : "";
    let packet = route.packet;
    if (route.kind === "agent") {
      const routing = selectModelRoutingDecision({ manifest: call.manifest, activeAgentId: agentId, context });
      if (call.transfer !== undefined) packet = recordRuntimePacketTransfer(packet, {
        at: new Date().toISOString(), nodeId: agentId, transfer: call.transfer,
      });
      let toolRequests = 0;
      while (!call.stopped && !abort.signal.aborted) {
        responseText = "";
        call.responseTimer = setTimeout(() => this.fail(call), 8000);
        call.responseTimer.unref?.();
        for await (const chunk of call.providers.model.streamText({ callSessionId: call.input.callSessionId,
          abortSignal: abort.signal,
          manifest: call.manifest, activeAgent, transcript: event.transcript, tier: routing.tier, context,
          promptPolicy: call.promptPolicy, agentContext: createAgentTurnContext(packet),
          agentActionMode: packet.availableActions.length > 0 })) responseText += chunk;
        clearTimeout(call.responseTimer);
        if (call.stopped || abort.signal.aborted) return;
        if (packet.availableActions.length === 0) break;
        const action = packet.availableActions.some(available => available.kind === "internal_handoff")
          ? parseAgentActionText(responseText, { allowHandoffAction: true }) : parseAgentActionText(responseText);
        if (action.type === "respond") { responseText = action.responseText; break; }
        if (action.type === "handoff_to_agent") {
          const handoff = resolveLiveSandboxAgentHandoffAction({ manifest: call.manifest, activeAgentId: agentId,
            action, packet, at: new Date().toISOString() });
          call.frontier = handoff.nextFrontier;
          responseText = handoff.responseText;
          if (handoff.kind === "routed") {
            packet = handoff.packet;
            call.transfer = handoff.packet.transfer!;
            call.afterPlayback = { responseId: turnId, run: () => this.queueTurn(call, event) };
          }
          break;
        }
        if (toolRequests >= 2) { responseText = "I need one more detail before I can continue safely. What should I prioritize?"; break; }
        toolRequests += 1;
        if (this.dependencies.toolExecutor === undefined) throw new Error("Standard PSTN tools are unavailable.");
        packet = await this.dependencies.toolExecutor.executeAgentTool({ organizationId: call.input.organizationId,
          sessionId: call.input.callSessionId, workspaceId: call.manifest.workspaceId!, actorUserId: "system",
          manifest: call.manifest, activeAgentId: agentId, transcript: event.transcript, action, packet, at: new Date().toISOString() });
      }
    }
    if (call.stopped || abort.signal.aborted) return;
    const synthesis = { manifest: call.manifest, activeAgent, context, language: event.language,
      voiceProfile: resolveRuntimeProfilePolicy({ manifest: call.manifest, activeAgentId: agentId }).ttsVoice,
      voiceConfig: activeAgent.voiceConfig,
      abortSignal: abort.signal,
      output: { format: "pcm_mulaw" as const, sampleRateHz: 8000 as const, channels: 1 as const },
      textStream: (async function* () { yield responseText; })() };
    await call.input.output.recordCheckpoint?.("agentResponseGenerated");
    if (call.stopped || abort.signal.aborted) return;
    if (route.kind === "terminal") call.afterPlayback = { responseId: turnId, run: () => {
      call.input.output.close(1000, "standard_call_completed");
      void this.stop(call.input);
    } };
    call.playback.startResponse(turnId);
    call.responseTimer = setTimeout(() => this.fail(call), 2000);
    call.responseTimer.unref?.();
    const result = await call.providers.tts.synthesizeStreaming(synthesis).finally(() => clearTimeout(call.responseTimer));
    if (call.stopped || abort.signal.aborted) return;
    const playbackTimer = setTimeout(() => this.fail(call), 30_000);
    playbackTimer.unref?.();
    call.playbackTimers.set(turnId, playbackTimer);
    for await (const chunk of result.audio) {
      if (call.stopped || abort.signal.aborted) return;
      call.playback.appendDelta(turnId, chunk);
    }
    call.playback.finishResponse(turnId);
    void this.dependencies.observability?.recordTurn({ traceId: `pstn:${call.input.callSessionId}:${turnId}`,
      manifest: call.manifest, packet, tts: { provider: "cartesia", latencyMs: result.firstByteLatencyMs } })
      .catch(() => { /* Trace export must not interrupt an active phone call. */ });
    call.recentTranscript = [...call.recentTranscript,
      { speaker: "caller" as const, text: event.transcript }, { speaker: "agent" as const, text: responseText, agentId }].slice(-12);
  }
}
