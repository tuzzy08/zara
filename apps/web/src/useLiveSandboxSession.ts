import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CompiledRuntimeManifest } from "@zara/core";

import {
  createMicrophoneTurnRecorder,
  createPcmAudioPlayer,
  type MicrophoneTurnRecorder,
  type PcmAudioPlayer,
} from "./liveSandboxAudio";
import {
  createLiveSandboxSession,
  endLiveSandboxSession,
  getLiveSandboxSessionEvents,
  reconnectLiveSandboxSession,
  type LiveSandboxInputMode,
  type LiveSandboxManifestSource,
  type LiveSandboxSession,
  type LiveSandboxStreamEvent,
} from "./liveSandboxSessionApi";
import { summarizeLiveSandboxEvent } from "./liveSandboxEventFormatting";
import {
  buildTranscriptFromLiveSandboxEvents,
  getLastCallLatencyFromLiveSandboxEvents,
  getLastFirstByteLatencyFromLiveSandboxEvents,
  getLastRoutingDecisionFromLiveSandboxEvents,
} from "./liveSandboxReplay";
import { createLiveSandboxTransport, type LiveSandboxTransport } from "./liveSandboxTransport";

export type LiveSandboxStatus = "idle" | "connecting" | "active" | "error" | "ended";
export type LiveSandboxMicrophoneState = "idle" | "requesting" | "granted" | "denied" | "unsupported";

export interface LiveSandboxTranscriptEntry {
  id: string;
  speaker: "caller" | "agent" | "system";
  text: string;
  at: string;
}

export interface LiveSandboxRoutingDecision {
  tier: string;
  provider?: string | undefined;
  modelId?: string | undefined;
  source: string;
  matchedRuleId?: string | undefined;
  reason: string;
}

export interface LiveSandboxMetrics {
  turnCount: number;
  eventCount: number;
  lastFirstByteLatencyMs?: number | undefined;
  lastCallLatencyMs?: number | undefined;
}

export interface LiveSandboxResumeContext {
  workspaceId: string;
  source: LiveSandboxManifestSource;
  manifestId: string;
  publishedVersionId: string;
  entryRoleId: string;
}

interface PersistedLiveSandboxSession {
  sessionId: string;
  organizationId: string;
  workspaceId: string;
  source: LiveSandboxManifestSource;
  inputMode: LiveSandboxInputMode;
  entryRoleId: string;
  manifestId: string;
  publishedVersionId: string;
}

const liveSandboxPersistedSessionStorageKey = "zara.live-sandbox.active-session";

