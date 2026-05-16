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
  type LiveSandboxInputMode,
  type LiveSandboxSession,
  type LiveSandboxStreamEvent,
} from "./liveSandboxSessionApi";
import { summarizeLiveSandboxEvent } from "./liveSandboxEventFormatting";
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
  source: string;
  matchedRuleId?: string | undefined;
  reason: string;
}

export interface LiveSandboxMetrics {
  turnCount: number;
  eventCount: number;
  lastFirstByteLatencyMs?: number | undefined;
}

export function useLiveSandboxSession(input: {
  organizationId: string;
  actorUserId: string;
}) {
  const [status, setStatus] = useState<LiveSandboxStatus>("idle");
  const [inputMode, setInputMode] = useState<LiveSandboxInputMode>("typed");
  const [session, setSession] = useState<LiveSandboxSession | null>(null);
  const [events, setEvents] = useState<LiveSandboxStreamEvent[]>([]);
  const [transcript, setTranscript] = useState<LiveSandboxTranscriptEntry[]>([]);
  const [note, setNote] = useState("Ready for a live sandbox run.");
  const [microphoneState, setMicrophoneState] = useState<LiveSandboxMicrophoneState>("idle");
  const [voiceTurnCapturing, setVoiceTurnCapturing] = useState(false);
  const [lastRoutingDecision, setLastRoutingDecision] = useState<LiveSandboxRoutingDecision | null>(null);
  const [lastFirstByteLatencyMs, setLastFirstByteLatencyMs] = useState<number | undefined>(undefined);
  const transportRef = useRef<LiveSandboxTransport | null>(null);
  const recorderRef = useRef<MicrophoneTurnRecorder | null>(null);
  const playerRef = useRef<PcmAudioPlayer | null>(null);
  const sessionRef = useRef<LiveSandboxSession | null>(null);
  const closingRef = useRef(false);

  const metrics = useMemo<LiveSandboxMetrics>(
    () => ({
      turnCount: events.filter((event) => event.type === "turn.completed").length,
      eventCount: events.length,
      ...(lastFirstByteLatencyMs !== undefined ? { lastFirstByteLatencyMs } : {}),
    }),
    [events, lastFirstByteLatencyMs],
  );

  const clearSessionState = useCallback(() => {
    setEvents([]);
    setTranscript([]);
    setLastRoutingDecision(null);
    setLastFirstByteLatencyMs(undefined);
    setVoiceTurnCapturing(false);
  }, []);

  const disconnect = useCallback(async (endRemoteSession: boolean) => {
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
    playerRef.current = null;
    if (player !== null) {
      await player.dispose();
    }

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

    if (event.type === "turn.audio.chunk" && typeof event.payload.audioBase64 === "string") {
      void playerRef.current?.enqueue(event.payload.audioBase64);
      return;
    }

    if (event.type === "stt.partial" && typeof event.payload.transcript === "string") {
      setNote(`Listening: ${event.payload.transcript}`);
      return;
    }

    if (event.type === "call.failed" && typeof event.payload.message === "string") {
      setStatus("error");
      setNote(event.payload.message);
      return;
    }

    if (event.type === "call.ended") {
      setStatus("ended");
      setNote("Sandbox call ended.");
    }
  }, [appendTranscript]);

  const startSession = useCallback(async (startInput: {
    workspaceId: string;
    source: "draft" | "published";
    inputMode: LiveSandboxInputMode;
    entryRoleId: string;
    manifest: CompiledRuntimeManifest;
  }) => {
    await disconnect(true);
    clearSessionState();
    setInputMode(startInput.inputMode);
    setStatus("connecting");
    setNote(startInput.inputMode === "voice" ? "Requesting microphone access." : "Opening live sandbox session.");

    let recorder: MicrophoneTurnRecorder | null = null;

    if (startInput.inputMode === "voice") {
      setMicrophoneState("requesting");

      try {
        recorder = await createMicrophoneTurnRecorder({
          onAudioChunk: (audioBase64) => {
            transportRef.current?.appendAudioChunk(audioBase64);
          },
        });
        recorderRef.current = recorder;
        setMicrophoneState("granted");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Microphone access was denied.";
        setMicrophoneState(message.includes("unavailable") ? "unsupported" : "denied");
        setStatus("error");
        setNote(message);
        return;
      }
    } else {
      setMicrophoneState("idle");
    }

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

      if (liveSession.transportToken === undefined) {
        throw new Error("The live sandbox transport token was not returned by the API.");
      }

      sessionRef.current = liveSession;
      setSession(liveSession);
      playerRef.current = createPcmAudioPlayer();

      const transport = createLiveSandboxTransport({
        transportUrl: liveSession.transportUrl,
        transportToken: liveSession.transportToken,
        workspaceId: liveSession.workspaceId,
        source: liveSession.source,
        onEvent: handleEvent,
        onClose: () => {
          if (!closingRef.current) {
            setStatus("ended");
            setVoiceTurnCapturing(false);
          }
        },
        onError: (error) => {
          setStatus("error");
          setNote(error.message);
        },
      });

      transportRef.current = transport;
      await transport.connect();
      setStatus("active");
      setNote(
        startInput.inputMode === "voice"
          ? "Microphone live. Capture a caller turn to run the workflow."
          : "Typed sandbox is live.",
      );
    } catch (error) {
      await disconnect(false);
      setStatus("error");
      setNote(error instanceof Error ? error.message : "The live sandbox could not be started.");
    }
  }, [clearSessionState, disconnect, handleEvent, input.actorUserId, input.organizationId]);

  const sendTextTurn = useCallback((turn: { transcript: string; callPhase?: string | undefined }) => {
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

  const stopVoiceTurnCapture = useCallback((callPhase?: string | undefined) => {
    if (status !== "active" || recorderRef.current === null || transportRef.current === null) {
      return;
    }

    recorderRef.current.stopTurnCapture();
    transportRef.current.commitAudioTurn({
      sampleRateHz: recorderRef.current.sampleRateHz,
      ...(callPhase !== undefined ? { callPhase } : {}),
    });
    setVoiceTurnCapturing(false);
    setNote("Sending voice turn.");
  }, [status]);

  const endSessionNow = useCallback(async () => {
    await disconnect(true);
    setStatus("ended");
    setVoiceTurnCapturing(false);
    setNote("Sandbox call ended.");
  }, [disconnect]);

  const resetSession = useCallback(async () => {
    await disconnect(true);
    clearSessionState();
    setSession(null);
    setStatus("idle");
    setInputMode("typed");
    setMicrophoneState("idle");
    setNote("Ready for a live sandbox run.");
  }, [clearSessionState, disconnect]);

  useEffect(() => () => {
    void disconnect(true);
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
    lastRoutingDecision,
    metrics,
    startSession,
    sendTextTurn,
    startVoiceTurnCapture,
    stopVoiceTurnCapture,
    endSession: endSessionNow,
    resetSession,
  };
}
