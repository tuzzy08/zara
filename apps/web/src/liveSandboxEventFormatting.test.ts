import { describe, expect, it } from "vitest";

import {
  selectDiagnosticLiveSandboxEvents,
  selectRecentLiveSandboxEvents,
  summarizeLiveSandboxEvent,
} from "./liveSandboxEventFormatting";
import type { LiveSandboxStreamEvent } from "./liveSandboxSessionApi";

describe("live sandbox event formatting", () => {
  it("names the selected provider and model for routing events", () => {
    const summary = summarizeLiveSandboxEvent({
      sessionId: "sandbox-live-1",
      sequence: 2,
      type: "routing.model_selected",
      at: "2026-05-25T10:00:00.000Z",
      payload: {
        tier: "standard",
        provider: "google-gemini",
        modelId: "gemini-3.1-pro-preview",
        reason: "No routing rule matched.",
      },
    } satisfies LiveSandboxStreamEvent);

    expect(summary).toMatchObject({
      label: "Routing",
      title: "Gemini gemini-3.1-pro-preview selected",
      detail: "Standard tier - No routing rule matched.",
      tone: "blue",
    });
  });

  it("surfaces model failure diagnostics instead of opaque event names", () => {
    const summary = summarizeLiveSandboxEvent({
      sessionId: "sandbox-live-1",
      sequence: 4,
      type: "quality.flagged",
      at: "2026-05-25T10:00:00.000Z",
      payload: {
        stage: "model",
        code: "failed",
        message: "Live sandbox text model is not configured.",
      },
    } satisfies LiveSandboxStreamEvent);

    expect(summary).toMatchObject({
      label: "Model",
      title: "Text model needs attention",
      detail: "Live sandbox text model is not configured.",
      tone: "red",
    });
  });

  it("de-emphasizes repeated buffered-audio events in the recent event list", () => {
    const events = [
      liveEvent(1, "input.audio.buffered"),
      liveEvent(2, "input.audio.buffered"),
      liveEvent(3, "stt.partial"),
      liveEvent(4, "input.audio.buffered"),
      liveEvent(5, "turn.completed"),
    ];

    expect(selectRecentLiveSandboxEvents(events)).toEqual([
      liveEvent(3, "stt.partial"),
      liveEvent(5, "turn.completed"),
    ]);
  });

  it("keeps the newest buffered-audio event when it is the only live signal", () => {
    const events = [
      liveEvent(1, "input.audio.buffered"),
      liveEvent(2, "input.audio.buffered"),
    ];

    expect(selectRecentLiveSandboxEvents(events)).toEqual([
      liveEvent(2, "input.audio.buffered"),
    ]);
  });

  it("keeps STT and turn diagnostics visible when buffered audio floods the event stream", () => {
    const events = [
      ...Array.from({ length: 20 }, (_, index) => liveEvent(index + 1, "input.audio.buffered")),
      liveEvent(21, "provider.telemetry", { stage: "stt", event: "session_opened" }),
      liveEvent(22, "provider.telemetry", { stage: "stt", event: "audio_first_frame" }),
      ...Array.from({ length: 200 }, (_, index) => liveEvent(index + 23, "input.audio.buffered")),
      liveEvent(223, "stt.partial", { transcript: "Hello" }),
      liveEvent(224, "provider.telemetry", { stage: "stt", event: "final", latencyMs: 850 }),
      liveEvent(225, "turn.transcribed", { transcript: "Hello?" }),
      liveEvent(226, "provider.telemetry", { stage: "model", latencyMs: 1200 }),
      liveEvent(227, "turn.audio.first_byte", { latencyMs: 80 }),
      liveEvent(228, "quality.flagged", {
        stage: "model",
        code: "failed",
        message: "Live sandbox text model failed after transcription.",
      }),
    ];

    expect(selectDiagnosticLiveSandboxEvents(events).map((event) => event.sequence)).toEqual([
      21,
      22,
      223,
      224,
      225,
      226,
      227,
      228,
    ]);
  });

  it("pins failure diagnostics when long calls exceed the diagnostics limit", () => {
    const events = [
      liveEvent(1, "provider.telemetry", { stage: "stt", event: "session_opened" }),
      liveEvent(2, "tool.failed", {
        toolName: "Search tickets",
        reason: "Tool 'Search tickets' could not run because permission was denied.",
      }),
      ...Array.from({ length: 60 }, (_, index) =>
        liveEvent(index + 3, "provider.telemetry", {
          stage: "stt",
          event: index % 2 === 0 ? "audio_first_frame" : "final",
          endpointMs: 500 + index,
        })),
      liveEvent(63, "quality.flagged", {
        stage: "model",
        code: "failed",
        message: "Gemini quota exceeded.",
      }),
    ];

    const selected = selectDiagnosticLiveSandboxEvents(events, 40);

    expect(selected).toHaveLength(40);
    expect(selected.map((event) => event.sequence)).toContain(2);
    expect(selected.map((event) => event.sequence)).toContain(63);
  });

  it("surfaces degraded model fallbacks as failed turns instead of successful agent responses", () => {
    expect(
      summarizeLiveSandboxEvent(liveEvent(41, "turn.completed", {
        transcript: "Hello.",
        responseText: "I'm sorry, I had trouble responding just now. Could you try that again?",
        degraded: true,
        failureStage: "model",
      })),
    ).toMatchObject({
      label: "Agent",
      title: "Agent response degraded",
      detail: "Model fallback response was used.",
      tone: "red",
    });

    expect(
      summarizeLiveSandboxEvent(liveEvent(42, "provider.telemetry", {
        stage: "model",
        provider: "google-gemini",
        latencyMs: 2170,
        tier: "standard",
        degraded: true,
        failureStage: "model",
      })),
    ).toMatchObject({
      label: "Model",
      title: "Gemini used a fallback in 2170ms",
      detail: "Standard tier - model failure",
      tone: "red",
    });
  });

  it("shows the provider tool failure message when a configured tool fails", () => {
    expect(
      summarizeLiveSandboxEvent(liveEvent(52, "tool.failed", {
        toolName: "Search tickets",
        summary: "Tool 'Search tickets' failed.",
        error: {
          code: "tool_execution.failed",
          message: "Live sandbox tool 'zendesk.tickets.search' returned HTTP 400.",
          recoverable: true,
        },
      })),
    ).toMatchObject({
      label: "Tool",
      title: "Search tickets failed",
      detail: "Live sandbox tool 'zendesk.tickets.search' returned HTTP 400.",
      tone: "red",
    });
  });

  it("surfaces redacted premium provider event evidence instead of generic provider messages", () => {
    const summary = summarizeLiveSandboxEvent(liveEvent(61, "provider.message", {
      provider: "openai-realtime",
      model: "gpt-realtime-2",
      eventType: "response.output_item.done",
      responseId: "resp_123",
      itemId: "item_456",
      callId: "call_789",
      status: "completed",
      audioBase64: "raw-audio-must-not-render",
      apiKey: "sk-must-not-render",
    }));

    expect(summary).toMatchObject({
      label: "Provider",
      title: "OpenAI Realtime response.output_item.done",
      detail: "response resp_123; item item_456; call call_789; completed",
      tone: "blue",
    });
    expect(JSON.stringify(summary)).not.toContain("raw-audio-must-not-render");
    expect(JSON.stringify(summary)).not.toContain("sk-must-not-render");
  });

  it("keeps provider-native tool claims grounded in Zara tool lifecycle events", () => {
    expect(
      summarizeLiveSandboxEvent(liveEvent(62, "tool.requested", {
        toolName: "Search tickets",
        toolId: "zendesk.tickets.search",
        toolCallId: "tool-call-1",
      })),
    ).toMatchObject({
      label: "Tool",
      title: "Search tickets requested",
      detail: "tool-call-1",
      tone: "pink",
    });

    expect(
      selectDiagnosticLiveSandboxEvents([
        liveEvent(62, "tool.requested", { toolName: "Search tickets" }),
        liveEvent(63, "provider.message", {
          provider: "gemini-live",
          eventType: "toolCall",
          callId: "call_1",
        }),
      ]).map((event) => event.type),
    ).toEqual(["tool.requested", "provider.message"]);
  });

  it("names STT telemetry milestones instead of collapsing them into generic provider copy", () => {
    expect(
      summarizeLiveSandboxEvent(liveEvent(12, "provider.telemetry", {
        stage: "stt",
        provider: "assemblyai-streaming",
        event: "audio_first_frame",
      })),
    ).toMatchObject({
      label: "STT",
      title: "AssemblyAI first audio frame received",
    });

    expect(
      summarizeLiveSandboxEvent(liveEvent(13, "provider.telemetry", {
        stage: "stt",
        provider: "assemblyai-streaming",
        event: "final",
        latencyMs: 912,
        listeningMs: 15003,
        speechMs: 7000,
        endpointMs: 1000,
      })),
    ).toMatchObject({
      label: "STT",
      title: "AssemblyAI final transcript after 1000ms endpoint",
      detail: "Speech 7000ms; listening 15003ms",
    });
  });
});

function liveEvent(
  sequence: number,
  type: string,
  payload: Record<string, unknown> = {},
): LiveSandboxStreamEvent {
  return {
    sessionId: "sandbox-live-1",
    sequence,
    type,
    at: "2026-05-25T10:00:00.000Z",
    payload,
  };
}
