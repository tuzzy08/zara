/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompiledRuntimeManifest } from "@zara/core";

const transportHarness = vi.hoisted(() => ({
  onEvent: undefined as undefined | ((event: Record<string, unknown>) => void),
  close: vi.fn(),
  sendTextTurn: vi.fn(),
  startTurnCapture: vi.fn(),
  playerInterrupt: vi.fn(),
}));

vi.mock("./liveSandboxAudio", () => ({
  createMicrophoneTurnRecorder: vi.fn(async () => ({
    dispose: vi.fn(async () => {}),
    sampleRateHz: 16_000,
    startTurnCapture: transportHarness.startTurnCapture,
    stopTurnCapture: vi.fn(),
  })),
  createPcmAudioPlayer: () => ({
    dispose: vi.fn(async () => {}),
    enqueue: vi.fn(async () => {}),
    interrupt: transportHarness.playerInterrupt,
    prime: vi.fn(async () => {}),
  }),
}));

vi.mock("./liveSandboxSessionApi", () => ({
  createLiveSandboxSession: vi.fn(async (input: { inputMode?: "typed" | "voice" }) => ({
    sessionId: "sandbox-session-1",
    organizationId: "tenant-west-africa",
    workspaceId: "workspace-default",
    actorUserId: "user-ops-lead",
    source: "draft",
    inputMode: input.inputMode ?? "typed",
    entryAgentId: "agent-front-desk",
    manifestId: "manifest-live-sandbox",
    publishedVersionId: "draft",
    runtimeProfile: "cost-optimized",
    transportUrl: "ws://sandbox.test/session",
    transportToken: "transport-token",
    providerStack: {
      stt: "assemblyai-streaming",
      tts: "cartesia-sonic-3",
    },
    createdAt: "2026-05-25T09:00:00.000Z",
    expiresAt: "2026-05-25T09:10:00.000Z",
    status: "ready",
  })),
  endLiveSandboxSession: vi.fn(async () => ({
    sessionId: "sandbox-session-1",
    status: "ended",
    endedAt: "2026-05-25T09:05:00.000Z",
  })),
  getLiveSandboxSessionEvents: vi.fn(async () => []),
  reconnectLiveSandboxSession: vi.fn(),
}));

vi.mock("./liveSandboxTransport", () => ({
  createLiveSandboxTransport: vi.fn((input: { onEvent: (event: Record<string, unknown>) => void }) => {
    transportHarness.onEvent = input.onEvent;

    return {
      appendAudioChunk: vi.fn(),
      close: transportHarness.close,
      commitAudioTurn: vi.fn(),
      connect: vi.fn(async () => {}),
      sendTextTurn: transportHarness.sendTextTurn,
    };
  }),
}));

vi.mock("./runtimeSessionApi", () => ({
  createRealtimeRuntimeSession: vi.fn(async () => ({
    sessionId: "premium-session-1",
    manifestId: "manifest-live-sandbox",
    publishedVersionId: "draft",
    activeAgentId: "agent-front-desk",
    runtime: "openai-realtime",
    policy: "premium-realtime",
    model: "gpt-realtime-2",
    voice: "expressive",
    transportUrl: "/runtime/realtime/sessions/premium-session-1/stream",
    expiresAt: "2026-05-25T09:10:00.000Z",
    toolDeclarations: [],
    observedEventTypes: [],
  })),
}));

import { useLiveSandboxSession } from "./useLiveSandboxSession";

