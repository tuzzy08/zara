import { describe, expect, it } from "vitest";
import { RuntimeProviderFailure } from "@zara/core";

import { CartesiaStreamingAdapter } from "./cartesia-streaming.adapter";

describe("CartesiaStreamingAdapter", () => {
  it("builds a server-owned Cartesia websocket session contract", () => {
    const adapter = new CartesiaStreamingAdapter({
      apiKey: "cartesia-test-key",
      apiVersion: "2026-03-01",
    });

    const session = adapter.createSession();

    expect(session.websocketUrl).toBe(
      "wss://api.cartesia.ai/tts/websocket?api_key=cartesia-test-key&cartesia_version=2026-03-01",
    );
  });

  it("builds a Sonic 3 generation request with output format and timestamps", () => {
    const adapter = new CartesiaStreamingAdapter({
      apiKey: "cartesia-test-key",
      apiVersion: "2026-03-01",
    });

    const request = adapter.createGenerationRequest({
      transcript: "Hello from Zara",
      contextId: "context-123",
      voiceId: "f786b574-daa5-4673-aa0c-cbe3e8534c02",
      language: "en",
      sampleRateHz: 16_000,
    });

    expect(request).toEqual({
      model_id: "sonic-3",
      transcript: "Hello from Zara",
      voice: {
        mode: "id",
        id: "f786b574-daa5-4673-aa0c-cbe3e8534c02",
      },
      language: "en",
      context_id: "context-123",
      output_format: {
        container: "raw",
        encoding: "pcm_s16le",
        sample_rate: 16000,
      },
      add_timestamps: true,
      continue: false,
    });
  });

  it("builds a PSTN-ready mu-law 8 kHz generation request", () => {
    const adapter = new CartesiaStreamingAdapter({
      apiKey: "cartesia-test-key",
      apiVersion: "2026-03-01",
    });

    const request = adapter.createGenerationRequest({
      transcript: "Hello from Zara",
      contextId: "context-pstn",
      voiceId: "f786b574-daa5-4673-aa0c-cbe3e8534c02",
      language: "en",
      outputFormat: {
        encoding: "pcm_mulaw",
        sampleRateHz: 8_000,
      },
    });

    expect(request.output_format).toEqual({
      container: "raw",
      encoding: "pcm_mulaw",
      sample_rate: 8000,
    });
  });

  it("parses chunk, timestamps, and done messages from Cartesia", () => {
    const adapter = new CartesiaStreamingAdapter({
      apiKey: "cartesia-test-key",
      apiVersion: "2026-03-01",
    });

    const chunk = adapter.parseMessage(
      JSON.stringify({
        type: "chunk",
        data: "YXVkaW8=",
        done: false,
        status_code: 206,
        step_time: 123,
        context_id: "context-123",
      }),
    );
    const timestamps = adapter.parseMessage(
      JSON.stringify({
        type: "timestamps",
        done: false,
        status_code: 206,
        context_id: "context-123",
        word_timestamps: {
          words: ["Hello", "world"],
          start: [0, 0.5],
          end: [0.4, 0.9],
        },
      }),
    );
    const done = adapter.parseMessage(
      JSON.stringify({
        type: "done",
        done: true,
        status_code: 206,
        context_id: "context-123",
      }),
    );

    expect(chunk).toMatchObject({
      kind: "chunk",
      contextId: "context-123",
      audioBase64: "YXVkaW8=",
      stepTimeMs: 123,
    });
    expect(timestamps).toMatchObject({
      kind: "timestamps",
      contextId: "context-123",
      words: ["Hello", "world"],
    });
    expect(done).toMatchObject({
      kind: "done",
      contextId: "context-123",
    });
  });

  it("maps Cartesia error messages into runtime provider failures", () => {
    const adapter = new CartesiaStreamingAdapter({
      apiKey: "cartesia-test-key",
      apiVersion: "2026-03-01",
    });

    const errorPayload = adapter.parseMessage(
      JSON.stringify({
        type: "error",
        done: true,
        title: "Invalid model",
        message: "The model is not valid, make sure it is a valid model ID.",
        error_code: "model_not_found",
        status_code: 400,
        context_id: "context-123",
      }),
    );
    const timeoutFailure = adapter.mapCloseToRuntimeFailure({
      code: 1013,
      reason: "Try again later",
    });

    expect(errorPayload).toBeInstanceOf(RuntimeProviderFailure);
    expect((errorPayload as RuntimeProviderFailure).code).toBe("failed");
    expect(timeoutFailure.code).toBe("timeout");
  });
});
