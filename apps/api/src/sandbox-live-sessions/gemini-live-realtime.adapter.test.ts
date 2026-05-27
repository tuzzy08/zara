import { describe, expect, it } from "vitest";

import { GeminiLiveRealtimeAdapter } from "./gemini-live-realtime.adapter";

describe("GeminiLiveRealtimeAdapter", () => {
  it("creates a server-owned websocket session and setup message for native audio", () => {
    const adapter = new GeminiLiveRealtimeAdapter({
      apiKey: "gemini-live-key",
      model: "gemini-3.1-flash-live-preview",
      systemPrompt: "Configured prompt",
    });

    const session = adapter.createSession();
    const setup = adapter.createSetupMessage();

    expect(session.websocketUrl).toBe(
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=gemini-live-key",
    );
    expect(setup).toEqual({
      config: {
        model: "models/gemini-3.1-flash-live-preview",
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Configured prompt" }],
        },
      },
    });
  });

  it("builds realtime text and 16kHz PCM audio input messages", () => {
    const adapter = new GeminiLiveRealtimeAdapter({
      apiKey: "gemini-live-key",
      model: "gemini-3.1-flash-live-preview",
      systemPrompt: "Configured prompt",
    });

    expect(adapter.createTextInputMessage("Hello")).toEqual({
      realtimeInput: {
        text: "Hello",
      },
    });
    expect(adapter.createAudioInputMessage("AAEC")).toEqual({
      realtimeInput: {
        audio: {
          data: "AAEC",
          mimeType: "audio/pcm;rate=16000",
        },
      },
    });
  });

  it("parses server audio chunks and transcripts from Gemini Live messages", () => {
    const adapter = new GeminiLiveRealtimeAdapter({
      apiKey: "gemini-live-key",
      model: "gemini-3.1-flash-live-preview",
      systemPrompt: "Configured prompt",
    });

    const events = adapter.parseServerMessage(JSON.stringify({
      serverContent: {
        modelTurn: {
          parts: [
            {
              inlineData: {
                data: "YXVkaW8=",
                mimeType: "audio/pcm;rate=24000",
              },
            },
          ],
        },
        inputTranscription: {
          text: "Caller text",
        },
        outputTranscription: {
          text: "Agent text",
        },
      },
    }));

    expect(events).toEqual([
      {
        type: "audio",
        audioBase64: "YXVkaW8=",
        mimeType: "audio/pcm;rate=24000",
      },
      {
        type: "input_transcript",
        text: "Caller text",
      },
      {
        type: "output_transcript",
        text: "Agent text",
      },
    ]);
  });
});