describe("useLiveSandboxSession", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    transportHarness.onEvent = undefined;
    transportHarness.close.mockClear();
    transportHarness.sendTextTurn.mockClear();
    transportHarness.startTurnCapture.mockClear();
    transportHarness.playerInterrupt.mockClear();
  });

  it("preserves transcript and event replay after ending until reset is requested", async () => {
    render(<LiveSandboxHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("active"));

    act(() => {
      transportHarness.onEvent?.({
        sessionId: "sandbox-session-1",
        sequence: 1,
        type: "turn.transcribed",
        at: "2026-05-25T09:00:02.000Z",
        payload: {
          transcript: "Can you explain this charge?",
        },
      });
      transportHarness.onEvent?.({
        sessionId: "sandbox-session-1",
        sequence: 2,
        type: "turn.completed",
        at: "2026-05-25T09:00:04.000Z",
        payload: {
          responseText: "I can help with that billing question.",
        },
      });
    });

    expect(screen.getByText("Can you explain this charge?")).toBeTruthy();
    expect(screen.getByText("I can help with that billing question.")).toBeTruthy();
    expect(screen.getByTestId("event-count").textContent).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "End" }));

    await screen.findByText("ended");
    expect(screen.getByText("Can you explain this charge?")).toBeTruthy();
    expect(screen.getByText("I can help with that billing question.")).toBeTruthy();
    expect(screen.getByTestId("event-count").textContent).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("idle"));
    expect(screen.queryByText("Can you explain this charge?")).toBeNull();
    expect(screen.queryByText("I can help with that billing question.")).toBeNull();
    expect(screen.getByTestId("event-count").textContent).toBe("0");
  });

  it("tracks actual call latency separately from provider first-byte telemetry", async () => {
    render(<LiveSandboxHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("active"));

    act(() => {
      transportHarness.onEvent?.({
        sessionId: "sandbox-session-1",
        sequence: 1,
        type: "turn.audio.first_byte",
        at: "2026-05-25T09:00:03.098Z",
        payload: {
          latencyMs: 98,
        },
      });
      transportHarness.onEvent?.({
        sessionId: "sandbox-session-1",
        sequence: 2,
        type: "turn.latency.measured",
        at: "2026-05-25T09:00:04.420Z",
        payload: {
          stage: "first_audio",
          totalLatencyMs: 1420,
        },
      });
    });

    expect(screen.getByTestId("provider-first-byte-latency").textContent).toBe("98");
    expect(screen.getByTestId("call-latency").textContent).toBe("1420");
  });

  it("passes selected sandbox intent through typed turns", async () => {
    render(<LiveSandboxHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("active"));
    fireEvent.click(screen.getByRole("button", { name: "Send billing turn" }));

    expect(transportHarness.sendTextTurn).toHaveBeenCalledWith({
      transcript: "Please route this to the right specialist.",
      callPhase: "tool-use",
      intent: "billing",
    });
  });

  it("shows runtime failures in the transcript when a voice turn fails after transcription", async () => {
    render(<LiveSandboxHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Start voice" }));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("active"));
    expect(screen.getByTestId("voice-capturing").textContent).toBe("capturing");

    act(() => {
      transportHarness.onEvent?.({
        sessionId: "sandbox-session-1",
        sequence: 1,
        type: "turn.transcribed",
        at: "2026-05-25T09:00:02.000Z",
        payload: {
          transcript: "Hello?",
        },
      });
      transportHarness.onEvent?.({
        sessionId: "sandbox-session-1",
        sequence: 2,
        type: "call.failed",
        at: "2026-05-25T09:00:04.000Z",
        payload: {
          stage: "runtime",
          message: "Gemini text model is not configured. Missing: GEMINI_API_KEY.",
        },
      });
    });

    expect(screen.getByText("Hello?")).toBeTruthy();
    expect(screen.getByText("Gemini text model is not configured. Missing: GEMINI_API_KEY.")).toBeTruthy();
    expect(screen.getByTestId("status").textContent).toBe("error");
    expect(screen.getByTestId("voice-capturing").textContent).toBe("idle");
  });

  it("keeps tool failures out of the conversation transcript", async () => {
    render(<LiveSandboxHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("active"));

    act(() => {
      transportHarness.onEvent?.({
        sessionId: "sandbox-session-1",
        sequence: 1,
        type: "turn.transcribed",
        at: "2026-05-25T09:00:02.000Z",
        payload: {
          transcript: "Please check my ticket.",
        },
      });
      transportHarness.onEvent?.({
        sessionId: "sandbox-session-1",
        sequence: 2,
        type: "tool.failed",
        at: "2026-05-25T09:00:03.000Z",
        payload: {
          toolName: "Search tickets",
          summary: "Missing required tool input: query.",
        },
      });
    });

    expect(screen.getByText("Please check my ticket.")).toBeTruthy();
    expect(screen.queryByText("Search tickets failed")).toBeNull();
    expect(screen.getByTestId("event-count").textContent).toBe("2");
  });

  it("stops queued playback when a realtime provider reports caller interruption", async () => {
    render(<LiveSandboxHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Start voice" }));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("active"));

    act(() => {
      transportHarness.onEvent?.({
        sessionId: "sandbox-session-1",
        sequence: 1,
        type: "provider.diagnostic",
        at: "2026-05-25T09:00:02.000Z",
        payload: {
          provider: "openai-realtime",
          eventType: "input_audio_buffer.speech_started",
          itemId: "item-user-2",
        },
      });
    });

    expect(transportHarness.playerInterrupt).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("voice-capturing").textContent).toBe("capturing");
  });

  it("waits for premium realtime provider readiness before starting microphone capture", async () => {
    render(<LiveSandboxHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Start premium voice" }));

    await waitFor(() => expect(transportHarness.onEvent).toBeDefined());
    expect(screen.getByTestId("status").textContent).toBe("connecting");
    expect(screen.getByTestId("voice-capturing").textContent).toBe("idle");
    expect(transportHarness.startTurnCapture).not.toHaveBeenCalled();

    act(() => {
      transportHarness.onEvent?.({
        sessionId: "premium-session-1",
        sequence: 1,
        type: "session.ready",
        at: "2026-05-25T09:00:01.000Z",
        payload: {
          runtimePath: "premium-realtime",
          provider: "openai-realtime",
        },
      });
    });

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("active"));
    expect(screen.getByTestId("voice-capturing").textContent).toBe("capturing");
    expect(transportHarness.startTurnCapture).toHaveBeenCalledTimes(1);
  });
});

