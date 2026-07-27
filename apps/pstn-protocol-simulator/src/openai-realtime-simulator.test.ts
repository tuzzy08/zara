import { describe, expect, it, vi } from "vitest";

import {
  OpenAiRealtimeScenario,
  createOpenAiRealtimeScenarioEvents,
  waitForOpenAiRealtimeEvent,
} from "./openai-realtime-simulator";

describe("OpenAI realtime protocol simulator", () => {
  it("models readiness, caller turns, audio, transcript, and completion deterministically", async () => {
    const scenario: OpenAiRealtimeScenario = {
      callFingerprint: "fp-call-1",
      responseMode: "normal",
      timing: { mode: "delayed", delayMs: 35 },
    };

    const events = await createOpenAiRealtimeScenarioEvents(scenario);

    expect(events.slice(0, 5).map((event) => event.type)).toEqual([
      "input_audio_buffer.speech_started",
      "input_audio_buffer.speech_stopped",
      "input_audio_buffer.committed",
      "conversation.item.input_audio_transcription.completed",
      "response.created",
    ]);
    expect(events.filter((event) => event.type === "response.output_audio.delta")).toHaveLength(30);
    expect(events.slice(-3).map((event) => event.type)).toEqual([
      "response.output_audio.done",
      "response.output_audio_transcript.done",
      "response.done",
    ]);
  });

  it("paces delayed and faster-than-realtime event streams", async () => {
    const sleep = vi.fn(async () => undefined);

    await waitForOpenAiRealtimeEvent({ mode: "delayed", delayMs: 35 }, sleep);
    await waitForOpenAiRealtimeEvent({ mode: "faster_than_realtime", factor: 4 }, sleep);
    await waitForOpenAiRealtimeEvent({ mode: "immediate" }, sleep);

    expect(sleep.mock.calls).toEqual([[35], [5]]);
  });

  it.each(["tool", "handoff", "incomplete", "protocol_error", "rate_limit", "output_pressure", "provider_close"] as const)(
    "supports the %s scenario",
    async (responseMode) => {
      const events = await createOpenAiRealtimeScenarioEvents({
        callFingerprint: `fp-${responseMode}`,
        responseMode,
        timing: { mode: "immediate" },
      });

      expect(events.length).toBeGreaterThan(0);
    },
  );
});
