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
      minTurnSilenceMs: 300,
      maxTurnSilenceMs: 1_000,
    });

    expect(session.websocketUrl).toBe(
      "wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&speech_model=u3-rt-pro&encoding=pcm_s16le&min_turn_silence=300&max_turn_silence=1000",
    );
    expect(session.headers).toEqual({
      Authorization: "assembly-test-key",
    });
    expect(session.keepAliveMessage).toBe("{\"type\":\"KeepAlive\"}");
    expect(session.forceEndpointMessage).toBe("{\"type\":\"ForceEndpoint\"}");
    expect(session.terminateMessage).toBe("{\"type\":\"Terminate\"}");
  });

  it("builds a telephony-safe mu-law 8 kHz streaming session contract", () => {
    const adapter = new AssemblyAiStreamingAdapter({
      apiKey: "assembly-test-key",
    });

    const session = adapter.createSession({
      sampleRateHz: 8_000,
      encoding: "pcm_mulaw",
      minTurnSilenceMs: 250,
      maxTurnSilenceMs: 900,
    });

    expect(session.websocketUrl).toBe(
      "wss://streaming.assemblyai.com/v3/ws?sample_rate=8000&speech_model=u3-rt-pro&encoding=pcm_mulaw&min_turn_silence=250&max_turn_silence=900",
    );
  });

  it("builds server-owned accuracy and latency configuration for U3 Pro streaming", () => {
    const adapter = new AssemblyAiStreamingAdapter({
      apiKey: "assembly-test-key",
    });

    const session = adapter.createSession({
      sampleRateHz: 16_000,
      languageCode: "en",
      keytermsPrompt: ["Zara AI", "Zendesk", "billing activation"],
      agentContext: "Hello, thanks for calling Zara AI.",
      minTurnSilenceMs: 224,
      maxTurnSilenceMs: 1536,
      continuousPartials: true,
    });
    const url = new URL(session.websocketUrl);

    expect(url.searchParams.get("language_code")).toBe("en");
    expect(url.searchParams.get("keyterms_prompt")).toBe(JSON.stringify([
      "Zara AI",
      "Zendesk",
      "billing activation",
    ]));
    expect(url.searchParams.get("prompt")).toBe("Hello, thanks for calling Zara AI.");
    expect(url.searchParams.get("min_turn_silence")).toBe("224");
    expect(url.searchParams.get("max_turn_silence")).toBe("1536");
    expect(url.searchParams.get("continuous_partials")).toBe("true");
    expect(session.updateConfigurationMessage({
      agentContext: "Sure, I can check the account activation ticket.",
      keytermsPrompt: ["account activation", "Zendesk"],
      minTurnSilenceMs: 300,
      maxTurnSilenceMs: 1200,
      continuousPartials: false,
    })).toBe(JSON.stringify({
      type: "UpdateConfiguration",
      keyterms_prompt: ["account activation", "Zendesk"],
      min_turn_silence: 300,
      max_turn_silence: 1200,
      continuous_partials: false,
      agent_context: "Sure, I can check the account activation ticket.",
    }));
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
    const rateFailure = adapter.mapCloseToRuntimeFailure({
      code: 3007,
      reason: "Audio chunks are arriving too quickly",
    });
    const expiryFailure = adapter.mapCloseToRuntimeFailure({
      code: 3008,
      reason: "Session expired",
    });
    const authFailure = adapter.mapCloseToRuntimeFailure({
      code: 3001,
      reason: "Not authorized",
    });

    expect(timeoutFailure).toBeInstanceOf(RuntimeProviderFailure);
    expect(timeoutFailure.code).toBe("timeout");
    expect(rateFailure.code).toBe("rate_limited");
    expect(rateFailure.message).toContain("audio chunks");
    expect(expiryFailure.code).toBe("timeout");
    expect(expiryFailure.message).toContain("expired");
    expect(authFailure.code).toBe("permission_denied");
    expect(authFailure.message).toContain("authorization failed");
  });
});
