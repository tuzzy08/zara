import { describe, expect, it } from "vitest";

import { RuntimeProviderFailure } from "@zara/core";

import { AssemblyAiStreamingAdapter } from "./assemblyai-streaming.adapter";

describe("AssemblyAiStreamingAdapter", () => {
  it("builds a server-owned streaming session contract for AssemblyAI", () => {
    const adapter = new AssemblyAiStreamingAdapter({
      apiKey: "assembly-test-key",
    });

    const session = adapter.createSession({
      sampleRateHz: 16_000,
      formatTurns: true,
      endOfTurnConfidenceThreshold: 0.5,
    });

    expect(session.websocketUrl).toBe(
      "wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&format_turns=true&encoding=pcm_s16le&end_of_turn_confidence_threshold=0.5",
    );
    expect(session.headers).toEqual({
      Authorization: "assembly-test-key",
    });
    expect(session.keepAliveMessage).toBe("{\"type\":\"KeepAlive\"}");
    expect(session.terminateMessage).toBe("{\"type\":\"Terminate\"}");
  });

  it("maps AssemblyAI turn messages into partial and final transcript events", () => {
    const adapter = new AssemblyAiStreamingAdapter({
      apiKey: "assembly-test-key",
    });

    const partial = adapter.parseMessage(
      JSON.stringify({
        type: "Turn",
        transcript: "I need help",
        utterance: "",
        end_of_turn: false,
        end_of_turn_confidence: 0.23,
        words: [
          { confidence: 0.91 },
          { confidence: 0.88 },
          { confidence: 0.93 },
        ],
      }),
    );
    const finalTurn = adapter.parseMessage(
      JSON.stringify({
        type: "Turn",
        transcript: "I need help with billing",
        utterance: "I need help with billing",
        end_of_turn: true,
        end_of_turn_confidence: 0.81,
        words: [
          { confidence: 0.91 },
          { confidence: 0.88 },
          { confidence: 0.93 },
          { confidence: 0.95 },
          { confidence: 0.9 },
        ],
      }),
    );

    expect(partial).toMatchObject({
      kind: "partial",
      transcript: "I need help",
      endOfTurn: false,
    });
    expect(finalTurn).toMatchObject({
      kind: "final",
      transcript: "I need help with billing",
      utterance: "I need help with billing",
      endOfTurn: true,
    });
    expect((finalTurn?.confidence ?? 0) > 0.9).toBe(true);
  });

  it("maps provider close diagnostics into runtime provider failures", () => {
    const adapter = new AssemblyAiStreamingAdapter({
      apiKey: "assembly-test-key",
    });

    const timeoutFailure = adapter.mapCloseToRuntimeFailure({
      code: 4008,
      reason: "Inactivity timeout",
    });
    const authFailure = adapter.mapCloseToRuntimeFailure({
      code: 3005,
      reason: "Authentication failed",
    });

    expect(timeoutFailure).toBeInstanceOf(RuntimeProviderFailure);
    expect(timeoutFailure.code).toBe("timeout");
    expect(authFailure.code).toBe("failed");
  });
});
