import { describe, expect, it } from "vitest";

import type { RealtimeToolDeclaration } from "@zara/core";
import { OpenAiRealtimeAdapter } from "./openai-realtime.adapter";

describe("OpenAiRealtimeAdapter", () => {
  const tool = {
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
  } satisfies RealtimeToolDeclaration;

  it("declares Zara tools in the OpenAI Realtime session update", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime",
      systemPrompt: "Configured prompt",
      voice: "coral",
      language: "en",
      tools: [tool],
    });

    expect(adapter.createSessionUpdateMessage()).toEqual({
      type: "session.update",
      session: {
        type: "realtime",
        model: "gpt-realtime",
        instructions: [
          "Configured prompt",
          "",
          "# Language",
          "- The conversation will be only in English.",
          "- Do not respond in any other language even if the caller uses another language.",
          "- If the caller speaks another language, politely explain that support is limited to English.",
        ].join("\n"),
        output_modalities: ["audio"],
        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: 24000,
            },
            transcription: {
              model: "gpt-realtime-whisper",
              language: "en",
            },
            turn_detection: {
              type: "semantic_vad",
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            format: {
              type: "audio/pcm",
              rate: 24000,
            },
            voice: "coral",
          },
        },
        tool_choice: "auto",
        tools: [
          {
            type: "function",
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
    });

    const session = adapter.createSessionUpdateMessage().session as Record<string, unknown>;
    expect(session).not.toHaveProperty("input_audio_format");
    expect(session).not.toHaveProperty("output_audio_format");
    expect(session).not.toHaveProperty("input_audio_transcription");
    expect(session).not.toHaveProperty("turn_detection");
    expect(session).not.toHaveProperty("voice");
  });

  it("can disable provider-created responses when manual orchestration is requested", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime",
      systemPrompt: "Configured prompt",
      autoCreateResponse: false,
    });

    expect(adapter.createSessionUpdateMessage()).toMatchObject({
      session: {
        audio: {
          input: {
            turn_detection: {
              create_response: false,
              interrupt_response: false,
            },
          },
        },
      },
    });
  });

  it("treats incremental function-call argument events as diagnostics and builds identified continuation messages", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime",
      systemPrompt: "Configured prompt",
      tools: [tool],
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.function_call_arguments.done",
      call_id: "openai-call-1",
      name: "zara_zendesk_search_tickets_1234abcd",
      arguments: "{\"query\":\"account activation\"}",
    }))).toEqual([
      {
        type: "provider_event",
        eventType: "response.function_call_arguments.done",
        evidence: {
          callId: "openai-call-1",
          name: "zara_zendesk_search_tickets_1234abcd",
        },
      },
    ]);

    expect(adapter.createFunctionCallOutputMessage({
      providerCallId: "openai-call-1",
      output: {
        status: "completed",
        safeOutput: { count: 1 },
      },
    })).toEqual({
      event_id: "zara_function_call_output_openai-call-1",
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: "openai-call-1",
        output: JSON.stringify({
          status: "completed",
          safeOutput: { count: 1 },
        }),
      },
    });
    expect(adapter.createResponseCreateMessage({
      providerCallId: "openai-call-1",
    })).toEqual({
      event_id: "zara_response_create_openai-call-1",
      type: "response.create",
    });
    expect(adapter.createResponseCreateMessage({
      providerCallId: "openai-call-1",
      instructions: "Tell the caller they are being routed to Billing.",
    })).toEqual({
      event_id: "zara_response_create_openai-call-1",
      type: "response.create",
      response: {
        instructions: "Tell the caller they are being routed to Billing.",
      },
    });
  });

  it("parses OpenAI session update acknowledgements with safe effective-session evidence", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2",
      systemPrompt: "Configured prompt",
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "session.updated",
      session: {
        type: "realtime",
        model: "gpt-realtime-2",
        instructions: "Router instructions with Billing and Support branches.",
        output_modalities: ["audio"],
        tool_choice: "auto",
        tools: [
          {
            type: "function",
            name: "zara_handoff_to_agent",
            description: "Hand off caller to a configured specialist.",
            parameters: {
              type: "object",
              properties: {
                targetAgentId: {
                  type: "string",
                  enum: ["agent-billing"],
                },
              },
              required: ["targetAgentId"],
            },
          },
        ],
        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: 24000,
            },
            transcription: {
              model: "gpt-realtime-whisper",
              language: "en",
            },
            turn_detection: {
              type: "semantic_vad",
              create_response: true,
            },
          },
          output: {
            format: {
              type: "audio/pcm",
              rate: 24000,
            },
            voice: "marin",
          },
        },
      },
    }))).toEqual([
      {
        type: "session_ready",
      },
      {
        type: "provider_event",
        eventType: "session.updated",
        evidence: {
          sessionInstructions: "Router instructions with Billing and Support branches.",
          sessionToolChoice: "auto",
          sessionToolCount: 1,
          sessionToolNames: "zara_handoff_to_agent",
          sessionToolsJson: JSON.stringify([
            {
              type: "function",
              name: "zara_handoff_to_agent",
              description: "Hand off caller to a configured specialist.",
              parameters: {
                type: "object",
                properties: {
                  targetAgentId: {
                    type: "string",
                    enum: ["agent-billing"],
                  },
                },
                required: ["targetAgentId"],
              },
            },
          ]),
          sessionTools: [
            {
              type: "function",
              name: "zara_handoff_to_agent",
              description: "Hand off caller to a configured specialist.",
              parameters: {
                type: "object",
                properties: {
                  targetAgentId: {
                    type: "string",
                    enum: ["agent-billing"],
                  },
                },
                required: ["targetAgentId"],
              },
            },
          ],
          sessionType: "realtime",
          model: "gpt-realtime-2",
          outputModalities: ["audio"],
          inputAudioFormatType: "audio/pcm",
          inputAudioRate: 24000,
          inputTranscriptionConfigured: true,
          inputTranscriptionModel: "gpt-realtime-whisper",
          inputTranscriptionLanguage: "en",
          inputTurnDetectionType: "semantic_vad",
          inputTurnDetectionCreateResponse: true,
          audioOutputConfigured: true,
          outputAudioFormatType: "audio/pcm",
          outputAudioRate: 24000,
          outputAudioVoice: "marin",
        },
      },
    ]);
  });

  it("parses root-level OpenAI turn-detection acknowledgement evidence", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2",
      systemPrompt: "Configured prompt",
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "session.updated",
      session: {
        type: "realtime",
        model: "gpt-realtime-2",
        turn_detection: {
          type: "semantic_vad",
          create_response: false,
          interrupt_response: false,
        },
      },
    }))).toEqual([
      {
        type: "session_ready",
      },
      {
        type: "provider_event",
        eventType: "session.updated",
        evidence: {
          sessionType: "realtime",
          model: "gpt-realtime-2",
          inputTranscriptionConfigured: false,
          inputTurnDetectionType: "semantic_vad",
          inputTurnDetectionCreateResponse: false,
          inputTurnDetectionInterruptResponse: false,
          audioOutputConfigured: false,
        },
      },
    ]);
  });

  it("parses safe OpenAI realtime lifecycle evidence without audio payloads", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2",
      systemPrompt: "Configured prompt",
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "input_audio_buffer.speech_stopped",
      audio_start_ms: 120,
      audio_end_ms: 820,
      item_id: "item-user-1",
    }))).toEqual([
      {
        type: "provider_event",
        eventType: "input_audio_buffer.speech_stopped",
        evidence: {
          audioStartMs: 120,
          audioEndMs: 820,
          itemId: "item-user-1",
        },
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "input_audio_buffer.committed",
      previous_item_id: "item-prev",
      item_id: "item-user-2",
    }))).toEqual([
      {
        type: "input_audio_committed",
        itemId: "item-user-2",
      },
      {
        type: "provider_event",
        eventType: "input_audio_buffer.committed",
        evidence: {
          itemId: "item-user-2",
          previousItemId: "item-prev",
        },
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "input_audio_buffer.speech_started",
      audio_start_ms: 1200,
      item_id: "item-user-3",
    }))).toEqual([
      {
        type: "provider_event",
        eventType: "input_audio_buffer.speech_started",
        evidence: {
          audioStartMs: 1200,
          itemId: "item-user-3",
        },
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "conversation.item.input_audio_transcription.failed",
      item_id: "item-user-2",
      error: {
        type: "server_error",
        code: "transcription_failed",
        message: "Transcription failed.",
      },
    }))).toEqual([
      {
        type: "provider_event",
        eventType: "conversation.item.input_audio_transcription.failed",
        evidence: {
          itemId: "item-user-2",
          error: {
            type: "server_error",
            code: "transcription_failed",
            message: "Transcription failed.",
          },
        },
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.created",
      response: {
        id: "resp-1",
        status: "in_progress",
      },
    }))).toEqual([
      {
        type: "provider_event",
        eventType: "response.created",
        evidence: {
          responseId: "resp-1",
          status: "in_progress",
        },
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.cancelled",
      response: {
        id: "resp-cancelled",
        status: "cancelled",
      },
    }))).toEqual([
      {
        type: "provider_event",
        eventType: "response.cancelled",
        evidence: {
          responseId: "resp-cancelled",
          status: "cancelled",
        },
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        code: "invalid_value",
        message: "Invalid value: unsupported field.",
        param: "session.audio.output.speed",
        event_id: "setup-session-update",
      },
    }))).toEqual([
      {
        type: "provider_event",
        eventType: "error",
        evidence: {
          error: {
            type: "invalid_request_error",
            code: "invalid_value",
            message: "Invalid value: unsupported field.",
            param: "session.audio.output.speed",
            eventId: "setup-session-update",
          },
        },
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.done",
      response: {
        id: "resp-1",
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_audio",
                transcript: "Raw transcript is not copied into provider evidence.",
              },
            ],
          },
        ],
      },
    }))).toEqual([
      {
        type: "output_transcript",
        text: "Raw transcript is not copied into provider evidence.",
        done: true,
      },
      {
        type: "provider_event",
        eventType: "response.done",
        evidence: {
          responseId: "resp-1",
          status: "completed",
          outputItemTypes: ["message"],
          outputContentTypes: ["output_audio"],
          audioOutputContentPresent: true,
          outputTextLength: 52,
        },
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.done",
      response: {
        id: "resp-cancelled",
        status: "cancelled",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_audio",
                transcript: "This cancelled response must not complete a Zara turn.",
              },
            ],
          },
        ],
      },
    }))).toEqual([
      {
        type: "provider_event",
        eventType: "response.done",
        evidence: {
          responseId: "resp-cancelled",
          status: "cancelled",
          outputItemTypes: ["message"],
          outputContentTypes: ["output_audio"],
          audioOutputContentPresent: true,
        },
      },
    ]);
  });

  it("treats response output item function-call events as diagnostic evidence only", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2",
      systemPrompt: "Configured prompt",
      tools: [tool],
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.output_item.done",
      response_id: "resp-1",
      output_index: 0,
      item: {
        type: "function_call",
        id: "fc-1",
        call_id: "openai-call-3",
        name: "zara_zendesk_search_tickets_1234abcd",
        arguments: "{\"query\":\"shipping\"}",
      },
    }))).toEqual([
      {
        type: "provider_event",
        eventType: "response.output_item.done",
        evidence: {
          responseId: "resp-1",
          outputIndex: 0,
          itemId: "fc-1",
          itemType: "function_call",
          callId: "openai-call-3",
          name: "zara_zendesk_search_tickets_1234abcd",
        },
      },
    ]);
  });

  it("parses input transcript deltas and response.done audio transcripts", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2",
      systemPrompt: "Configured prompt",
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item-user-1",
      content_index: 0,
      delta: "Hello",
    }))).toEqual([
      {
        type: "input_transcript",
        text: "Hello",
        done: false,
        itemId: "item-user-1",
      },
      {
        type: "provider_event",
        eventType: "conversation.item.input_audio_transcription.delta",
        evidence: {
          itemId: "item-user-1",
          contentIndex: 0,
          textLength: 5,
        },
      },
    ]);

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.done",
      response: {
        id: "resp-1",
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_audio",
                transcript: "Hello, how can I help?",
              },
            ],
          },
        ],
      },
    }))).toEqual([
      {
        type: "output_transcript",
        text: "Hello, how can I help?",
        done: true,
      },
      {
        type: "provider_event",
        eventType: "response.done",
        evidence: {
          responseId: "resp-1",
          status: "completed",
          outputItemTypes: ["message"],
          outputContentTypes: ["output_audio"],
          audioOutputContentPresent: true,
          outputTextLength: 22,
        },
      },
    ]);
  });

  it("parses docs-style response.done function call output items", () => {
    const adapter = new OpenAiRealtimeAdapter({
      model: "gpt-realtime-2",
      systemPrompt: "Configured prompt",
      tools: [tool],
    });

    expect(adapter.parseServerMessage(JSON.stringify({
      type: "response.done",
      response: {
        output: [
          {
            type: "function_call",
            call_id: "openai-call-2",
            name: "zara_zendesk_search_tickets_1234abcd",
            arguments: "{\"query\":\"billing\"}",
          },
        ],
      },
    }))).toEqual([
      {
        type: "tool_call",
        providerCallId: "openai-call-2",
        name: "zara_zendesk_search_tickets_1234abcd",
        argumentsJson: "{\"query\":\"billing\"}",
      },
    ]);
  });
});
