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
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: {
          parts: [{ text: "Configured prompt" }],
        },
      },
    });
    expect(JSON.stringify(setup)).not.toContain("automaticActivityDetection");
    expect(JSON.stringify(setup)).not.toContain("activityStart");
    expect(JSON.stringify(setup)).not.toContain("activityEnd");
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

  it("includes the selected Gemini Live voice in setup speech config", () => {
    const adapter = new GeminiLiveRealtimeAdapter({
      apiKey: "gemini-live-key",
      model: "gemini-3.1-flash-live-preview",
      systemPrompt: "Configured prompt",
      voiceName: "Puck",
    });

    expect(adapter.createSetupMessage()).toMatchObject({
      setup: {
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Puck",
            },
          },
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
        done: false,
      },
      {
        type: "provider_event",
        event: "input_transcription",
        evidence: {
          textLength: "Caller text".length,
        },
      },
      {
        type: "output_transcript",
        text: "Agent text",
        done: false,
      },
      {
        type: "provider_event",
        event: "output_transcription",
        evidence: {
          textLength: "Agent text".length,
        },
      },
    ]);
  });

  it("parses Gemini setup completion as provider readiness", () => {
    const adapter = new GeminiLiveRealtimeAdapter({
      apiKey: "gemini-live-key",
      model: "gemini-3.1-flash-live-preview",
      systemPrompt: "Configured prompt",
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      setupComplete: {},
    }))).toEqual([
      {
        type: "session_ready",
      },
      {
        type: "provider_event",
        event: "setup_complete",
        evidence: {
          hasSetupComplete: true,
        },
      },
    ]);
  });

  it("parses safe provider evidence for transcription, generation, turn, and interruption lifecycle", () => {
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
                data: "raw-audio-must-not-appear-in-evidence",
                mimeType: "audio/pcm;rate=24000",
              },
            },
          ],
        },
        inputTranscription: {
          text: "Caller account number is 1234",
        },
        outputTranscription: {
          text: "I can help with that.",
        },
        generationComplete: true,
        interrupted: true,
        turnComplete: true,
      },
    }));

    expect(events).toContainEqual({
      type: "provider_event",
      event: "input_transcription",
      evidence: {
        textLength: "Caller account number is 1234".length,
      },
    });
    expect(events).toContainEqual({
      type: "provider_event",
      event: "output_transcription",
      evidence: {
        textLength: "I can help with that.".length,
      },
    });
    expect(events).toContainEqual({
      type: "provider_event",
      event: "generation_complete",
      evidence: {
        generationComplete: true,
      },
    });
    expect(events).toContainEqual({
      type: "provider_event",
      event: "interrupted",
      evidence: {
        interrupted: true,
      },
    });
    expect(events).toContainEqual({
      type: "provider_event",
      event: "turn_complete",
      evidence: {
        turnComplete: true,
      },
    });
    expect(JSON.stringify(events.filter((event) => event.type === "provider_event"))).not.toContain(
      "raw-audio-must-not-appear-in-evidence",
    );
    expect(JSON.stringify(events.filter((event) => event.type === "provider_event"))).not.toContain(
      "Caller account number is 1234",
    );
  });

  it("parses surfaced Gemini activity markers as safe provider evidence", () => {
    const adapter = new GeminiLiveRealtimeAdapter({
      apiKey: "gemini-live-key",
      model: "gemini-3.1-flash-live-preview",
      systemPrompt: "Configured prompt",
    });

    const events = adapter.parseServerMessage(JSON.stringify({
      serverContent: {
        activityStart: {},
        activityEnd: {},
      },
    }));

    expect(events).toEqual([
      {
        type: "provider_event",
        event: "activity_start",
        evidence: {
          hasActivityStart: true,
        },
      },
      {
        type: "provider_event",
        event: "activity_end",
        evidence: {
          hasActivityEnd: true,
        },
      },
    ]);
  });

  it("parses safe provider evidence for Gemini tool calls and cancellations without raw arguments", () => {
    const adapter = new GeminiLiveRealtimeAdapter({
      apiKey: "gemini-live-key",
      model: "gemini-3.1-flash-live-preview",
      systemPrompt: "Configured prompt",
    });

    const events = adapter.parseServerMessage(JSON.stringify({
      toolCall: {
        functionCalls: [
          {
            id: "gemini-call-1",
            name: "zara_zendesk_search_tickets_1234abcd",
            args: {
              query: "private account activation",
            },
          },
        ],
      },
      toolCallCancellation: {
        ids: ["gemini-call-2"],
      },
    }));

    expect(events).toContainEqual({
      type: "provider_event",
      event: "tool_call",
      evidence: {
        functionCallCount: 1,
        functionCallIds: ["gemini-call-1"],
        functionNames: ["zara_zendesk_search_tickets_1234abcd"],
      },
    });
    expect(events).toContainEqual({
      type: "provider_event",
      event: "tool_call_cancellation",
      evidence: {
        ids: ["gemini-call-2"],
      },
    });
    expect(JSON.stringify(events.filter((event) => event.type === "provider_event"))).not.toContain(
      "private account activation",
    );
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
        type: "provider_event",
        event: "tool_call",
        evidence: {
          functionCallCount: 1,
          functionCallIds: ["gemini-call-1"],
          functionNames: ["zara_zendesk_search_tickets_1234abcd"],
        },
      },
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