export function useLiveSandboxSession(input: {
  organizationId: string;
  actorUserId: string;
  resumeContext?: LiveSandboxResumeContext | undefined;
}) {
  const [status, setStatus] = useState<LiveSandboxStatus>("idle");
  const [inputMode, setInputMode] = useState<LiveSandboxInputMode>("typed");
  const [session, setSession] = useState<LiveSandboxSession | null>(null);
  const [events, setEvents] = useState<LiveSandboxStreamEvent[]>([]);
  const [transcript, setTranscript] = useState<LiveSandboxTranscriptEntry[]>([]);
  const [note, setNote] = useState("Ready for a live sandbox run.");
  const [microphoneState, setMicrophoneState] = useState<LiveSandboxMicrophoneState>("idle");
  const [voiceTurnCapturing, setVoiceTurnCapturing] = useState(false);
  const [agentPlaybackActive, setAgentPlaybackActive] = useState(false);
  const [errorNotice, setErrorNotice] = useState<{ id: number; message: string } | null>(null);
  const [lastRoutingDecision, setLastRoutingDecision] = useState<LiveSandboxRoutingDecision | null>(null);
  const [lastFirstByteLatencyMs, setLastFirstByteLatencyMs] = useState<number | undefined>(undefined);
  const [lastCallLatencyMs, setLastCallLatencyMs] = useState<number | undefined>(undefined);
  const transportRef = useRef<LiveSandboxTransport | null>(null);
  const recorderRef = useRef<MicrophoneTurnRecorder | null>(null);
  const playerRef = useRef<PcmAudioPlayer | null>(null);
  const turnContextRef = useRef<{ callPhase?: string | undefined; intent?: string | undefined }>({
    callPhase: "discovery",
  });
  const sessionRef = useRef<LiveSandboxSession | null>(null);
  const closingRef = useRef(false);
  const attemptedResumeKeyRef = useRef<string | null>(null);
  const agentPlaybackTimeoutRef = useRef<number | null>(null);
  const errorNoticeIdRef = useRef(0);

  const metrics = useMemo<LiveSandboxMetrics>(
    () => ({
      turnCount: events.filter((event) => event.type === "turn.completed").length,
      eventCount: events.length,
      ...(lastFirstByteLatencyMs !== undefined ? { lastFirstByteLatencyMs } : {}),
      ...(lastCallLatencyMs !== undefined ? { lastCallLatencyMs } : {}),
    }),
    [events, lastCallLatencyMs, lastFirstByteLatencyMs],
  );

  const restoreSessionReplay = useCallback((replayedEvents: LiveSandboxStreamEvent[]) => {
    setEvents(replayedEvents);
    setTranscript(buildTranscriptFromLiveSandboxEvents(replayedEvents));
    setLastRoutingDecision(getLastRoutingDecisionFromLiveSandboxEvents(replayedEvents));
    setLastFirstByteLatencyMs(getLastFirstByteLatencyFromLiveSandboxEvents(replayedEvents));
    setLastCallLatencyMs(getLastCallLatencyFromLiveSandboxEvents(replayedEvents));
    setVoiceTurnCapturing(false);
    setAgentPlaybackActive(false);
  }, []);

  const clearSessionState = useCallback(() => {
    restoreSessionReplay([]);
  }, [restoreSessionReplay]);

  const publishErrorNotice = useCallback((message: string) => {
    errorNoticeIdRef.current += 1;
    setErrorNotice({ id: errorNoticeIdRef.current, message });
  }, []);

  useEffect(() => {
    if (errorNotice === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => setErrorNotice(null), 2600);

    return () => window.clearTimeout(timeoutId);
  }, [errorNotice]);

  const prepareAudioInputs = useCallback(async (nextInputMode: LiveSandboxInputMode) => {
    const existingRecorder = recorderRef.current;

    if (existingRecorder !== null) {
      recorderRef.current = null;
      await existingRecorder.dispose();
    }

    if (nextInputMode !== "voice") {
      setMicrophoneState("idle");
      return;
    }

    setMicrophoneState("requesting");

    try {
      const recorder = await createMicrophoneTurnRecorder({
        onAudioChunk: (audioBase64) => {
          const turnContext = turnContextRef.current;
          transportRef.current?.appendAudioChunk(audioBase64, {
            sampleRateHz: recorderRef.current?.sampleRateHz ?? 16_000,
            ...(turnContext.callPhase !== undefined ? { callPhase: turnContext.callPhase } : {}),
            ...(turnContext.intent !== undefined ? { intent: turnContext.intent } : {}),
          });
        },
      });
      recorderRef.current = recorder;
      setMicrophoneState("granted");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Microphone access was denied.";
      setMicrophoneState(message.includes("unavailable") ? "unsupported" : "denied");
      throw new Error(message);
    }
  }, []);

  const ensureAudioPlayer = useCallback(() => {
    if (playerRef.current === null) {
      playerRef.current = createPcmAudioPlayer();
    }

    return playerRef.current;
  }, []);

  const disconnect = useCallback(async (endRemoteSession: boolean, options?: { preserveAudioPlayer?: boolean | undefined }) => {
    closingRef.current = true;

    const liveSession = sessionRef.current;
    sessionRef.current = null;
    setSession(null);

    transportRef.current?.close();
    transportRef.current = null;

    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder !== null) {
      await recorder.dispose();
    }

    const player = playerRef.current;
    if (player !== null && options?.preserveAudioPlayer !== true) {
      playerRef.current = null;
      await player.dispose();
    }

    if (agentPlaybackTimeoutRef.current !== null) {
      window.clearTimeout(agentPlaybackTimeoutRef.current);
      agentPlaybackTimeoutRef.current = null;
    }
    setAgentPlaybackActive(false);
    setVoiceTurnCapturing(false);

    if (endRemoteSession && liveSession !== null) {
      try {
        await endLiveSandboxSession({
          organizationId: input.organizationId,
          sessionId: liveSession.sessionId,
          actorUserId: input.actorUserId,
        });
      } catch {
        // ignore end-session cleanup failures in the browser shell
      }
    }

    if (endRemoteSession) {
      clearPersistedLiveSandboxSession();
    }

    closingRef.current = false;
  }, [input.actorUserId, input.organizationId]);

  const appendTranscript = useCallback((entry: LiveSandboxTranscriptEntry) => {
    setTranscript((current) => {
      if (current.some((candidate) => candidate.id === entry.id)) {
        return current;
      }

      return [...current, entry];
    });
  }, []);

  const handleEvent = useCallback((event: LiveSandboxStreamEvent) => {
    setEvents((current) => {
      if (current.some((candidate) => candidate.sequence === event.sequence && candidate.sessionId === event.sessionId)) {
        return current;
      }

      return [...current, event];
    });

    if (event.type === "turn.transcribed" && typeof event.payload.transcript === "string") {
      appendTranscript({
        id: `${event.sessionId}:${event.sequence}:caller`,
        speaker: "caller",
        text: event.payload.transcript,
        at: event.at,
      });
      return;
    }

    if (event.type === "turn.completed" && typeof event.payload.responseText === "string") {
      appendTranscript({
        id: `${event.sessionId}:${event.sequence}:agent`,
        speaker: "agent",
        text: event.payload.responseText,
        at: event.at,
      });
      setNote("Turn completed.");
      return;
    }

    if (event.type === "tool.failed" || event.type === "agent.handoff.completed") {
      const summary = summarizeLiveSandboxEvent(event);

      appendTranscript({
        id: `${event.sessionId}:${event.sequence}:system`,
        speaker: "system",
        text: summary.title,
        at: event.at,
      });
      return;
    }

    if (
      event.type === "routing.model_selected"
      && typeof event.payload.tier === "string"
      && typeof event.payload.source === "string"
      && typeof event.payload.reason === "string"
    ) {
      setLastRoutingDecision({
        tier: event.payload.tier,
        provider: typeof event.payload.provider === "string" ? event.payload.provider : undefined,
        modelId: typeof event.payload.modelId === "string" ? event.payload.modelId : undefined,
        source: event.payload.source,
        matchedRuleId:
          typeof event.payload.matchedRuleId === "string" ? event.payload.matchedRuleId : undefined,
        reason: event.payload.reason,
      });
      return;
    }

    if (event.type === "turn.audio.first_byte" && typeof event.payload.latencyMs === "number") {
      setLastFirstByteLatencyMs(event.payload.latencyMs);
      return;
    }

    if (event.type === "turn.latency.measured" && typeof event.payload.totalLatencyMs === "number") {
      setLastCallLatencyMs(event.payload.totalLatencyMs);
      return;
    }

    if (event.type === "turn.audio.chunk" && typeof event.payload.audioBase64 === "string") {
      setAgentPlaybackActive(true);
      if (agentPlaybackTimeoutRef.current !== null) {
        window.clearTimeout(agentPlaybackTimeoutRef.current);
      }
      agentPlaybackTimeoutRef.current = window.setTimeout(() => {
        setAgentPlaybackActive(false);
        agentPlaybackTimeoutRef.current = null;
      }, 1800);
      void playerRef.current?.enqueue(event.payload.audioBase64);
      return;
    }

    if (event.type === "stt.partial" && typeof event.payload.transcript === "string") {
      setNote(`Listening: ${event.payload.transcript}`);
      return;
    }

    if (event.type === "call.failed" && typeof event.payload.message === "string") {
      setStatus("error");
      setVoiceTurnCapturing(false);
      setAgentPlaybackActive(false);
      setNote("Live sandbox setup needs attention.");
      appendTranscript({
        id: `${event.sessionId}:${event.sequence}:system`,
        speaker: "system",
        text: event.payload.message,
        at: event.at,
      });
      publishErrorNotice(event.payload.message);
      return;
    }

    if (event.type === "session.error" && typeof event.payload.message === "string") {
      setStatus("error");
      setVoiceTurnCapturing(false);
      setNote("Live sandbox setup needs attention.");
      publishErrorNotice(event.payload.message);
      return;
    }

    if (event.type === "call.ended") {
      clearPersistedLiveSandboxSession();
      setStatus("ended");
      setAgentPlaybackActive(false);
      setNote("Sandbox call ended.");
    }
  }, [appendTranscript, publishErrorNotice]);

  const connectTransport = useCallback(async (liveSession: LiveSandboxSession, transportToken: string) => {
    ensureAudioPlayer();

    sessionRef.current = liveSession;
    setSession(liveSession);
    setInputMode(liveSession.inputMode);

    const transport = createLiveSandboxTransport({
      transportUrl: liveSession.transportUrl,
      transportToken,
      workspaceId: liveSession.workspaceId,
      source: liveSession.source,
      onEvent: handleEvent,
      onClose: () => {
        if (!closingRef.current) {
          setStatus("ended");
          setVoiceTurnCapturing(false);
          setAgentPlaybackActive(false);
        }
      },
      onError: (error) => {
        setStatus("error");
        setAgentPlaybackActive(false);
        setNote("Live sandbox setup needs attention.");
        publishErrorNotice(error.message);
      },
    });

    transportRef.current = transport;
    await transport.connect();
    writePersistedLiveSandboxSession({
      sessionId: liveSession.sessionId,
      organizationId: liveSession.organizationId,
      workspaceId: liveSession.workspaceId,
      source: liveSession.source,
      inputMode: liveSession.inputMode,
      entryRoleId: liveSession.entryRoleId,
      manifestId: liveSession.manifestId,
      publishedVersionId: liveSession.publishedVersionId,
    });
    setStatus("active");
  }, [ensureAudioPlayer, handleEvent, publishErrorNotice]);

  const resumeSession = useCallback(async (persistedSession: PersistedLiveSandboxSession) => {
    setStatus("connecting");
    setInputMode(persistedSession.inputMode);
    setNote("Reconnecting live sandbox session.");
    clearSessionState();

    try {
      await prepareAudioInputs(persistedSession.inputMode);
      const reconnectedSession = await reconnectLiveSandboxSession({
        organizationId: input.organizationId,
        sessionId: persistedSession.sessionId,
        actorUserId: input.actorUserId,
      });

      if (reconnectedSession.transportToken === undefined) {
        throw new Error("A reconnect token was not returned by the live sandbox API.");
      }

      const replayedEvents = await getLiveSandboxSessionEvents({
        organizationId: input.organizationId,
        sessionId: persistedSession.sessionId,
      });

      restoreSessionReplay(replayedEvents);
      await connectTransport(reconnectedSession, reconnectedSession.transportToken);
      if (persistedSession.inputMode === "voice") {
        recorderRef.current?.startTurnCapture();
        setVoiceTurnCapturing(true);
      }
      setNote("Reconnected to live sandbox session.");
    } catch (error) {
      await disconnect(false);
      clearPersistedLiveSandboxSession();
      clearSessionState();
      const message = error instanceof Error ? error.message : "The live sandbox session could not be reconnected.";
      setStatus("error");
      setNote("Live sandbox setup needs attention.");
      publishErrorNotice(message);
    }
  }, [
    clearSessionState,
    connectTransport,
    disconnect,
    input.actorUserId,
    input.organizationId,
    prepareAudioInputs,
    publishErrorNotice,
    restoreSessionReplay,
  ]);

  const startSession = useCallback(async (startInput: {
    workspaceId: string;
    source: LiveSandboxManifestSource;
    inputMode: LiveSandboxInputMode;
    entryRoleId: string;
    manifest: CompiledRuntimeManifest;
    callPhase?: string | undefined;
    intent?: string | undefined;
  }) => {
    const audioPlayer = ensureAudioPlayer();
    void audioPlayer.prime();

    await disconnect(true, { preserveAudioPlayer: true });
    clearSessionState();
    turnContextRef.current = {
      ...(startInput.callPhase !== undefined ? { callPhase: startInput.callPhase } : {}),
      ...(startInput.intent !== undefined ? { intent: startInput.intent } : {}),
    };
    setStatus("connecting");
    setNote(startInput.inputMode === "voice" ? "Checking live voice providers." : "Opening live sandbox session.");
    let createdSession: LiveSandboxSession | null = null;

    try {
      const liveSession = await createLiveSandboxSession({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        workspaceId: startInput.workspaceId,
        source: startInput.source,
        inputMode: startInput.inputMode,
        entryRoleId: startInput.entryRoleId,
        manifest: startInput.manifest,
      });
      createdSession = liveSession;

      if (liveSession.transportToken === undefined) {
        throw new Error("The live sandbox transport token was not returned by the API.");
      }

      await prepareAudioInputs(startInput.inputMode);
      await connectTransport(liveSession, liveSession.transportToken);
      if (startInput.inputMode === "voice") {
        recorderRef.current?.startTurnCapture();
        setVoiceTurnCapturing(true);
      }
      setNote(
        startInput.inputMode === "voice"
          ? "Microphone live. Speak naturally; turns are detected automatically."
          : "Typed sandbox is live.",
      );
      return true;
    } catch (error) {
      if (createdSession !== null) {
        try {
          await endLiveSandboxSession({
            organizationId: input.organizationId,
            sessionId: createdSession.sessionId,
            actorUserId: input.actorUserId,
          });
        } catch {
          // ignore cleanup failures after a partially-created browser session
        }
      }
      await disconnect(false);
      clearPersistedLiveSandboxSession();
      const message = error instanceof Error ? error.message : "The live sandbox could not be started.";
      setStatus("error");
      setNote("Live sandbox setup needs attention.");
      publishErrorNotice(message);
      return false;
    }
  }, [
    clearSessionState,
    connectTransport,
    disconnect,
    ensureAudioPlayer,
    input.actorUserId,
    input.organizationId,
    prepareAudioInputs,
    publishErrorNotice,
  ]);

  const sendTextTurn = useCallback((turn: {
    transcript: string;
    callPhase?: string | undefined;
    intent?: string | undefined;
  }) => {
    if (status !== "active" || transportRef.current === null) {
      return;
    }

    transportRef.current.sendTextTurn(turn);
    setNote("Running caller turn.");
  }, [status]);

  const startVoiceTurnCapture = useCallback(() => {
    if (status !== "active" || recorderRef.current === null) {
      return;
    }

    recorderRef.current.startTurnCapture();
    setVoiceTurnCapturing(true);
    setNote("Listening for a caller turn.");
  }, [status]);

  const setTurnContext = useCallback((context: { callPhase?: string | undefined; intent?: string | undefined }) => {
    turnContextRef.current = {
      ...(context.callPhase !== undefined ? { callPhase: context.callPhase } : {}),
      ...(context.intent !== undefined ? { intent: context.intent } : {}),
    };
  }, []);

  const stopVoiceTurnCapture = useCallback((context?: {
    callPhase?: string | undefined;
    intent?: string | undefined;
  }) => {
    if (status !== "active" || recorderRef.current === null || transportRef.current === null) {
      return;
    }

    const turnContext = context ?? turnContextRef.current;
    turnContextRef.current = turnContext;
    recorderRef.current.stopTurnCapture();
    transportRef.current.commitAudioTurn({
      sampleRateHz: recorderRef.current.sampleRateHz,
      ...(turnContext.callPhase !== undefined ? { callPhase: turnContext.callPhase } : {}),
      ...(turnContext.intent !== undefined ? { intent: turnContext.intent } : {}),
    });
    setVoiceTurnCapturing(false);
    setNote("Sending voice turn.");
  }, [status]);

  const endSessionNow = useCallback(async () => {
    await disconnect(true);
    setStatus("ended");
    setVoiceTurnCapturing(false);
    setAgentPlaybackActive(false);
    setNote("Sandbox call ended.");
  }, [disconnect]);

  const resetSession = useCallback(async () => {
    await disconnect(true);
    clearSessionState();
    setSession(null);
    setStatus("idle");
    setInputMode("typed");
    setMicrophoneState("idle");
    setAgentPlaybackActive(false);
    setNote("Ready for a live sandbox run.");
  }, [clearSessionState, disconnect]);

  const resumeContextKey = input.resumeContext === undefined
    ? null
    : [
        input.resumeContext.workspaceId,
        input.resumeContext.source,
        input.resumeContext.manifestId,
        input.resumeContext.publishedVersionId,
        input.resumeContext.entryRoleId,
      ].join("|");

  useEffect(() => {
    if (resumeContextKey === null) {
      attemptedResumeKeyRef.current = null;
      return;
    }

    if (attemptedResumeKeyRef.current === resumeContextKey) {
      return;
    }

    attemptedResumeKeyRef.current = resumeContextKey;
    const persistedSession = readPersistedLiveSandboxSession();

    if (
      persistedSession === null
      || !matchesResumeContext({
        persistedSession,
        organizationId: input.organizationId,
        resumeContext: input.resumeContext,
      })
    ) {
      return;
    }

    void resumeSession(persistedSession);
  }, [input.organizationId, input.resumeContext, resumeContextKey, resumeSession]);

  useEffect(() => () => {
    if (agentPlaybackTimeoutRef.current !== null) {
      window.clearTimeout(agentPlaybackTimeoutRef.current);
      agentPlaybackTimeoutRef.current = null;
    }
    void disconnect(false);
  }, [disconnect]);

  return {
    status,
    inputMode,
    session,
    events,
    transcript,
    note,
    microphoneState,
    voiceTurnCapturing,
    agentPlaybackActive,
    errorNotice,
    lastRoutingDecision,
    metrics,
    startSession,
    sendTextTurn,
    setTurnContext,
    startVoiceTurnCapture,
    stopVoiceTurnCapture,
    endSession: endSessionNow,
    resetSession,
  };
}

