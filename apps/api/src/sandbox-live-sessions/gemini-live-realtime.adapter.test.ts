import { describe, expect, it } from "vitest";

import type { RealtimeToolDeclaration } from "@zara/core";
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
      setup: {
        model: "models/gemini-3.1-flash-live-preview",
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Configured prompt" }],
        },
      },
    });
  });

  it("includes Zara agent tools as Gemini function declarations in setup", () => {
    const adapter = new GeminiLiveRealtimeAdapter({
      apiKey: "gemini-live-key",
      model: "gemini-3.1-flash-live-preview",
      systemPrompt: "Configured prompt",
      tools: [
        {
          name: "zara_zendesk_search_tickets_1234abcd",
          toolAssignmentId: "assignment-1",
          toolId: "zendesk.search_tickets",
          label: "Search tickets",
          description: "Search tickets\nRisk: low.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        } satisfies RealtimeToolDeclaration,
      ],
    });

    expect(adapter.createSetupMessage()).toMatchObject({
      setup: {
        tools: [
          {
            functionDeclarations: [
              {
                name: "zara_zendesk_search_tickets_1234abcd",
                description: "Search tickets\nRisk: low.",
                parameters: {
                  type: "object",
                  properties: {
                    query: { type: "string" },
                  },
                  required: ["query"],
                },
              },
            ],
          },
        ],
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

  it("parses Gemini function calls and builds FunctionResponse messages", () => {
    const adapter = new GeminiLiveRealtimeAdapter({
      apiKey: "gemini-live-key",
      model: "gemini-3.1-flash-live-preview",
      systemPrompt: "Configured prompt",
    });

    const events = adapter.parseServerMessage(JSON.stringify({
      tool_call: {
        function_calls: [
          {
            id: "gemini-call-1",
            name: "zara_zendesk_search_tickets_1234abcd",
            args: {
              query: "account activation",
            },
          },
        ],
      },
    }));

    expect(events).toEqual([
      {
        type: "tool_call",
        providerCallId: "gemini-call-1",
        name: "zara_zendesk_search_tickets_1234abcd",
        arguments: {
          query: "account activation",
        },
      },
    ]);
    expect(adapter.createToolResponseMessage({
      providerCallId: "gemini-call-1",
      name: "zara_zendesk_search_tickets_1234abcd",
      response: {
        status: "completed",
        safeOutput: {
          count: 1,
        },
      },
    })).toEqual({
      toolResponse: {
        functionResponses: [
          {
            id: "gemini-call-1",
            name: "zara_zendesk_search_tickets_1234abcd",
            response: {
              status: "completed",
              safeOutput: {
                count: 1,
              },
            },
          },
        ],
      },
    });
  });
});
