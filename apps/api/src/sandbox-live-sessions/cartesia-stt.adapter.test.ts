import { describe, expect, it } from "vitest";

import { CartesiaSttAdapter } from "./cartesia-stt.adapter";

describe("CartesiaSttAdapter", () => {
  it("builds the Ink 2 turn-detection websocket contract", () => {
    const adapter = new CartesiaSttAdapter({
      apiKey: "cartesia-test-key",
      apiVersion: "2026-03-01",
    });

    const session = adapter.createSession({
      sampleRateHz: 16_000,
      encoding: "pcm_s16le",
    });
    const url = new URL(session.websocketUrl);

    expect(url.origin + url.pathname).toBe("wss://api.cartesia.ai/stt/turns/websocket");
    expect(url.searchParams.get("model")).toBe("ink-2");
    expect(url.searchParams.get("encoding")).toBe("pcm_s16le");
    expect(url.searchParams.get("sample_rate")).toBe("16000");
    expect(url.searchParams.get("cartesia_version")).toBe("2026-03-01");
    expect(session.headers).toEqual({
      "X-API-Key": "cartesia-test-key",
    });
    expect(session.closeMessage).toBe("{\"type\":\"close\"}");
  });

  it("maps Ink 2 turn lifecycle events into runtime transcript events", () => {
    const adapter = new CartesiaSttAdapter({
      apiKey: "cartesia-test-key",
      apiVersion: "2026-03-01",
    });

    expect(adapter.parseMessage(JSON.stringify({
      type: "turn.start",
      request_id: "req-1",
    }))).toMatchObject({
      kind: "telemetry",
      event: "turn.start",
      requestId: "req-1",
    });
    expect(adapter.parseMessage(JSON.stringify({
      type: "turn.update",
      transcript: "I need",
      request_id: "req-1",
    }))).toMatchObject({
      kind: "partial",
      transcript: "I need",
      event: "turn.update",
    });
    expect(adapter.parseMessage(JSON.stringify({
      type: "turn.eager_end",
      transcript: "I need help",
      request_id: "req-1",
    }))).toMatchObject({
      kind: "telemetry",
      event: "turn.eager_end",
      transcript: "I need help",
    });
    expect(adapter.parseMessage(JSON.stringify({
      type: "turn.resume",
      request_id: "req-1",
    }))).toMatchObject({
      kind: "telemetry",
      event: "turn.resume",
    });
    expect(adapter.parseMessage(JSON.stringify({
      type: "turn.end",
      transcript: "I need help with billing.",
      request_id: "req-1",
    }))).toMatchObject({
      kind: "final",
      transcript: "I need help with billing.",
      event: "turn.end",
    });
  });

  it("rejects non-English configuration because Ink 2 is English-only", () => {
    const adapter = new CartesiaSttAdapter({
      apiKey: "cartesia-test-key",
      apiVersion: "2026-03-01",
    });

    expect(() => adapter.assertSupportedLanguage("en")).not.toThrow();
    expect(() => adapter.assertSupportedLanguage("es")).toThrow("Cartesia Ink 2 STT is English-only");
  });
});