function readPersistedLiveSandboxSession(): PersistedLiveSandboxSession | null {
  if (typeof window === "undefined" || typeof window.sessionStorage === "undefined") {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(liveSandboxPersistedSessionStorageKey);

    if (rawValue === null) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Record<string, unknown>;

    if (
      typeof parsed.sessionId !== "string"
      || typeof parsed.organizationId !== "string"
      || typeof parsed.workspaceId !== "string"
      || (parsed.source !== "draft" && parsed.source !== "published")
      || (parsed.inputMode !== "typed" && parsed.inputMode !== "voice")
      || typeof parsed.entryRoleId !== "string"
      || typeof parsed.manifestId !== "string"
      || typeof parsed.publishedVersionId !== "string"
    ) {
      return null;
    }

    return {
      sessionId: parsed.sessionId,
      organizationId: parsed.organizationId,
      workspaceId: parsed.workspaceId,
      source: parsed.source,
      inputMode: parsed.inputMode,
      entryRoleId: parsed.entryRoleId,
      manifestId: parsed.manifestId,
      publishedVersionId: parsed.publishedVersionId,
    };
  } catch {
    return null;
  }
}

function writePersistedLiveSandboxSession(session: PersistedLiveSandboxSession) {
  if (typeof window === "undefined" || typeof window.sessionStorage === "undefined") {
    return;
  }

  window.sessionStorage.setItem(
    liveSandboxPersistedSessionStorageKey,
    JSON.stringify(session),
  );
}

function clearPersistedLiveSandboxSession() {
  if (typeof window === "undefined" || typeof window.sessionStorage === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(liveSandboxPersistedSessionStorageKey);
}

function matchesResumeContext(input: {
  persistedSession: PersistedLiveSandboxSession;
  organizationId: string;
  resumeContext: LiveSandboxResumeContext | undefined;
}) {
  const { persistedSession, organizationId, resumeContext } = input;

  if (resumeContext === undefined) {
    return false;
  }

  return (
    persistedSession.organizationId === organizationId
    && persistedSession.workspaceId === resumeContext.workspaceId
    && persistedSession.source === resumeContext.source
    && persistedSession.manifestId === resumeContext.manifestId
    && persistedSession.publishedVersionId === resumeContext.publishedVersionId
    && persistedSession.entryRoleId === resumeContext.entryRoleId
  );
}