function LiveSandboxHarness() {
  const sandbox = useLiveSandboxSession({
    organizationId: "tenant-west-africa",
    actorUserId: "user-ops-lead",
  });

  return (
    <div>
      <div data-testid="status">{sandbox.status}</div>
      <div data-testid="event-count">{sandbox.events.length}</div>
      <div data-testid="provider-first-byte-latency">{sandbox.metrics.lastFirstByteLatencyMs ?? ""}</div>
      <div data-testid="call-latency">{sandbox.metrics.lastCallLatencyMs ?? ""}</div>
      <div data-testid="voice-capturing">{sandbox.voiceTurnCapturing ? "capturing" : "idle"}</div>
      <button
        type="button"
        onClick={() =>
          void sandbox.startSession({
            workspaceId: "workspace-default",
            source: "draft",
            inputMode: "typed",
            entryAgentId: "agent-front-desk",
            manifest: createManifest(),
          })
        }
      >
        Start
      </button>
      <button
        type="button"
        onClick={() =>
          void sandbox.startSession({
            workspaceId: "workspace-default",
            source: "draft",
            inputMode: "voice",
            entryAgentId: "agent-front-desk",
            manifest: createManifest(),
          })
        }
      >
        Start voice
      </button>
      <button
        type="button"
        onClick={() =>
          void sandbox.startSession({
            workspaceId: "workspace-default",
            source: "draft",
            inputMode: "voice",
            entryAgentId: "agent-front-desk",
            manifest: createManifest({ runtimeProfile: "premium-realtime" }),
          })
        }
      >
        Start premium voice
      </button>
      <button type="button" onClick={() => void sandbox.endSession()}>
        End
      </button>
      <button type="button" onClick={() => void sandbox.resetSession()}>
        Reset
      </button>
      <button
        type="button"
        onClick={() =>
          sandbox.sendTextTurn({
            transcript: "Please route this to the right specialist.",
            callPhase: "tool-use",
            intent: "billing",
          })
        }
      >
        Send billing turn
      </button>
      {sandbox.transcript.map((entry) => (
        <p key={entry.id}>{entry.text}</p>
      ))}
    </div>
  );
}

function createManifest(input: {
  runtimeProfile?: "cost-optimized" | "balanced" | "premium-realtime";
} = {}): CompiledRuntimeManifest {
  const runtimeProfile = input.runtimeProfile ?? "cost-optimized";
  return {
    manifestId: "manifest-live-sandbox",
    publishedVersionId: "draft",
    workflowId: "workflow-live-sandbox",
    version: 1,
    tenantId: "tenant-west-africa",
    environment: "production",
    workspaceId: "workspace-default",
    runtime: runtimeProfile === "premium-realtime" ? "openai-realtime" : "sandwich-pipeline",
    runtimeProfile,
    telephonyProvider: "browser-webrtc",
    telephonyOwnership: "platform",
    entryNodeId: "entry",
    entryRoleId: "agent-front-desk",
    roles: [
      {
        id: "agent-front-desk",
        kind: "receptionist",
        name: "Front desk triage",
        businessName: "Tuzzy Labs",
        instructions: "Help the caller.",
        defaultModelTier: "cheap",
        toolIds: [],
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: true,
        },
      },
    ],
    tools: [],
    graph: {
      id: "workflow-live-sandbox",
      name: "Live sandbox",
      nodes: [],
      edges: [],
    },
    modelRouting: [],
    escalation: {
      enabled: false,
      fallbackMode: "ticket",
      triggers: [],
      fallbackMessage: "",
    },
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor"],
    },
    toolBindings: [],
    agentToolAssignments: [],
    handoffs: [],
    conditions: [],
    routePolicies: [],
    exitNodes: [],
    escalationNode: null,
    memory: {
      mode: "scoped",
      retrievalScopes: ["session"],
      approvalRequired: true,
    },
    budget: {
      monthlyCapUsd: 1000,
      currentSpendUsd: 100,
      projectedCostPerMinuteUsd: 0.3,
      blockOnLimit: true,
    },
    serializedGraph: "{\"nodes\":[],\"edges\":[]}",
    compiledDefinitionHash: "hash-live-sandbox",
  };
}
